import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Explicit opt-in: this test deploys a temporary public Worker and incurs AI/browser usage.
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(account, 'Set CLOUDFLARE_ACCOUNT_ID before running the live test.');
const exec = promisify(execFile);
const base = process.env.WATCHAGENT_URL ?? 'http://localhost:8787';
const secrets = process.env.API_KEY ? '' : await readFile('.dev.vars', 'utf8');
const key = process.env.API_KEY ?? /^API_KEY=(.+)$/m.exec(secrets)?.[1];
assert.ok(key, 'API_KEY mancante.');
const dir = await mkdtemp(join(tmpdir(), 'watchagent-live-'));
const name = `watchagent-live-${Date.now().toString(36)}`;
const config = join(dir, 'wrangler.json');
const wrangler = resolve('node_modules/.bin/wrangler');
const ids = [];
const report = { started_at: new Date().toISOString(), account_id: account, fixture_worker: name, checks: [], retries: [] };
let deployed = false;
async function cli(args) {
  const result = await exec(wrangler, args, { timeout: 120_000, maxBuffer: 1_000_000 });
  console.log(result.stdout); if (result.stderr) console.error(result.stderr);
  return result.stdout;
}
async function deploy(price) {
  const output = await cli(['deploy', '--config', config, '--var', `PRICE:${price}`]);
  deployed = true;
  const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(output)?.[0];
  assert.ok(url, 'Temporary Worker URL not found.');
  // Wait for the actual public revision, rather than assuming instantaneous propagation.
  for (let i = 0; i < 60; i++) {
    const r = await fetch(url + '/pricing');
    if (r.ok && (await r.text()).includes(`$${price} per month`)) return url;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw Error('Public page revision did not propagate.');
}
async function api(path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}
async function create(url, extra = {}) {
  const w = await api('/v1/watch', 'POST', { url, condition: 'notify me if they launch a plan under $50', interval_minutes: 60, ...extra });
  ids.push(w.id); return w.id;
}
async function run(id) {
  const { run_id } = await api(`/v1/watch/${id}/run`, 'POST');
  let lastError;
  for (let i = 0; i < 480; i++) {
    const runs = await api(`/v1/watch/${id}/runs`);
    const r = runs.find(r => r.id === run_id);
    if (r && !['queued', 'running', 'retry'].includes(r.status)) return r;
    if (r?.status === 'retry' && r.error !== lastError) {
      lastError = r.error;
      report.retries.push({ run_id, error: r.error, observed_at: new Date().toISOString() });
      console.warn(`Retry transient del job ${run_id}: ${r.error}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw Error('Live run timeout.');
}
async function check(id, expected, mode, phase) {
  let r = await run(id);
  // A deployment can reach Node's edge before the edge used by Workers fetch/Browser.
  // Unchanged is legitimate until that edge sees the new revision; don't mislabel it
  // as a classifier failure, and do not retry an actual wrong classification.
  for (let i = 0; i < 15 && r.status === 'unchanged' && ['matched', 'not_matched'].includes(expected); i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    r = await run(id);
  }
  // Production Cron may finish a baseline before the first manual request.
  const cronBaseline = expected === 'baseline' && r.status === 'unchanged' &&
    (await api(`/v1/watch/${id}/runs`)).some(previous => previous.status === 'baseline');
  assert.ok(r.status === expected || cronBaseline, `Expected ${expected}: ${JSON.stringify(r)}`);
  assert.equal(r.fetch_mode, mode, JSON.stringify(r));
  report.checks.push({ phase, watch_id: id, ...r });
  console.log(`OK ${phase}: ${r.status} via ${r.fetch_mode}`);
}
try {
  await writeFile(join(dir, 'worker.js'), await readFile('scripts/live-fixture.js'));
  await writeFile(config, JSON.stringify({ name, account_id: account, main: 'worker.js', compatibility_date: '2026-10-14', workers_dev: true, preview_urls: false }));
  assert.equal((await api('/health')).ok, true);
  const fixture = await deploy(90); report.fixture_url = fixture;
  const http = await create(fixture + '/pricing', { webhook: fixture + '/hook' });
  const browser = await create(fixture + '/pricing', { use_browser: true });
  const fallback = await create(fixture + '/shell');
  const watches = [[http, 'http'], [browser, 'browser'], [fallback, 'browser']];
  for (const [id, mode] of watches) await check(id, 'baseline', mode, 'baseline $90');
  await deploy(85);
  for (const [id, mode] of watches) {
    await check(id, 'not_matched', mode, 'non-matching $85');
    assert.equal((await api(`/v1/watch/${id}/events`)).length, 0);
  }
  await deploy(40);
  for (const [id, mode] of watches) {
    await check(id, 'matched', mode, 'matching $40');
    const events = await api(`/v1/watch/${id}/events`); assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'plan_launched');
    assert.ok(events[0].evidence?.after, 'Matched event has grounded after evidence');
    await api(`/v1/event/${events[0].id}/review`, 'POST', { verdict: 'correct', note: 'Controlled fixture introduces a genuinely new Lite plan at $40/month.' });
    assert.equal((await api(`/v1/watch/${id}/events`))[0].review.verdict, 'correct');
    report.checks.push({ phase: 'event', watch_id: id, event: events[0] });
    await check(id, 'unchanged', mode, 'duplicate prevention');
    assert.equal((await api(`/v1/watch/${id}/events`)).length, 1);
  }
  for (let i = 0; i < 60; i++) {
    const [event] = await api(`/v1/watch/${http}/events`);
    if (event.delivery_status === 'delivered') {
      report.checks.push({ phase: 'webhook delivered', event }); break;
    }
    assert.notEqual(event.delivery_status, 'failed', event.delivery_error);
    assert.ok(i < 59, 'Webhook delivery timeout.');
    await new Promise(r => setTimeout(r, 1000));
  }
  const failing = await create(fixture + '/missing');
  const failed = await run(failing);
  assert.equal(failed.status, 'failed'); assert.equal(failed.http_status, 404);
  report.checks.push({ phase: 'permanent HTTP failure recorded', ...failed });
  report.ok = true;
  console.log('LIVE OK: HTTP, Workers AI, Browser opt-in/fallback, semantic events, no duplicates, webhook, errors.');
} catch (error) {
  report.ok = false; report.error = String(error); throw error;
} finally {
  report.finished_at = new Date().toISOString();
  for (const id of ids) { try { await api(`/v1/watch/${id}`, 'DELETE'); } catch (e) { console.error('Watch cleanup:', String(e)); } }
  if (deployed) {
    try { await cli(['delete', '--config', config, '--force']); report.fixture_deleted = true; }
    catch (e) { console.error('Fixture cleanup failed:', name, String(e)); report.fixture_deleted = false; }
  }
  await mkdir('.wrangler', { recursive: true });
  const reportPath = base.startsWith('https://') ? '.wrangler/production-test-report.json' : '.wrangler/live-test-report.json';
  await writeFile(reportPath, JSON.stringify({ ...report, service_url: base }, null, 2));
  await rm(dir, { recursive: true, force: true });
  console.log(`Report: ${reportPath}`);
}

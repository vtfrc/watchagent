import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Production integration verification. Uses private local credentials, never logs the key.
// The live child test deploys/deletes a temporary Worker and incurs AI/browser usage.
const secrets = await readFile('.env.production', 'utf8');
const key = process.env.API_KEY ?? /^WATCHAGENT_API_KEY=(.+)$/m.exec(secrets)?.[1];
const base = process.env.WATCHAGENT_URL ?? /^WATCHAGENT_URL=(.+)$/m.exec(secrets)?.[1];
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(key && base && account, 'Requires .env.production and CLOUDFLARE_ACCOUNT_ID.');
const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
async function req(path, method = 'GET', body) {
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json(); assert.ok(r.ok, `${r.status}: ${JSON.stringify(data)}`); return data;
}
assert.equal((await req('/health')).ok, true);
assert.equal((await fetch(base + '/v1/watches')).status, 401);
assert.equal((await fetch(base + '/__dev/page', { method: 'POST', headers, body: '{"content":"disabled"}' })).status, 404);
assert.equal((await fetch(base + '/v1/watch', { method: 'POST', headers, body: JSON.stringify({ url: 'http://169.254.169.254', condition: 'blocked destination' }) })).status, 400);
console.log('Production health, authentication, disabled fixtures and SSRF: OK');
const watch = await req('/v1/watch', 'POST', {
  url: 'https://example.com/', condition: 'notify if the example domain notice changes', interval_minutes: 60
});
console.log('Watch awaiting real Cron, without manual execution:', watch.id);
try {
  const lifecycle = await req('/v1/watch', 'POST', { url: 'https://example.com/', condition: 'notify if the notice changes', interval_minutes: 60 });
  try {
    await req(`/v1/watch/${lifecycle.id}`, 'PATCH', { status: 'paused' });
    const blocked = await fetch(base + `/v1/watch/${lifecycle.id}/run`, { method: 'POST', headers });
    assert.equal(blocked.status, 409, 'Paused watches reject manual runs');
    await req(`/v1/watch/${lifecycle.id}`, 'PATCH', { status: 'active' });
    const { run_id } = await req(`/v1/watch/${lifecycle.id}/run`, 'POST');
    let completed;
    for (let i = 0; i < 120; i++) {
      const runs = await req(`/v1/watch/${lifecycle.id}/runs`);
      completed = runs.find(r => r.id === run_id && ['baseline', 'unchanged'].includes(r.status));
      if (completed) break;
      assert.ok(!runs.some(r => r.id === run_id && r.status === 'failed'), JSON.stringify(runs));
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(completed, 'Lifecycle run completed through the production Queue');
    const metadata = await req(`/v1/watch/${lifecycle.id}`);
    assert.equal(metadata.latest_run.id, run_id);
    assert.equal(metadata.latest_run.ai_calls, 0, 'Baseline/unchanged skips AI');
    assert.ok(metadata.latest_run.fetch_ms >= 0);
    assert.ok(!('last_content' in metadata));
    const second = await req(`/v1/watch/${lifecycle.id}/run`, 'POST');
    let unchanged;
    for (let i = 0; i < 90; i++) {
      unchanged = (await req(`/v1/watch/${lifecycle.id}/runs`)).find(r => r.id === second.run_id && r.status === 'unchanged');
      if (unchanged) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(unchanged, 'Repeat production run skips inference');
    await req(`/v1/run/${second.run_id}/review`, 'POST', { verdict: 'unsure', note: 'Integration-only review; deleted with this temporary watch.' });
    const reviewed = await req(`/v1/watch/${lifecycle.id}`);
    assert.equal(reviewed.latest_run.review.verdict, 'unsure');
    const activity = await req('/v1/report');
    const metrics = activity.watches.find(w => w.id === lifecycle.id);
    assert.ok(metrics.runs >= 2); assert.equal(metrics.run_unsure, 1); assert.equal(metrics.ai_calls, 0);
    console.log('Production lifecycle, diagnostics, non-event review and full activity aggregates: OK');
  } finally { await req(`/v1/watch/${lifecycle.id}`, 'DELETE'); }
  const child = spawn(process.execPath, ['scripts/live.mjs'], {
    env: { ...process.env, API_KEY: key, WATCHAGENT_URL: base }, stdio: 'inherit'
  });
  const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
  assert.equal(code, 0, 'Production live integration test');
  let cronRun;
  // New Cron configuration can take up to 15 minutes to propagate.
  for (let i = 0; i < 960; i++) {
    const runs = await req(`/v1/watch/${watch.id}/runs`);
    const done = runs.find(r => r.status === 'baseline');
    if (done) { cronRun = done; break; }
    assert.ok(!runs.some(r => r.status === 'failed'), JSON.stringify(runs));
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(cronRun, 'Real Cron did not capture a baseline');
  const metadata = await req(`/v1/watch/${watch.id}`);
  assert.ok(Date.parse(metadata.next_run_at) > Date.parse(cronRun.finished_at), 'next_run_at advanced');
  await writeFile('.wrangler/production-cron-report.json', JSON.stringify({
    ok: true, service_url: base, watch_id: watch.id, run: cronRun,
    next_run_at: metadata.next_run_at, verified_at: new Date().toISOString()
  }, null, 2));
  console.log('PRODUCTION OK: real Cron → remote D1 → remote Queue → consumer → baseline, next_run_at advanced.');
} finally {
  await req(`/v1/watch/${watch.id}`, 'DELETE');
}

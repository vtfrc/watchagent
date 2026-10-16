import assert from 'node:assert/strict';

const base = process.env.WATCHAGENT_URL ?? 'http://localhost:8787';
const key = process.env.API_KEY ?? 'change-me-local';
const ids = [];
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}
async function setPage(content) { await api('/__dev/page', 'POST', { content }); }
async function create(extra = {}) {
  const watch = await api('/v1/watch', 'POST', {
    url: 'https://fixture.watchagent.dev/pricing', condition: 'notify me if they launch a plan under $50', interval_minutes: 60, ...extra
  });
  ids.push(watch.id); return watch.id;
}
async function waitRun(id, runId) {
  for (let i = 0; i < 100; i++) {
    const runs = await api(`/v1/watch/${id}/runs`);
    const run = runs.find(r => !runId || r.id === runId);
    if (run && !['queued', 'retry', 'running'].includes(run.status)) {
      assert.notEqual(run.status, 'failed', run.error); return run;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Queue consumer did not complete the run within 20 seconds.');
}
async function run(id) {
  const { run_id } = await api(`/v1/watch/${id}/run`, 'POST');
  return waitRun(id, run_id);
}
try {
  assert.equal((await api('/health')).ok, true);
  assert.equal((await fetch(base + '/v1/watches')).status, 401);
  const blocked = await fetch(base + '/v1/watch', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://169.254.169.254', condition: 'test ssrf' })
  });
  assert.equal(blocked.status, 400);
  await setPage('<h1>Pricing</h1><p>Plan $90</p>');
  const id = await create();
  assert.equal((await run(id)).status, 'baseline');
  await setPage('<h1>Pricing updated</h1><p>Plan $85</p>');
  assert.equal((await run(id)).status, 'not_matched');
  assert.equal((await api(`/v1/watch/${id}/events`)).length, 0);
  await setPage('<h1>Pricing</h1><p>New plan $40</p>');
  assert.equal((await run(id)).status, 'matched');
  assert.equal((await api(`/v1/watch/${id}/events`)).length, 1);
  assert.equal((await run(id)).status, 'unchanged');
  assert.equal((await api(`/v1/watch/${id}/events`)).length, 1);
  const browser = await create({ use_browser: true });
  assert.equal((await run(browser)).fetch_mode, 'browser');
  const shell = await create({ url: 'https://fixture.watchagent.dev/shell' });
  assert.equal((await run(shell)).fetch_mode, 'browser');
  const scheduled = await create();
  const cron = await fetch(base + '/__scheduled?cron=*/5+*+*+*+*');
  assert.ok(cron.ok, 'Cron Trigger locale');
  assert.equal((await waitRun(scheduled)).status, 'baseline');
  console.log('OK: auth, SSRF, create, real local Queue, baseline, irrelevant change, semantic event, no duplicates, browser fixtures, Cron → Queue.');
} finally {
  for (const id of ids) await api(`/v1/watch/${id}`, 'DELETE');
}

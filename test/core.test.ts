import { env, applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { consume, deliverWebhook, enqueueRun, processRun, schedule } from '../src/jobs';
import { parseEvaluation } from '../src/evaluation';
import { assertPublicUrl, publicIp, safeFetch, validateUrl } from '../src/security';
import { insufficientHtml } from '../src/content';
import { normalizeHtml } from '../src/util';
import type { Env, Job } from '../src/types';

const bindings = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };
const queueSend = vi.fn(async (_job: Job) => {});
function decision(matched = true, confidence = 0.95, summary = 'New plan $40.') {
  return { response: { matched, confidence, event_type: 'price_changed', summary, reason: 'Price changed in the source.',
    evidence: { before: matched ? '$90' : null, after: matched ? '$40' : null } } };
}
const aiRun = vi.fn(async () => decision());
const browser = vi.fn(async () => Response.json({ success: true, result: '# Pricing $40' }));
const e = { DB: bindings.DB, API_KEY: 'test-key', JOBS: { send: queueSend },
  AI: { run: aiRun }, BROWSER: { quickAction: browser }, AI_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', MAX_CONTENT_CHARS: '12000' } as unknown as Env;
let page = '<h1>Pricing</h1><p>Plan $90</p>';
let pageStatus = 200;
let webhookStatus = 200;
let webhookPosts: RequestInit[] = [];

beforeAll(async () => { await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS); });
beforeEach(async () => {
  await bindings.DB.prepare('DELETE FROM watches').run();
  queueSend.mockClear(); aiRun.mockReset(); browser.mockClear();
  aiRun.mockResolvedValue(decision());
  page = '<h1>Pricing</h1><p>Plan $90</p>'; pageStatus = 200; webhookStatus = 200; webhookPosts = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) {
      return Response.json({ Status: 0, Answer: url.includes('type=AAAA') ? [] : [{ type: 1, data: '93.184.215.14' }] });
    }
    if (url.startsWith('https://hooks.public.com')) { webhookPosts.push(init!); return new Response('', { status: webhookStatus }); }
    if (url.startsWith('https://public.com')) return new Response(page, { status: pageStatus, headers: { 'content-type': 'text/html' } });
    throw Error('Unexpected network request: ' + url);
  }) as typeof fetch;
});

async function api(path: string, method = 'GET', body?: unknown, auth = true) {
  return worker.fetch(new Request('http://local' + path, { method, headers: { ...(auth ? { authorization: 'Bearer test-key' } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), e);
}
async function create(extra = {}) {
  const r = await api('/v1/watch', 'POST', { url: 'https://public.com/pricing', condition: 'new plan under $50', ...extra });
  expect(r.status).toBe(201);
  return (await r.json() as { id: string }).id;
}
async function run(id: string) {
  const rid = await enqueueRun(e, id); await processRun(e, rid);
  return rid;
}
async function events(id: string) { return (await api(`/v1/watch/${id}/events`)).json() as Promise<unknown[]>; }
async function runs(id: string) { return (await api(`/v1/watch/${id}/runs`)).json() as Promise<{ id: string; status: string; error: string; http_status: number; fetch_mode: string }[]>; }

it('human event reviews are authenticated, validated, editable and independent of delivery/classification', async () => {
  const id = await create({ webhook: 'https://hooks.public.com/events' }); await run(id);
  page = '<p>New plan $40</p>'; const rid = await run(id);
  const event = (await events(id))[0] as { id: string };
  const path = `/v1/event/${event.id}/review`;
  expect((await api(path, 'POST', { verdict: 'correct' }, false)).status).toBe(401);
  for (const payload of [{ verdict: 'false_negative' }, { verdict: 'correct', note: 'x'.repeat(1001) }, { verdict: 'correct', extra: true }]) expect((await api(path, 'POST', payload)).status).toBe(400);
  expect((await api('/v1/event/missing/review', 'POST', { verdict: 'correct' })).status).toBe(404);
  const before = await bindings.DB.prepare('SELECT evaluation_json FROM watch_runs WHERE id=?').bind(rid).first();
  const first = await (await api(path, 'POST', { verdict: 'correct', note: '  independently checked  ' })).json() as { created_at: string };
  const updated = await (await api(path, 'POST', { verdict: 'false_positive', note: '<script>not executed</script>' })).json() as { created_at: string };
  expect(updated.created_at).toBe(first.created_at);
  expect((await events(id))[0]).toMatchObject({ delivery_status: 'pending', review: { verdict: 'false_positive', note: '<script>not executed</script>' } });
  expect(await bindings.DB.prepare('SELECT evaluation_json FROM watch_runs WHERE id=?').bind(rid).first()).toEqual(before);
  const report = await (await api('/v1/report')).json() as { totals: Record<string, number> };
  expect(report.totals).toMatchObject({ runs: 2, events: 1, event_false_positive: 1, event_unreviewed: 0, ai_calls: 1 });
  await api(`/v1/watch/${id}`, 'DELETE');
  expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM event_reviews').first<{ n: number }>())!.n).toBe(0);
});
it('completed non-event reviews expose reported misses without labelling baseline, failed or emitted runs', async () => {
  const id = await create(); const baseline = await run(id);
  expect((await api(`/v1/run/${baseline}/review`, 'POST', { verdict: 'correct' })).status).toBe(409);
  const negative = await run(id);
  expect((await api(`/v1/run/${negative}/review`, 'POST', { verdict: 'false_positive' })).status).toBe(400);
  expect((await api(`/v1/run/${negative}/review`, 'POST', { verdict: 'false_negative', note: 'Observed separately on the source.' })).status).toBe(200);
  const watch = await (await api(`/v1/watch/${id}`)).json() as { latest_run: { review: unknown } };
  expect(watch.latest_run.review).toMatchObject({ verdict: 'false_negative' });
  expect((await runs(id)).find(r => r.id === negative)).toMatchObject({ review: { verdict: 'false_negative' } });
  const report = await (await api('/v1/report')).json() as { totals: Record<string, number> };
  expect(report.totals).toMatchObject({ run_false_negative: 1, events: 0, ai_calls: 0 });
  page = '<p>$40</p>'; const matched = await run(id);
  expect((await api(`/v1/run/${matched}/review`, 'POST', { verdict: 'correct' })).status).toBe(409);
  const queued = await enqueueRun(e, id);
  expect((await api(`/v1/run/${queued}/review`, 'POST', { verdict: 'unsure' })).status).toBe(409);
  await api(`/v1/watch/${id}`, 'DELETE');
  expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM run_reviews').first<{ n: number }>())!.n).toBe(0);
});
it('empty activity returns zero counters and the watch cap is explicit', async () => {
  const empty = await (await api('/v1/report')).json() as { totals: Record<string, number> };
  expect(empty.totals).toMatchObject({ runs: 0, events: 0, ai_calls: 0 });
  await bindings.DB.batch(Array.from({ length: 101 }, (_, i) => bindings.DB.prepare(`INSERT INTO watches(id,url,condition,interval_minutes,next_run_at,created_at,updated_at) VALUES(?,'https://public.com','test',60,'2000-01-01','2000-01-01','2000-01-01')`).bind('capped_' + i)));
  const report = await (await api('/v1/report')).json() as { watches: unknown[]; truncated: boolean; totals: Record<string, number> };
  expect(report.watches).toHaveLength(100); expect(report.truncated).toBe(true); expect(report.totals.runs).toBe(0);
});
it('activity aggregates exceed the history limit, respect half-open dates and expose missing measurements', async () => {
  const id = await create();
  await bindings.DB.batch(Array.from({ length: 120 }, (_, i) => bindings.DB.prepare(`INSERT INTO watch_runs(id,watch_id,status,created_at,attempts,ai_calls,fetch_ms,ai_ms) VALUES(?,?,'not_matched','2000-01-02T00:00:00.000Z',3,2,10,20)`).bind('sample_' + i, id)));
  await bindings.DB.batch([
    bindings.DB.prepare(`INSERT INTO watch_runs(id,watch_id,status,created_at,attempts,ai_calls) VALUES('unmeasured',?,'unchanged','2000-01-02T00:00:00.000Z',1,NULL)`).bind(id),
    bindings.DB.prepare(`INSERT INTO watch_runs(id,watch_id,status,created_at,error) VALUES('cancelled',?,'failed','2000-01-02T00:00:00.000Z','Cancelled: watch paused.')`).bind(id),
    bindings.DB.prepare(`INSERT INTO watch_runs(id,watch_id,status,created_at) VALUES('boundary',?,'failed','2000-01-10T00:00:00.000Z')`).bind(id)
  ]);
  await api('/v1/run/sample_0/review', 'POST', { verdict: 'false_negative' });
  expect(await runs(id)).toHaveLength(100);
  const query = new URLSearchParams({ since: '2000-01-01T01:00:00+01:00', until: '2000-01-10T00:00:00Z' });
  const response = await api('/v1/report?' + query); expect(response.status).toBe(200);
  const report = await response.json() as { since: string; totals: Record<string, number>; watches: unknown[]; truncated: boolean };
  expect(report.since).toBe('2000-01-01T00:00:00.000Z'); expect(report.truncated).toBe(false); expect(report.watches).toHaveLength(1);
  expect(report.totals).toMatchObject({ runs: 122, not_matched: 120, unchanged: 1, cancelled: 1, failed: 0, ai_calls: 240, ai_calls_unmeasured_runs: 1, attempts: 361, extra_attempts: 240, fetch_samples: 120, fetch_ms_total: 1200, ai_samples: 120, ai_ms_total: 2400, run_false_negative: 1, run_unreviewed: 120 });
  expect((await api('/v1/report', 'GET', undefined, false)).status).toBe(401);
  for (const range of ['since=invalid', 'since=2000-01-10T00:00:00Z&until=2000-01-01T00:00:00Z', 'since=2000-01-01T00:00:00Z&until=2000-03-01T00:00:00Z', 'until=2999-01-01T00:00:00Z']) expect((await api('/v1/report?' + range)).status).toBe(400);
});
it('baseline, semantic match, identical content and duplicate Queue job', async () => {
  const id = await create(); await run(id);
  expect(aiRun).not.toHaveBeenCalled();
  expect(await events(id)).toHaveLength(0);
  page = '<h1>Pricing</h1><p>New plan $40</p>';
  const rid = await run(id);
  expect(aiRun).toHaveBeenCalledOnce(); expect(await events(id)).toHaveLength(1);
  await processRun(e, rid); await run(id);
  expect(await events(id)).toHaveLength(1); expect(aiRun).toHaveBeenCalledOnce();
  expect((await runs(id)).map(r => r.status)).toContain('unchanged');
});
it('refuses oversized pages instead of silently ignoring a change beyond the excerpt', async () => {
  const id = await create(); page = '<p>' + 'x'.repeat(12001) + '</p>'; await run(id);
  expect((await runs(id))[0]).toMatchObject({ status: 'failed' });
  expect(aiRun).not.toHaveBeenCalled(); expect(await events(id)).toHaveLength(0);
});
it('negative/low-confidence decisions are runs, not events', async () => {
  const id = await create(); await run(id);
  page = '<h1>Pricing $90 — refreshed layout</h1>';
  aiRun.mockResolvedValueOnce(decision(false, 0.9, 'Layout only.'));
  await run(id); expect(await events(id)).toHaveLength(0);
  page = '<h1>Pricing maybe $40</h1>';
  aiRun.mockResolvedValueOnce(decision(true, 0.4, 'Uncertain.'));
  await run(id); expect(await events(id)).toHaveLength(0);
});
it('coalesces manual runs and recovers persisted outbox after send failure', async () => {
  const id = await create(); queueSend.mockRejectedValueOnce(Error('Queue unavailable'));
  const rid = await enqueueRun(e, id);
  expect(await enqueueRun(e, id)).toBe(rid);
  await bindings.DB.prepare('UPDATE watch_runs SET enqueued_at=NULL WHERE id=?').bind(rid).run();
  queueSend.mockClear(); await schedule(e); expect(queueSend).toHaveBeenCalledWith({ kind: 'run', id: rid });
  await Promise.all([processRun(e, rid), processRun(e, rid)]);
  expect((await runs(id))[0].status).toBe('baseline');
});
it('transient errors retry, permanent HTTP errors finish and are observable', async () => {
  const id = await create(); const rid = await enqueueRun(e, id); pageStatus = 503;
  await expect(processRun(e, rid)).rejects.toThrow('503');
  expect((await runs(id))[0]).toMatchObject({ status: 'retry', http_status: 503 });
  pageStatus = 200; await processRun(e, rid); expect((await runs(id))[0].status).toBe('baseline');
  pageStatus = 404; await run(id); const failed = (await runs(id)).find(r => r.status === 'failed');
  expect(failed?.error).toContain('404');
});
it('invalid AI output leaves baseline unchanged for retry', async () => {
  const id = await create(); await run(id); page = '<h1>New plan $40</h1>';
  aiRun.mockResolvedValueOnce({ response: { matched: 'false', confidence: 0.95, event_type: 'price_changed', summary: 'Bad.' } } as never);
  const rid = await enqueueRun(e, id);
  await expect(processRun(e, rid)).rejects.toThrow('invalid result'); expect(await events(id)).toHaveLength(0);
  await processRun(e, rid); expect(await events(id)).toHaveLength(1);
});
it('webhook retry is independent, deduplicated and sends idempotency key', async () => {
  const id = await create({ webhook: 'https://hooks.public.com/events' }); await run(id);
  page = '<h1>New plan $40</h1>'; const rid = await run(id);
  const event = (await events(id))[0] as { id: string };
  webhookStatus = 503; await expect(deliverWebhook(e, event.id)).rejects.toThrow('503');
  await bindings.DB.prepare('UPDATE events SET delivery_next_at=NULL WHERE id=?').bind(event.id).run();
  webhookStatus = 200; await deliverWebhook(e, event.id); await deliverWebhook(e, event.id); await processRun(e, rid);
  expect(webhookPosts).toHaveLength(2);
  expect(webhookPosts[1].headers).toHaveProperty('idempotency-key', event.id);
  expect((await events(id))[0]).toHaveProperty('delivery_status', 'delivered');
});
it('expired consumer is fenced out after another attempt commits', async () => {
  const id = await create(); await run(id); page = '<h1>New plan $40</h1>';
  let resolve!: (value: Awaited<ReturnType<typeof aiRun>>) => void;
  const delayed = new Promise<Awaited<ReturnType<typeof aiRun>>>(r => { resolve = r; });
  aiRun.mockImplementationOnce(() => delayed);
  const rid = await enqueueRun(e, id), first = processRun(e, rid);
  for (let i = 0; i < 100 && aiRun.mock.calls.length === 0; i++) await new Promise(r => setTimeout(r, 5));
  expect(aiRun).toHaveBeenCalledOnce();
  await bindings.DB.prepare('UPDATE watch_runs SET lease_until=? WHERE id=?').bind('2000-01-01T00:00:00.000Z', rid).run();
  await processRun(e, rid);
  resolve(decision(true, 0.95, 'Old consumer.'));
  await first;
  expect(await events(id)).toHaveLength(1);
  expect((await events(id))[0]).toHaveProperty('summary', 'New plan $40.');
});
it('retry exhaustion becomes an observable terminal failure', async () => {
  const id = await create(), rid = await enqueueRun(e, id); pageStatus = 503;
  for (let i = 0; i < 4; i++) await expect(processRun(e, rid)).rejects.toThrow();
  await processRun(e, rid); expect((await runs(id))[0].status).toBe('failed');
});
it('Queue consumer acknowledges successful jobs and retries transient failures', async () => {
  const id = await create(), rid = await enqueueRun(e, id);
  const message = { body: { kind: 'run', id: rid }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
  pageStatus = 503; await consume({ messages: [message] } as never, e);
  expect(message.retry).toHaveBeenCalled(); expect(message.ack).not.toHaveBeenCalled();
  pageStatus = 200; await consume({ messages: [message] } as never, e); expect(message.ack).toHaveBeenCalled();
});
it('manual API is asynchronous, strict auth/schema and deletion cascades', async () => {
  const unauthorized = await api('/v1/watches', 'GET', undefined, false);
  expect(unauthorized.status).toBe(401);
  expect(await unauthorized.json()).toEqual({ error: { code: 'unauthorized', message: 'Missing or invalid API key.' } });
  expect((await api('/v1/watch', 'POST', { url: 'https://public.com', condition: 'test', use_browser: 'false' })).status).toBe(400);
  expect((await api('/v1/watch', 'POST', { url: 'http://127.0.0.1', condition: 'test' })).status).toBe(400);
  const id = await create(); expect((await api(`/v1/watch/${id}/run`, 'POST')).status).toBe(202);
  await api(`/v1/watch/${id}`, 'DELETE');
  expect((await api(`/v1/watch/${id}`)).status).toBe(404);
  expect((await bindings.DB.prepare('SELECT COUNT(*) AS n FROM watch_runs').first<{ n: number }>())?.n).toBe(0);
});
it('pause cancels queued work, rejects manual runs and resume preserves baseline', async () => {
  const id = await create(); await run(id);
  const before = await (await api(`/v1/watch/${id}`)).json() as { last_hash: string };
  const rid = await enqueueRun(e, id);
  expect((await api(`/v1/watch/${id}`, 'PATCH', { status: 'paused' })).status).toBe(200);
  await processRun(e, rid);
  expect((await runs(id))[0]).toMatchObject({ status: 'failed', error: 'Cancelled: watch paused.' });
  expect((await api(`/v1/watch/${id}/run`, 'POST')).status).toBe(409);
  queueSend.mockClear(); await schedule(e); expect(queueSend).not.toHaveBeenCalled();
  expect((await api(`/v1/watch/${id}`, 'PATCH', { status: 'active' })).status).toBe(200);
  const resumed = await (await api(`/v1/watch/${id}`)).json() as { last_hash: string };
  expect(resumed.last_hash).toBe(before.last_hash);
  await run(id); expect((await runs(id))[0].status).toBe('unchanged');
  expect((await api(`/v1/watch/${id}`, 'PATCH', { status: 'broken' })).status).toBe(400);
});
it('pausing during inference fences out baseline/event commits', async () => {
  const id = await create(); await run(id); page = '<h1>New plan $40</h1>';
  let resolve!: (value: ReturnType<typeof decision>) => void;
  aiRun.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const rid = await enqueueRun(e, id), pending = processRun(e, rid);
  for (let i = 0; i < 100 && !resolve; i++) await new Promise(r => setTimeout(r, 5));
  expect(resolve).toBeTypeOf('function');
  await api(`/v1/watch/${id}`, 'PATCH', { status: 'paused' });
  resolve(decision()); await pending;
  expect(await events(id)).toHaveLength(0);
  const metadata = await (await api(`/v1/watch/${id}`)).json() as { status: string; latest_run: { status: string; ai_calls: number } };
  expect(metadata).toMatchObject({ status: 'paused', latest_run: { status: 'failed', ai_calls: 1 } });
});
it('latest run, validated evidence and AI call counts are exposed without baseline text', async () => {
  const id = await create(); await run(id); page = '<h1>New plan $40</h1>'; await run(id);
  const watch = await (await api(`/v1/watch/${id}`)).json() as Record<string, unknown>;
  expect(watch).not.toHaveProperty('last_content');
  expect(watch).toMatchObject({ latest_run: { status: 'matched', ai_calls: 1, evaluation: { evidence: { before: '$90', after: '$40' } } } });
  expect((await events(id))[0]).toMatchObject({ evidence: { before: '$90', after: '$40' } });
  await run(id);
  const list = await (await api('/v1/watches')).json() as { latest_run: { status: string; ai_calls: number; fetch_ms: number } }[];
  expect(list[0].latest_run).toMatchObject({ status: 'unchanged', ai_calls: 0 });
  expect(list[0].latest_run.fetch_ms).toBeGreaterThanOrEqual(0);
});
it('browser fallback errors retain the actual attempted mode', async () => {
  const id = await create(); page = '<div id="root"></div><script src="app.js"></script>';
  browser.mockRejectedValueOnce(Error('Renderer temporarily unavailable'));
  const rid = await enqueueRun(e, id);
  await expect(processRun(e, rid)).rejects.toThrow('temporarily unavailable');
  expect((await runs(id))[0]).toMatchObject({ status: 'retry', fetch_mode: 'browser' });
});
it('Browser Quick Action opt-in/fallback uses restricted origin and structured envelope', async () => {
  const id = await create({ use_browser: true }); await run(id);
  expect(browser).toHaveBeenCalledWith('markdown', expect.objectContaining({ rejectRequestPattern: expect.any(Array) }));
  expect((await runs(id))[0].fetch_mode).toBe('browser');
  const id2 = await create(); page = '<div id="root"></div><script src="app.js"></script>'; await run(id2);
  expect(browser).toHaveBeenCalledTimes(2);
});

describe('security and parsing', () => {
  it.each(['http://localhost', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://10.1.2.3', 'http://172.31.1.2', 'http://192.168.1.1', 'http://169.254.169.254', 'http://[::1]', 'http://[fc00::1]', 'http://[fe80::1]', 'http://[::ffff:127.0.0.1]', 'http://100.64.0.1', 'http://192.0.2.1', 'http://224.1.1.1', 'http://0.0.0.0', 'https://public.com:22', 'https://user:pass@public.com', 'file:///etc/passwd'])('blocks %s', value => { expect(() => validateUrl(value)).toThrow(); });
  it('allows public addresses and blocks private DNS and redirect SSRF', async () => {
    expect(publicIp('8.8.8.8')).toBe(true); expect(publicIp('2606:4700:4700::1111')).toBe(true);
    globalThis.fetch = vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 1, data: '10.0.0.1' }] })) as typeof fetch;
    await expect(assertPublicUrl('https://public.com')).rejects.toThrow('non-public');
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })) as typeof fetch;
    await expect(safeFetch('https://8.8.8.8/')).rejects.toThrow('public destination');
    await expect(safeFetch('https://8.8.8.8/', { method: 'POST', body: '{}' })).rejects.toThrow('webhook');
  });
  it('does not coerce AI booleans/confidence', () => {
    expect(() => parseEvaluation({ matched: 'false', confidence: 0.9, summary: 'x' })).toThrow();
    expect(() => parseEvaluation({ matched: true, confidence: 2, summary: 'x' })).toThrow();
    expect(() => parseEvaluation('not json')).toThrow();
    expect(parseEvaluation({ response: '{"matched":false,"confidence":0.9,"summary":"Noise","reason":"No relevant change","event_type":"semantic_change","evidence":{"before":null,"after":null}}' }).matched).toBe(false);
  });
  it('normalizes scripts and recognizes shells, not ordinary short text', () => {
    expect(normalizeHtml('<style>x</style><script>alert(1)</script><p>A &amp; B</p>')).toBe('A & B');
    expect(insufficientHtml('<script src="app.js"></script>', '')).toBe(true);
    expect(insufficientHtml('<p>Price $40</p>', 'Price $40')).toBe(false);
  });
});

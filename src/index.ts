import { z } from 'zod';
import type { Env, Job, WatchRow } from './types';
import { consume, enqueueRun, schedule } from './jobs';
import { AppError, assertPublicUrl, readLimited, validateUrl } from './security';
import { corsHeaders, json, nowIso } from './util';
import { APP_HTML } from './dashboard';
import { watchSelect, watchResponse, runResponse, eventResponse } from './metadata';
import { saveReview } from './reviews';
import { activityReport } from './report';

export const createWatchSchema = z.object({
  url: z.string().max(2048),
  condition: z.string().trim().min(3).max(1000),
  interval_minutes: z.number().int().min(5).max(10080).default(60),
  use_browser: z.boolean().default(false),
  webhook: z.string().max(2048).optional(),
  webhook_url: z.string().max(2048).optional()
}).strict().refine(b => !(b.webhook && b.webhook_url), { message: 'Use either webhook or webhook_url, not both.' });

async function bodyJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > 8192) throw new AppError('invalid_payload', 'Request body is too large.', 413);
  let text: string;
  try { text = await readLimited(new Response(request.body), 8192); }
  catch { throw new AppError('invalid_payload', 'Request body is too large or could not be read.', 413); }
  try { return JSON.parse(text); } catch { throw new AppError('invalid_json', 'Invalid JSON.'); }
}

async function api(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'watchagent' });
    if (request.method === 'GET' && url.pathname === '/') return new Response(APP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    if (!env.API_KEY) throw new AppError('auth_not_configured', 'API authentication is not configured.', 503);
    if (request.headers.get('authorization') !== `Bearer ${env.API_KEY}`) throw new AppError('unauthorized', 'Missing or invalid API key.', 401);

    if (env.LOCAL_FIXTURES === 'true' && url.pathname === '/__dev/page' && request.method === 'POST') {
      const body = z.object({ content: z.string().min(1).max(5000) }).parse(await bodyJson(request));
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS local_fixture(id INTEGER PRIMARY KEY,content TEXT NOT NULL)').run();
      await env.DB.prepare('INSERT INTO local_fixture(id,content) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content').bind(body.content).run();
      return json({ ok: true });
    }
    if (url.pathname === '/v1/watch' && request.method === 'POST') {
      const body = createWatchSchema.parse(await bodyJson(request));
      validateUrl(body.url);
      if (!(env.LOCAL_FIXTURES === 'true' && new URL(body.url).hostname === 'fixture.watchagent.dev')) await assertPublicUrl(body.url);
      const webhook = body.webhook ?? body.webhook_url ?? null;
      if (webhook) await assertPublicUrl(webhook);
      const id = `watch_${crypto.randomUUID()}`, time = nowIso();
      await env.DB.prepare(`INSERT INTO watches(id,url,condition,interval_minutes,use_browser,webhook_url,next_run_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(id, new URL(body.url).href, body.condition, body.interval_minutes, body.use_browser ? 1 : 0, webhook, time, time, time).run();
      return json({ id, status: 'active', next_run_at: time }, 201);
    }
    if (url.pathname === '/v1/watches' && request.method === 'GET') {
      const rows = await env.DB.prepare(watchSelect + ' ORDER BY w.created_at DESC LIMIT 100').all();
      return json(rows.results.map(watchResponse));
    }
    if (url.pathname === '/v1/events' && request.method === 'GET') return listEvents(env, url.searchParams.get('watch_id'));
    if (url.pathname === '/v1/report' && request.method === 'GET') return json(await activityReport(env, url.searchParams));
    const review = /^\/v1\/(event|run)\/([^/]+)\/review$/.exec(url.pathname);
    if (review && request.method === 'POST') return json(await saveReview(env, review[1] as 'event' | 'run', review[2], await bodyJson(request)));
    const match = /^\/v1\/watch\/([^/]+)(?:\/(run|events|runs))?$/.exec(url.pathname);
    if (match) {
      const [, id, action] = match;
      const watch = await env.DB.prepare('SELECT * FROM watches WHERE id=?').bind(id).first<WatchRow>();
      if (!watch) throw new AppError('not_found', 'Watch not found.', 404);
      if (request.method === 'GET' && !action) {
        const metadata = await env.DB.prepare(watchSelect + ' WHERE w.id=?').bind(id).first<Record<string, unknown>>();
        return json(watchResponse(metadata!));
      }
      if (request.method === 'PATCH' && !action) {
        const body = z.object({ status: z.enum(['active', 'paused']) }).strict().parse(await bodyJson(request));
        const time = nowIso();
        if (body.status === 'paused') {
          // Cancel pending work and revoke in-flight fencing tokens atomically.
          // Delivery of events already persisted remains independent of watch scheduling.
          await env.DB.batch([
            env.DB.prepare(`UPDATE watches SET status='paused',enabled=0,updated_at=? WHERE id=?`).bind(time, id),
            env.DB.prepare(`UPDATE watch_runs SET status='failed',error='Cancelled: watch paused.',finished_at=?,lease_until=NULL,token=NULL WHERE watch_id=? AND status IN ('queued','retry','running')`).bind(time, id)
          ]);
        } else if (watch.status !== 'active') {
          await env.DB.prepare(`UPDATE watches SET status='active',enabled=1,next_run_at=?,updated_at=? WHERE id=?`).bind(time, time, id).run();
        }
        return json({ id, status: body.status });
      }
      if (request.method === 'DELETE' && !action) {
        await env.DB.prepare('DELETE FROM watches WHERE id=?').bind(id).run();
        return json({ deleted: true, id });
      }
      if (request.method === 'POST' && action === 'run') return json({ run_id: await enqueueRun(env, id), status: 'queued' }, 202);
      if (request.method === 'GET' && action === 'events') return listEvents(env, id);
      if (request.method === 'GET' && action === 'runs') {
        const rows = await env.DB.prepare(`SELECT id,watch_id,status,created_at,started_at,finished_at,attempts,http_status,fetch_mode,content_hash,evaluation_json,error,ai_calls,fetch_ms,ai_ms,(SELECT json_object('verdict',v.verdict,'note',v.note,'created_at',v.created_at,'updated_at',v.updated_at) FROM run_reviews v WHERE v.run_id=watch_runs.id) AS review_json FROM watch_runs WHERE watch_id=? ORDER BY created_at DESC,id DESC LIMIT 100`).bind(id).all();
        return json(rows.results.map(runResponse));
      }
    }
    throw new AppError('not_found', 'Endpoint not found.', 404);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: { code: 'invalid_payload', message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') } }, 400);
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    console.error('api_failed', String(error));
    return json({ error: { code: 'internal_error', message: 'Internal error. Please try again.' } }, 500);
  }
}

async function listEvents(env: Env, watchId: string | null): Promise<Response> {
  const columns = 'id,watch_id,run_id,event_type,summary,confidence,old_excerpt,new_excerpt,old_hash,new_hash,created_at,delivered_at,delivery_status,delivery_attempts,delivery_error,evidence_json,(SELECT json_object(\'verdict\',v.verdict,\'note\',v.note,\'created_at\',v.created_at,\'updated_at\',v.updated_at) FROM event_reviews v WHERE v.event_id=events.id) AS review_json';
  const rows = await (watchId
    ? env.DB.prepare(`SELECT ${columns} FROM events WHERE watch_id=? ORDER BY created_at DESC LIMIT 100`).bind(watchId)
    : env.DB.prepare(`SELECT ${columns} FROM events ORDER BY created_at DESC LIMIT 100`)).all();
  return json(rows.results.map(eventResponse));
}

export default {
  fetch: api,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> { await schedule(env); },
  async queue(batch: MessageBatch<Job>, env: Env): Promise<void> { await consume(batch, env); }
} satisfies ExportedHandler<Env, Job>;

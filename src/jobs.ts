import type { Env, Job, RunRow, WatchRow } from './types';
import { addMinutesIso, excerpt, nowIso, sha256 } from './util';
import { fetchContent } from './content';
import { evaluateChange, shouldEmit } from './evaluation';
import { AppError, checkHttp, safeFetch } from './security';

export async function enqueueRun(env: Env, watchId: string): Promise<string> {
  const id = `run_${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT OR IGNORE INTO watch_runs(id,watch_id,created_at)
    SELECT ?,id,? FROM watches WHERE id=? AND status='active'`).bind(id, nowIso(), watchId).run();
  const run = await env.DB.prepare(`SELECT r.id FROM watch_runs r JOIN watches w ON w.id=r.watch_id WHERE r.watch_id=? AND w.status='active' AND r.status IN ('queued','running','retry')`).bind(watchId).first<{ id: string }>();
  if (!run) throw new AppError('watch_inactive', 'Watch is not active.', 409);
  try { await sendRun(env, run.id); } catch (error) { console.error('queue_send_failed', run.id, String(error)); }
  return run.id;
}

async function sendRun(env: Env, id: string): Promise<void> {
  await env.JOBS.send({ kind: 'run', id });
  await env.DB.prepare('UPDATE watch_runs SET enqueued_at=? WHERE id=?').bind(nowIso(), id).run();
}

export async function schedule(env: Env): Promise<void> {
  const due = await env.DB.prepare(`SELECT id FROM watches w WHERE status='active' AND next_run_at<=?
    AND NOT EXISTS (SELECT 1 FROM watch_runs r WHERE r.watch_id=w.id AND r.status IN ('queued','running','retry'))
    ORDER BY next_run_at LIMIT 50`).bind(nowIso()).all<{ id: string }>();
  for (const watch of due.results) await enqueueRun(env, watch.id);
  // D1 is the outbox: recover a crash between persistence and Queue send, lost
  // acknowledgments, exhausted Queue retries and expired consumer leases.
  const pending = await env.DB.prepare(`SELECT id FROM watch_runs WHERE status IN ('queued','retry','running')
    AND (enqueued_at IS NULL OR enqueued_at<?) AND (lease_until IS NULL OR lease_until<?) LIMIT 50`)
    .bind(addMinutesIso(-10), nowIso()).all<{ id: string }>();
  for (const run of pending.results) await sendRun(env, run.id);
  const deliveries = await env.DB.prepare(`SELECT e.id FROM events e JOIN watches w ON w.id=e.watch_id
    WHERE w.webhook_url IS NOT NULL AND e.delivery_status='pending' AND (delivery_next_at IS NULL OR delivery_next_at<=?)
    AND (delivery_lease_until IS NULL OR delivery_lease_until<?) LIMIT 50`).bind(nowIso(), nowIso()).all<{ id: string }>();
  for (const event of deliveries.results) await env.JOBS.send({ kind: 'webhook', id: event.id });
}

export async function processRun(env: Env, id: string): Promise<void> {
  const token = crypto.randomUUID();
  const claim = await env.DB.prepare(`UPDATE watch_runs SET status='running',token=?,lease_until=?,started_at=?,attempts=attempts+1
    WHERE id=? AND status IN ('queued','retry','running') AND (lease_until IS NULL OR lease_until<?) RETURNING *`)
    .bind(token, addMinutesIso(5), nowIso(), id, nowIso()).first<RunRow>();
  if (!claim) return; // duplicate or another consumer owns the lease
  const watch = await env.DB.prepare('SELECT * FROM watches WHERE id=?').bind(claim.watch_id).first<WatchRow>();
  if (!watch) return; // deletion cascades the run
  try {
    if (claim.attempts > 5) throw new AppError('attempts_exhausted', 'Maximum retry attempts reached.');
    if (watch.status !== 'active') throw new AppError('watch_inactive', 'Watch is not active.');
    const fetchStarted = Date.now();
    const content = await fetchContent(env, watch, async mode => {
      await env.DB.prepare(`UPDATE watch_runs SET fetch_mode=? WHERE id=? AND token=? AND status='running'`).bind(mode, id, token).run();
    }).finally(async () => {
      await env.DB.prepare(`UPDATE watch_runs SET fetch_ms=? WHERE id=? AND token=? AND status='running'`).bind(Date.now() - fetchStarted, id, token).run();
    });
    if (!content.text) throw new AppError('empty_content', 'The page is empty.', 502, true);
    // Hash all bounded fetched content, not just the AI excerpt. No HTML blobs in D1.
    const hash = await sha256(content.text);
    const max = Math.min(12000, Math.max(1000, Number(env.MAX_CONTENT_CHARS) || 12000));
    // Never silently classify a truncated page: this could miss the actual change.
    if (content.text.length > max) throw new AppError('content_too_large', `Normalized text exceeds ${max} characters. Targeted extraction or snapshot storage is required.`);
    const text = content.text;
    await env.DB.prepare(`UPDATE watch_runs SET http_status=?,fetch_mode=?,content_hash=? WHERE id=? AND token=?`)
      .bind(content.status, content.mode, hash, id, token).run();
    let evaluation = null;
    if (watch.last_hash && watch.last_hash !== hash) {
      await env.DB.prepare(`UPDATE watch_runs SET ai_calls=COALESCE(ai_calls,0)+1 WHERE id=? AND token=? AND status='running'`).bind(id, token).run();
      const aiStarted = Date.now();
      evaluation = await evaluateChange(env, watch, (watch.last_content ?? '').slice(0, max), text).finally(async () => {
        await env.DB.prepare(`UPDATE watch_runs SET ai_ms=? WHERE id=? AND token=? AND status='running'`).bind(Date.now() - aiStarted, id, token).run();
      });
    }
    const matched = evaluation !== null && shouldEmit(evaluation);
    const status = !watch.last_hash ? 'baseline' : watch.last_hash === hash ? 'unchanged' : matched ? 'matched' : 'not_matched';
    const time = nowIso();
    const eventId = `evt_${crypto.randomUUID()}`;
    const payload = { id: eventId, watch_id: watch.id, run_id: id, url: watch.url,
      condition: watch.condition, created_at: time, old_hash: watch.last_hash, new_hash: hash, ...evaluation };
    const statements: D1PreparedStatement[] = [];
    if (matched && evaluation) statements.push(env.DB.prepare(`INSERT INTO events
      (id,watch_id,run_id,detected_at,created_at,matched,event_type,summary,confidence,old_excerpt,new_excerpt,old_hash,new_hash,payload_json,delivery_status,evidence_json)
      SELECT ?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,? FROM watch_runs WHERE id=? AND token=? AND status='running'`)
      .bind(eventId, watch.id, id, time, time, evaluation.event_type, evaluation.summary, evaluation.confidence,
        excerpt(watch.last_content), excerpt(text), watch.last_hash, hash, JSON.stringify(payload), watch.webhook_url ? 'pending' : 'not_required', JSON.stringify(evaluation.evidence), id, token));
    statements.push(
      env.DB.prepare(`UPDATE watches SET last_hash=?,last_content=?,last_checked_at=?,next_run_at=?,updated_at=? WHERE id=?
        AND EXISTS(SELECT 1 FROM watch_runs WHERE id=? AND token=? AND status='running')`)
        .bind(hash, text, time, addMinutesIso(watch.interval_minutes), time, watch.id, id, token),
      env.DB.prepare(`UPDATE watch_runs SET status=?,evaluation_json=?,finished_at=?,lease_until=NULL,error=NULL
        WHERE id=? AND token=? AND status='running'`).bind(status, evaluation ? JSON.stringify(evaluation) : null, time, id, token)
    );
    // D1 batch is atomic. Fencing token prevents an expired consumer from committing.
    await env.DB.batch(statements);
    if (matched && watch.webhook_url) {
      try { await env.JOBS.send({ kind: 'webhook', id: eventId }); } catch (e) { console.error('webhook_enqueue_failed', String(e)); }
    }
  } catch (error) {
    const transient = !(error instanceof AppError) || error.transient;
    const retry = transient && claim.attempts < 5;
    const time = nowIso();
    await env.DB.batch([
      env.DB.prepare(`UPDATE watches SET last_checked_at=?,next_run_at=?,updated_at=? WHERE id=?
        AND EXISTS(SELECT 1 FROM watch_runs WHERE id=? AND token=? AND status='running')`)
        .bind(time, addMinutesIso(watch.interval_minutes), time, watch.id, id, token),
      env.DB.prepare(`UPDATE watch_runs SET status=?,error=?,http_status=COALESCE(?,http_status),finished_at=?,lease_until=NULL
        WHERE id=? AND token=? AND status='running'`)
        .bind(retry ? 'retry' : 'failed', String(error).slice(0, 1000), error instanceof AppError ? error.httpStatus ?? null : null, retry ? null : time, id, token)
    ]);
    if (retry) throw error;
  }
}

export async function deliverWebhook(env: Env, id: string): Promise<void> {
  const token = crypto.randomUUID();
  const event = await env.DB.prepare(`UPDATE events SET delivery_token=?,delivery_lease_until=?,delivery_attempts=delivery_attempts+1
    WHERE id=? AND delivery_status='pending' AND (delivery_lease_until IS NULL OR delivery_lease_until<?)
    AND (delivery_next_at IS NULL OR delivery_next_at<=?) RETURNING *`)
    .bind(token, addMinutesIso(2), id, nowIso(), nowIso()).first<{ watch_id: string; payload_json: string; delivery_attempts: number }>();
  if (!event) return;
  try {
    const watch = await env.DB.prepare('SELECT webhook_url FROM watches WHERE id=?').bind(event.watch_id).first<{ webhook_url: string | null }>();
    if (!watch?.webhook_url) return;
    const response = await safeFetch(watch.webhook_url, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': id, 'user-agent': 'WatchAgent/0.2' }, body: event.payload_json
    });
    await response.body?.cancel();
    checkHttp(response.status);
    await env.DB.prepare(`UPDATE events SET delivered_at=?,delivery_status='delivered',delivery_lease_until=NULL,delivery_error=NULL WHERE id=? AND delivery_token=?`)
      .bind(nowIso(), id, token).run();
  } catch (error) {
    const retry = (!(error instanceof AppError) || error.transient) && event.delivery_attempts < 8;
    await env.DB.prepare(`UPDATE events SET delivery_status=?,delivery_error=?,delivery_lease_until=NULL,delivery_next_at=? WHERE id=? AND delivery_token=?`)
      .bind(retry ? 'pending' : 'failed', String(error).slice(0, 1000), addMinutesIso(Math.min(60, 2 ** event.delivery_attempts)), id, token).run();
    if (retry) throw error;
  }
}

export async function consume(batch: MessageBatch<Job>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      if (message.body.kind === 'run') await processRun(env, message.body.id);
      else if (message.body.kind === 'webhook') await deliverWebhook(env, message.body.id);
      else throw new AppError('invalid_job', 'Invalid job type.');
      message.ack();
    } catch (error) {
      console.error('job_failed', message.body, String(error));
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** Math.min(message.attempts, 5)) });
    }
  }
}

// One indexed latest-run lookup per watch, not one HTTP request per dashboard card.
export const watchSelect = `SELECT w.id,w.url,w.condition,w.interval_minutes,w.use_browser,w.webhook_url,w.status,
  w.last_hash,w.last_checked_at,w.next_run_at,w.created_at,w.updated_at,
  (SELECT json_object('id',r.id,'status',r.status,'created_at',r.created_at,'started_at',r.started_at,
    'finished_at',r.finished_at,'attempts',r.attempts,'http_status',r.http_status,'fetch_mode',r.fetch_mode,
    'error',r.error,'evaluation_json',r.evaluation_json,'ai_calls',r.ai_calls,'fetch_ms',r.fetch_ms,'ai_ms',r.ai_ms,
    'review_json',(SELECT json_object('verdict',v.verdict,'note',v.note,'created_at',v.created_at,'updated_at',v.updated_at) FROM run_reviews v WHERE v.run_id=r.id))
    FROM watch_runs r WHERE r.watch_id=w.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS latest_run_json
  FROM watches w`;

function parseJson(value: unknown): unknown {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}
export function runResponse(row: Record<string, unknown>): Record<string, unknown> {
  const { review_json, ...metadata } = row;
  return { ...metadata, evaluation: parseJson(row.evaluation_json), review: parseJson(review_json) };
}
export function watchResponse(row: Record<string, unknown>): Record<string, unknown> {
  const { latest_run_json, ...metadata } = row;
  const run = parseJson(latest_run_json) as Record<string, unknown> | null;
  return { ...metadata, use_browser: row.use_browser === 1, latest_run: run ? runResponse(run) : null };
}
export function eventResponse(row: Record<string, unknown>): Record<string, unknown> {
  const { evidence_json, review_json, ...metadata } = row;
  return { ...metadata, evidence: parseJson(evidence_json), review: parseJson(review_json) };
}

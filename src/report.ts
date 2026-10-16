import { z } from 'zod';
import type { Env } from './types';
import { AppError } from './security';

const timestamp = z.string().datetime({ offset: true });
const sum = (expression: string) => `COALESCE(SUM(${expression}),0)`;

export async function activityReport(env: Env, params: URLSearchParams): Promise<Record<string, unknown>> {
  const generatedAt = new Date();
  const since = new Date(timestamp.parse(params.get('since') ?? new Date(generatedAt.getTime() - 7 * 86400000).toISOString())).toISOString();
  const until = new Date(timestamp.parse(params.get('until') ?? generatedAt.toISOString())).toISOString();
  const duration = Date.parse(until) - Date.parse(since);
  if (duration <= 0 || duration > 31 * 86400000 || Date.parse(until) > generatedAt.getTime() + 60000) {
    throw new AppError('invalid_range', 'Choose a positive time range of at most 31 days, ending no later than now.', 400);
  }
  // Indexed per-watch aggregates, not the paginated /runs or /events endpoints.
  const rows = await env.DB.prepare(`SELECT w.id,w.url,w.condition,w.status,
    (SELECT json_object(
      'runs',COUNT(*),
      'baseline',${sum("r.status='baseline'")},'unchanged',${sum("r.status='unchanged'")},
      'not_matched',${sum("r.status='not_matched'")},'matched',${sum("r.status='matched'")},
      'pending',${sum("r.status IN ('queued','running','retry')")},
      'failed',${sum("r.status='failed' AND COALESCE(r.error,'') NOT LIKE 'Cancelled:%'")},
      'cancelled',${sum("r.status='failed' AND r.error LIKE 'Cancelled:%'")},
      'attempts',${sum('r.attempts')},'extra_attempts',${sum('MAX(r.attempts-1,0)')},
      'ai_calls',${sum('r.ai_calls')},'ai_calls_unmeasured_runs',${sum('r.ai_calls IS NULL')},
      'fetch_ms_total',${sum('r.fetch_ms')},'fetch_samples',COUNT(r.fetch_ms),
      'ai_ms_total',${sum('r.ai_ms')},'ai_samples',COUNT(r.ai_ms),
      'run_correct',${sum("v.verdict='correct'")},'run_false_negative',${sum("v.verdict='false_negative'")},
      'run_unsure',${sum("v.verdict='unsure'")},
      'run_unreviewed',${sum("r.status IN ('not_matched','unchanged') AND v.run_id IS NULL")}
    ) FROM watch_runs r LEFT JOIN run_reviews v ON v.run_id=r.id
      WHERE r.watch_id=w.id AND r.created_at>=? AND r.created_at<?) AS runs_json,
    (SELECT json_object('events',COUNT(*),
      'event_correct',${sum("v.verdict='correct'")},'event_false_positive',${sum("v.verdict='false_positive'")},
      'event_unsure',${sum("v.verdict='unsure'")},'event_unreviewed',${sum('v.event_id IS NULL')}
    ) FROM events e LEFT JOIN event_reviews v ON v.event_id=e.id
      WHERE e.watch_id=w.id AND e.created_at>=? AND e.created_at<?) AS events_json
    FROM watches w ORDER BY w.created_at DESC,w.id DESC LIMIT 101`).bind(since, until, since, until).all<Record<string, unknown>>();
  const totals: Record<string, number> = Object.fromEntries([
    'runs', 'baseline', 'unchanged', 'not_matched', 'matched', 'pending', 'failed', 'cancelled',
    'attempts', 'extra_attempts', 'ai_calls', 'ai_calls_unmeasured_runs', 'fetch_ms_total', 'fetch_samples',
    'ai_ms_total', 'ai_samples', 'run_correct', 'run_false_negative', 'run_unsure', 'run_unreviewed',
    'events', 'event_correct', 'event_false_positive', 'event_unsure', 'event_unreviewed'
  ].map(key => [key, 0]));
  const watches = rows.results.slice(0, 100).map(row => {
    const { runs_json, events_json, ...metadata } = row;
    const metrics = { ...JSON.parse(String(runs_json)), ...JSON.parse(String(events_json)) } as Record<string, number>;
    for (const [key, value] of Object.entries(metrics)) totals[key] = (totals[key] ?? 0) + value;
    return { ...metadata, ...metrics };
  });
  return {
    since, until, generated_at: generatedAt.toISOString(), watches, totals,
    truncated: rows.results.length > 100, watch_limit: 100,
    scope: 'Currently existing watches only. Runs are selected by creation time; events by event creation time. Attempts, measurements and human reviews are their current values, not a historical billing ledger. Timings describe the last measured attempt of each run. Deleted history is unavailable. Human labels are not independently verified accuracy measurements.'
  };
}

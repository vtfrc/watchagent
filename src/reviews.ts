import { z } from 'zod';
import type { Env } from './types';
import { AppError } from './security';
import { nowIso } from './util';

const eventSchema = z.object({ verdict: z.enum(['correct', 'false_positive', 'unsure']), note: z.string().trim().max(1000).default('') }).strict();
const runSchema = z.object({ verdict: z.enum(['correct', 'false_negative', 'unsure']), note: z.string().trim().max(1000).default('') }).strict();

export async function saveReview(env: Env, kind: 'event' | 'run', id: string, payload: unknown): Promise<Record<string, unknown>> {
  const body = (kind === 'event' ? eventSchema : runSchema).parse(payload);
  // Table/column names are internal constants, never interpolated from request data.
  const parent = kind === 'event' ? 'events' : 'watch_runs';
  const table = kind === 'event' ? 'event_reviews' : 'run_reviews';
  const column = kind === 'event' ? 'event_id' : 'run_id';
  const target = await env.DB.prepare(`SELECT * FROM ${parent} WHERE id=?`).bind(id).first<Record<string, unknown>>();
  if (!target) throw new AppError('not_found', kind === 'event' ? 'Event not found.' : 'Run not found.', 404);
  if (kind === 'run' && !['not_matched', 'unchanged'].includes(String(target.status))) {
    throw new AppError('not_reviewable', 'Only completed non-event decisions can be reviewed here. Review emitted events on their event card.', 409);
  }
  const time = nowIso();
  const row = await env.DB.prepare(`INSERT INTO ${table}(${column},verdict,note,created_at,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(${column}) DO UPDATE SET verdict=excluded.verdict,note=excluded.note,updated_at=excluded.updated_at
    RETURNING verdict,note,created_at,updated_at`).bind(id, body.verdict, body.note, time, time).first<Record<string, unknown>>();
  return row!;
}

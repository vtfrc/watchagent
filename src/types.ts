export interface Env {
  DB: D1Database;
  AI: Ai;
  BROWSER: BrowserRun;
  JOBS: Queue<Job>;
  API_KEY?: string;
  AI_MODEL: string;
  MAX_CONTENT_CHARS: string;
  // Deterministic local development only; absent from production configuration.
  LOCAL_FIXTURES?: string;
}

export type Job = { kind: 'run'; id: string } | { kind: 'webhook'; id: string };
export interface WatchRow {
  id: string;
  url: string;
  condition: string;
  webhook_url: string | null;
  interval_minutes: number;
  use_browser: number;
  status: string;
  enabled: number; // legacy storage column; not part of the public API
  last_hash: string | null;
  last_content: string | null;
  last_checked_at: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}
export interface RunRow {
  id: string;
  watch_id: string;
  status: string;
  attempts: number;
  token: string | null;
}
export type EventType = 'plan_launched' | 'price_changed' | 'product_available' | 'semantic_change';
export interface Evaluation {
  matched: boolean;
  confidence: number;
  event_type: EventType;
  summary: string;
  reason: string;
  evidence: { before: string | null; after: string | null };
}

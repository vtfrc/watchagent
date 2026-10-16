PRAGMA foreign_keys = ON;

CREATE TABLE watches (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  condition TEXT NOT NULL,
  webhook_url TEXT,
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  use_browser INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_hash TEXT,
  last_content TEXT,
  last_checked_at TEXT,
  next_run_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_watches_due ON watches(enabled, next_run_at);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  matched INTEGER NOT NULL,
  summary TEXT NOT NULL,
  confidence REAL,
  old_excerpt TEXT,
  new_excerpt TEXT,
  payload_json TEXT,
  FOREIGN KEY (watch_id) REFERENCES watches(id) ON DELETE CASCADE
);

CREATE INDEX idx_events_watch_time ON events(watch_id, detected_at DESC);

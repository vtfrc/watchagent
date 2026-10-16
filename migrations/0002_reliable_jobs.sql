-- Upgrade existing installations without discarding watches/baselines.
ALTER TABLE watches ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
UPDATE watches SET status='paused' WHERE enabled=0;
-- Old MVP snapshots could exceed the new safe semantic input budget.
UPDATE watches SET last_content=NULL,last_hash=NULL WHERE length(last_content)>12000;
CREATE TABLE watch_runs (
 id TEXT PRIMARY KEY,
 watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','retry','baseline','unchanged','matched','not_matched','failed')),
 created_at TEXT NOT NULL,
 started_at TEXT,
 finished_at TEXT,
 enqueued_at TEXT,
 lease_until TEXT,
 token TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 http_status INTEGER,
 fetch_mode TEXT,
 content_hash TEXT,
 evaluation_json TEXT,
 error TEXT
);
CREATE UNIQUE INDEX idx_one_pending_run ON watch_runs(watch_id) WHERE status IN ('queued','running','retry');
CREATE INDEX idx_runs_dispatch ON watch_runs(status,enqueued_at);
ALTER TABLE events ADD COLUMN run_id TEXT REFERENCES watch_runs(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'semantic_change';
ALTER TABLE events ADD COLUMN created_at TEXT;
UPDATE events SET created_at=detected_at;
-- The old MVP stored negative classifications as events; those belong in runs.
DELETE FROM events WHERE matched=0;
ALTER TABLE events ADD COLUMN old_hash TEXT;
ALTER TABLE events ADD COLUMN new_hash TEXT;
ALTER TABLE events ADD COLUMN delivered_at TEXT;
ALTER TABLE events ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE events ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN delivery_error TEXT;
ALTER TABLE events ADD COLUMN delivery_lease_until TEXT;
ALTER TABLE events ADD COLUMN delivery_token TEXT;
ALTER TABLE events ADD COLUMN delivery_next_at TEXT;
CREATE UNIQUE INDEX idx_event_run ON events(run_id);
CREATE INDEX idx_events_delivery ON events(delivery_status,delivery_next_at);

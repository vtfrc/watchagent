ALTER TABLE events ADD COLUMN evidence_json TEXT;
ALTER TABLE watch_runs ADD COLUMN ai_calls INTEGER DEFAULT 0;
-- Historical inference counts were not measured: do not pretend they were zero.
UPDATE watch_runs SET ai_calls=NULL;
ALTER TABLE watch_runs ADD COLUMN fetch_ms INTEGER;
ALTER TABLE watch_runs ADD COLUMN ai_ms INTEGER;
CREATE INDEX idx_runs_watch_created ON watch_runs(watch_id,created_at DESC,id DESC);

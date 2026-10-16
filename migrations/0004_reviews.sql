-- Human judgements are separate from immutable semantic decisions and delivery.
CREATE TABLE event_reviews (
 event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 verdict TEXT NOT NULL CHECK(verdict IN ('correct','false_positive','unsure')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE run_reviews (
 run_id TEXT PRIMARY KEY REFERENCES watch_runs(id) ON DELETE CASCADE,
 verdict TEXT NOT NULL CHECK(verdict IN ('correct','false_negative','unsure')),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=1000),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);

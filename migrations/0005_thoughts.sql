-- Thought of the Month. One row per month (YYYY-MM). Public reads only months up to the current one.
CREATE TABLE thoughts (
  month TEXT PRIMARY KEY,
  quote TEXT NOT NULL,
  emphasis TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  art TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

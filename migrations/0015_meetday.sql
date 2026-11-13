-- Meet Day app: one package per meet + an append-only log of small changes synced between coaches' phones.
CREATE TABLE meetday_meet (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  pkg TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);
CREATE TABLE meetday_op (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  meet_id TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  by_email TEXT NOT NULL,
  by_name TEXT,
  type TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX meetday_op_meet ON meetday_op (meet_id, seq);

-- Small editable blocks (fees, prep-program status). One JSON document per key; defaults live in src/data/site-data-defaults.mjs.
CREATE TABLE site_data (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

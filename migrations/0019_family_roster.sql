-- Team roster and family links (JP, Nov 24 2026). Lets site tools be gated to Active and Alumni team families.
-- Loaded from the results database + Captyn by results-db/import_captyn_roster.py (roster/d1_roster.sql). Private: lives in
-- nsea-carpool only, never in the public data hub.
--  * roster_swimmer: every NSEA member the results database knows, keyed on USA Swimming ID. status comes from the database
--    tags (active / inactive / alumni), never from Captyn, whose Programs column keeps groups a swimmer has left.
--  * roster_family: one sign-in email per family (the Captyn Account Email), plus alumni contacts JP adds.
--  * family_swimmer: which swimmers a family email belongs to. source 'captyn' rows are replaced on each import;
--    'manual' rows (request-and-approve, alumni list) are kept.
CREATE TABLE roster_swimmer (
  usa_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'alumni')),
  grp TEXT
);
CREATE TABLE roster_family (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  family_name TEXT,
  phone TEXT,
  source TEXT NOT NULL DEFAULT 'captyn'
);
CREATE TABLE family_swimmer (
  email TEXT NOT NULL COLLATE NOCASE,
  usa_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('captyn', 'manual')),
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, usa_id)
);
CREATE INDEX family_swimmer_usa ON family_swimmer (usa_id);
CREATE TABLE roster_import (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  exported_at TEXT,
  swimmers INTEGER,
  families INTEGER,
  links INTEGER,
  loaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Access requests now say whether the person is a team family or an alum, and the alum's graduation year.
ALTER TABLE members ADD COLUMN relation TEXT NOT NULL DEFAULT 'family';
ALTER TABLE members ADD COLUMN grad_year INTEGER;

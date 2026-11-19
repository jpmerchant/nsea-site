-- Practice Schedule (admin console: Practice Schedule). The base schedules and check settings are one JSON
-- document in site_data (key 'schedule'); defaults live in src/data/schedule-defaults.mjs.
-- This table holds dated changes on top of the base: suggestions from the weekly check and changes added by hand.

CREATE TABLE sched_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_ref TEXT UNIQUE,                     -- set for suggestions, so a rejected one is never suggested again; NULL for manual
  date TEXT NOT NULL,                         -- YYYY-MM-DD
  group_name TEXT NOT NULL,                   -- Splash ... Senior, or All
  session TEXT NOT NULL DEFAULT 'PM',         -- AM | PM
  kind TEXT NOT NULL,                         -- cancel | time | replace | add | info
  value TEXT NOT NULL DEFAULT '',             -- new time ("4:30 - 6:00") or label ("Rock Gym"); empty for cancel/info
  note TEXT NOT NULL DEFAULT '',              -- optional public note shown with the schedule
  reason TEXT NOT NULL DEFAULT '',            -- why it was suggested / added (admin only)
  source TEXT NOT NULL DEFAULT 'manual',      -- meet | team-event | holiday | school | hs | wsl | reminder | manual
  confidence TEXT NOT NULL DEFAULT 'likely',  -- likely | maybe | fyi
  status TEXT NOT NULL DEFAULT 'suggested',   -- suggested | approved | rejected
  captyn INTEGER NOT NULL DEFAULT 0,          -- 1 once it has been posted in Captyn (Captyn stays the families' source of truth)
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by TEXT,
  decided_at TEXT
);
CREATE INDEX sched_changes_date ON sched_changes (date, status);

-- One row per weekly check (cron, Wednesday night) or "Run the check now".
CREATE TABLE sched_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  problems TEXT NOT NULL DEFAULT '',          -- feeds that could not be read
  by TEXT NOT NULL DEFAULT 'cron'
);

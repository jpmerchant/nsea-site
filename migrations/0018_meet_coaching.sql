-- Meet coaching: coaches mark which sessions of a meet they can coach and whether they need a hotel room;
-- JP (owner / staff role) assigns coaches to sessions and marks the schedule preliminary (sent with the check request)
-- or confirmed (after the meet, what actually happened). Replaces collecting availability in the staff group chat.
-- coaching.json in each meet folder (nsea-ops scripts/meet/meet.py) is exported from here.
CREATE TABLE mc_meets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_on TEXT NOT NULL,              -- YYYY-MM-DD
  end_on TEXT NOT NULL,
  event_id TEXT NOT NULL DEFAULT '',   -- events calendar id (nsea-events data/events.csv), when there is one
  travel INTEGER NOT NULL DEFAULT 1,   -- away meet: assigned coaches claim mileage
  open INTEGER NOT NULL DEFAULT 1,     -- coaches can still answer
  status TEXT NOT NULL DEFAULT 'none', -- none | preliminary | confirmed (the coaching schedule)
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE mc_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meet_id INTEGER NOT NULL REFERENCES mc_meets(id),
  day TEXT NOT NULL,                   -- YYYY-MM-DD
  label TEXT NOT NULL,                 -- e.g. "Prelims", "12 & Under timed finals", "Finals"
  sort INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX mc_sessions_meet ON mc_sessions(meet_id, day, sort);
CREATE TABLE mc_avail (
  session_id INTEGER NOT NULL REFERENCES mc_sessions(id),
  coach_id INTEGER NOT NULL REFERENCES coach_authors(id),
  answer TEXT NOT NULL,                -- yes | maybe | no
  by_email TEXT, at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, coach_id)
);
CREATE TABLE mc_coach (
  meet_id INTEGER NOT NULL REFERENCES mc_meets(id),
  coach_id INTEGER NOT NULL REFERENCES coach_authors(id),
  hotel TEXT NOT NULL DEFAULT '',      -- yes | no | '' (not answered)
  nights TEXT NOT NULL DEFAULT '',     -- comma-separated YYYY-MM-DD (the night starting that day)
  note TEXT NOT NULL DEFAULT '',
  by_email TEXT, at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (meet_id, coach_id)
);
CREATE TABLE mc_assign (
  session_id INTEGER NOT NULL REFERENCES mc_sessions(id),
  coach_id INTEGER NOT NULL REFERENCES coach_authors(id),
  by_email TEXT, at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, coach_id)
);

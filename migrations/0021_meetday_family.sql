-- Meet Day family side (JP, Nov 26 2026). First used by a few test families at 2026 STAR Triad Tropic.
--  * meetday_family_link: a private link for one roster family (roster_family.email). It lasts the season and works at
--    every meet: the family's swimmers are found in each meet by USA Swimming ID (then by name). Coaches make and revoke
--    links in Meet Day › Tools › Families. The token is kept so a coach can copy the link again.
--  * meetday_feedback: what families send from the "Send feedback" box.
--  * meetday_push / meetday_push_sent: phone notifications (trial). A push carries no data; the family app fetches
--    its alerts when one arrives. meetday_push_sent stops the same alert going out twice.
CREATE TABLE meetday_family_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  revoked_at TEXT,
  last_seen_at TEXT,
  views INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX meetday_family_link_email ON meetday_family_link (email);
CREATE TABLE meetday_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  meet_id TEXT,
  page TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE meetday_push (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_ok_at TEXT,
  fails INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX meetday_push_link ON meetday_push (link_id);
CREATE TABLE meetday_push_sent (
  link_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  meet_id TEXT,
  title TEXT,
  body TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (link_id, key)
);
-- Small settings for the family side (the Web Push key pair, made on first use).
CREATE TABLE meetday_setting (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

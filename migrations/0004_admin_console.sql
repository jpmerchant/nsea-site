CREATE TABLE admin_users (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT
);
CREATE TABLE admin_invites (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  admin_email TEXT NOT NULL,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX audit_at ON audit_log (at);
INSERT INTO admin_users (email, name, roles) VALUES ('jp@nseaswim.com', 'JP Merchant', 'owner');

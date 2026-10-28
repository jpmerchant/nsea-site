-- Coach's Corner: staff blog. Authors are managed by editors; a coach's login email links them to their author profile.
CREATE TABLE coach_authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  email TEXT COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX coach_authors_email ON coach_authors(email) WHERE email IS NOT NULL;
CREATE TABLE coach_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES coach_authors(id),
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  groups TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | review | published
  publish_on TEXT NOT NULL,                    -- YYYY-MM-DD; a published post shows from this day
  related_label TEXT NOT NULL DEFAULT '',
  related_url TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX coach_posts_pub ON coach_posts(status, publish_on);
INSERT INTO coach_authors (name, role, bio, photo_url, email) VALUES
 ('JP Merchant', 'Head Coach', '', '/assets/cdn/img/jp_001852.jpg', 'jp@nseaswim.com'),
 ('Devin Lessard', 'Assistant Coach', '', '/assets/cdn/img/devin_074164.jpg', 'devin@nseaswim.com'),
 ('Andy Harrison', 'Assistant Coach', '', '/assets/cdn/img/andy-headshot_060002.jpg', 'andy@nseaswim.com'),
 ('Genny Hauser', 'Assistant Coach', '', '/assets/cdn/img/genny_hs.jpg', 'genny@nseaswim.com');

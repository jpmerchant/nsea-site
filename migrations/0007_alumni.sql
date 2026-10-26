-- Alumni results pilot. Each alumnus has one row; their college-roster-page data is checked daily.
-- marks = latest "Top Marks" snapshot from the school's roster page (JSON). Season notes land in alumni_items as 'pending' until approved.
-- consent = 0 until the alumnus (or family) has said yes to being featured. Nothing shows publicly while consent = 0.
CREATE TABLE alumni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  school TEXT NOT NULL,
  class_year INTEGER,
  base_url TEXT NOT NULL,
  sport_path TEXT NOT NULL,
  roster_url TEXT NOT NULL DEFAULT '',
  current INTEGER NOT NULL DEFAULT 1,
  consent INTEGER NOT NULL DEFAULT 0,
  marks TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'never'
);
CREATE TABLE alumni_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alumni_id INTEGER NOT NULL REFERENCES alumni(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by TEXT,
  UNIQUE (alumni_id, season, text)
);
CREATE INDEX alumni_items_status ON alumni_items (alumni_id, status);
INSERT INTO alumni (slug, name, school, class_year, base_url, sport_path, roster_url)
VALUES ('cole-witmer', 'Cole Witmer', 'University of Alabama', 2024, 'https://rolltide.com', 'swimming-and-diving',
        'https://rolltide.com/sports/swimming-and-diving/roster/cole-witmer/17890');

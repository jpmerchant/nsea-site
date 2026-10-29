-- Athlete Spotlights and Recognition (admin console: Content > Athlete Spotlights / Recognition).
-- Athletes are minors: only a first name (plus a last initial when two share one) is stored, and a spotlight
-- cannot be published until "family OK" is ticked.

CREATE TABLE spotlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  athlete TEXT NOT NULL,                       -- first name (+ last initial if needed)
  group_name TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,                          -- same light formatting as Coach's Corner posts
  photo_url TEXT NOT NULL DEFAULT '',
  photo_alt TEXT NOT NULL DEFAULT '',
  publish_on TEXT NOT NULL,                    -- YYYY-MM-DD; a published spotlight shows from this day
  status TEXT NOT NULL DEFAULT 'draft',        -- draft | published
  family_ok INTEGER NOT NULL DEFAULT 0,        -- family has agreed to the feature
  newsletter_on TEXT,                          -- YYYY-MM-DD it ran in the newsletter (NULL = not used yet)
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX spotlights_pub ON spotlights (status, publish_on);

-- An award is a named kind of recognition (e.g. "Most Improved"). Each month, athletes are added to it.
CREATE TABLE recognition_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per athlete per award per month. count is optional (e.g. sessions attended); it is what lets
-- the site keep running totals, and is the same shape monthly attendance will use later.
CREATE TABLE recognitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  award_id INTEGER NOT NULL REFERENCES recognition_awards(id),
  period TEXT NOT NULL,                        -- YYYY-MM
  athlete TEXT NOT NULL COLLATE NOCASE,
  group_name TEXT NOT NULL DEFAULT '',
  count INTEGER,
  note TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,           -- hide one entry (e.g. a family opts out) without losing it
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (award_id, period, athlete)
);
CREATE INDEX recognitions_period ON recognitions (period);

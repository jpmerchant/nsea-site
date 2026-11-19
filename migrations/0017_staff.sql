-- Coaching staff records. coach_authors stays the single row per coach (Coach's Corner already uses it). This adds:
--  * a private staff record (date of birth, phone, start/end dates, private notes) seen only by owners, the "staff" role
--    and the coach themself (notes are owner/staff only);
--  * publish choices: which profile fields appear on the public Coaching Staff page;
--  * staff_items: accomplishments (on/off deck), memberships and ranks, LSC/national positions, certifications,
--    education and season records, each with a year so the record builds up over time (items are never hard-deleted);
--  * staff_changes: profile edits a coach makes to public-facing fields wait here for an owner/staff OK;
--  * staff_history: every change, with before/after, as the long-term record.
ALTER TABLE coach_authors ADD COLUMN subtitle TEXT NOT NULL DEFAULT '';
ALTER TABLE coach_authors ADD COLUMN groups TEXT NOT NULL DEFAULT '';
ALTER TABLE coach_authors ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE coach_authors ADD COLUMN dob TEXT;
ALTER TABLE coach_authors ADD COLUMN started_on TEXT;
ALTER TABLE coach_authors ADD COLUMN ended_on TEXT;
ALTER TABLE coach_authors ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE coach_authors ADD COLUMN photo_key TEXT;
ALTER TABLE coach_authors ADD COLUMN photo_alt TEXT NOT NULL DEFAULT '';
ALTER TABLE coach_authors ADD COLUMN publish TEXT NOT NULL DEFAULT 'photo,role,subtitle,groups,email,bio';
ALTER TABLE coach_authors ADD COLUMN on_staff_page INTEGER NOT NULL DEFAULT 1;
ALTER TABLE coach_authors ADD COLUMN sort INTEGER NOT NULL DEFAULT 100;
ALTER TABLE coach_authors ADD COLUMN updated_by TEXT;
ALTER TABLE coach_authors ADD COLUMN updated_at TEXT;

CREATE TABLE staff_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER NOT NULL REFERENCES coach_authors(id),
  kind TEXT NOT NULL,                  -- deck | offdeck | membership | position | certification | education | season
  title TEXT NOT NULL,
  org TEXT NOT NULL DEFAULT '',        -- ASCA, NC Swimming, USA Swimming, a university...
  rank TEXT NOT NULL DEFAULT '',       -- e.g. ASCA Level 3, a ranking or award level
  level TEXT NOT NULL DEFAULT '',      -- club | lsc | zone | national | international
  detail TEXT NOT NULL DEFAULT '',
  year INTEGER,                        -- the year it happened, or the first year (season = the fall year, 2026 = 2026-27)
  year_to INTEGER,                     -- last year for memberships/positions; empty = current
  expires_on TEXT,                     -- certifications and memberships
  publish INTEGER NOT NULL DEFAULT 0,  -- show on the staff page
  approved INTEGER NOT NULL DEFAULT 1, -- 0 = a coach asked to publish it and it waits for an OK
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT, removed_by TEXT
);
CREATE INDEX staff_items_coach ON staff_items(coach_id, kind, year);

CREATE TABLE staff_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER NOT NULL REFERENCES coach_authors(id),
  json TEXT NOT NULL,                  -- proposed public-facing fields
  photo_key TEXT,                      -- proposed new photo (R2), if any
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | declined | replaced
  submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by TEXT, decided_at TEXT, note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX staff_changes_status ON staff_changes(status, coach_id);

CREATE TABLE staff_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  by_email TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT                          -- JSON: { before, after } or the item
);
CREATE INDEX staff_history_coach ON staff_history(coach_id, id);

-- Seed from the Coaching Staff page (the old src/content/about/coaching-staff.md, now legacy/coaching-staff.md, as of Nov 2026).
INSERT INTO coach_authors (name, role, email, photo_url) SELECT 'JP Merchant', 'Head Coach', 'jp@nseaswim.com', '/assets/cdn/img/jp_001852.jpg' WHERE NOT EXISTS (SELECT 1 FROM coach_authors WHERE email = 'jp@nseaswim.com');
UPDATE coach_authors SET role = 'Head Coach', subtitle = 'Competitive Team', groups = 'Tidepool,Surge,Senior', phone = '910-338-9455', bio = 'JP grew up in Southeast Michigan, where he swam summer league with Orchard Valley Swim & Racquet Club; USA Club with Birmingham-Bloomfield Atlantis; and high school swim at Detroit Catholic Central. After high school, he attended John Carroll University in Cleveland, Ohio, where he studied Economics and Philosophy and continued swimming. While at JCU, he was part of three Conference Championships Teams and served as co-captain for men’s team.

His coaching experience includes learn to swim for Jenrow Swim America, Head Coach for Cleveland Skating Club, Assistant Swim & Dive Coach for Bethany College, Head Age Group Coach and Lead Swim Instructor for Sports Club Swimming, Head Coach and Swim School Director for Sports Club Swimming, Camp Counselor for Wolverine Swim Camp at the University of Michigan. He moved to Wilmington in 2012 and served as the Head Age Group Coach for Waves of Wilmington, Head Coach for the Marsh Oaks Makos, as well as serving on various North Carolina Swimming camp and team staffs. In addition to NSEASwim, he works with the Without Limits Swim programs.', photo_url = CASE WHEN photo_url = '' THEN '/assets/cdn/img/jp_001852.jpg' ELSE photo_url END, publish = 'photo,role,subtitle,groups,email,bio,phone', sort = 10 WHERE email = 'jp@nseaswim.com';
INSERT INTO coach_authors (name, role, email, photo_url) SELECT 'Devin Lessard', 'Assistant Coach', 'devin@nseaswim.com', '/assets/cdn/img/devin_074164.jpg' WHERE NOT EXISTS (SELECT 1 FROM coach_authors WHERE email = 'devin@nseaswim.com');
UPDATE coach_authors SET role = 'Assistant Coach', subtitle = 'Founding Head Coach', groups = 'Splash,Riptide,Dryland', phone = '', bio = 'Devin is a founding member of NSEA Swim and was Head Coach for two years. She helped lead the Cape Fear Aquatic Club swimmers from a 16th place finish in Spring 2017 to a 12th place finish in Spring 2018 at the NC SCY Age Group Championships. She was also the primary coach for the best 9-10-year-old boy swimmer in NC, the best 9-10-year-old boy in the ESSZ sectionals, a swimmer with a top 10 time in 50 Fly in USA Swimming and multiple swimmers with top 5 all-time records in the state. Devin was also Assistant Coach for the Pine Valley Porpoises. Devin''s success has not gone unnoticed. She was nominated for North Carolina Age Group Coach of the Year by her peers for her success during the 2017-18 swim season.

Devin grew up being a multi-sport athlete. She started swimming early and at 13 years old, she qualified for Y-Nationals both individually and as part of top 16 relay team. In high school, Devin was named Female swimmer of the year 3 years in a row. In addition to being Captain of the schools'' field hockey, swim and girls'' lacrosse teams, her senior year swimming was always a special love leading her high school team to a state championship title. She went four years without a loss in individual dual-meet competition, and finished with eight state titles -- four individual, and four relay. In 2014, she was inducted into her high school''s sports hall of fame.

Devin holds a level 2 ASCA certification. She also has degrees in Psychology and Public Relations from Susquehanna University. While there, she was named Landmark Conference Rookie of the Year her freshman year and Female Swimmer of the Year both her junior and senior years. Devin capped off her college career year by placing 5th in the 200 fly at the 2013 NCAA Championships and earning an All-American Swimmer title.

In addition to her coaching duties at NSEA Swim, Devin is a Physical Therapy Assistant. Her goal is to be able to provide aquatic therapy to rehabilitate, prevent and maintain the specific needs of swimmers of all ages.', photo_url = CASE WHEN photo_url = '' THEN '/assets/cdn/img/devin_074164.jpg' ELSE photo_url END, publish = 'photo,role,subtitle,groups,email,bio', sort = 20 WHERE email = 'devin@nseaswim.com';
INSERT INTO coach_authors (name, role, email, photo_url) SELECT 'Andy Harrison', 'Assistant Coach', 'andy@nseaswim.com', '/assets/cdn/img/andy-headshot_060002.jpg' WHERE NOT EXISTS (SELECT 1 FROM coach_authors WHERE email = 'andy@nseaswim.com');
UPDATE coach_authors SET role = 'Assistant Coach', subtitle = 'Founding Coach', groups = 'Riptide,Dryland', phone = '', bio = 'Andy Harrison has been coaching with Northside Elite Aquatics (NSEA) since 2019, bringing over a decade of experience coaching swimmers in Wilmington, NC. His background includes working with Seahawk Swim School, year-round programs, the Wilmington Swim League, and serving as Head Coach for the Pine Valley Country Club summer team.

A lifelong athlete, Andy gravitated toward swimming early on and competed throughout middle and high school. He continued his involvement at the collegiate level with the UNCW club team, where he began shifting his focus toward instruction and athlete development.

Andy earned his Ph.D. in Health and Human Performance and currently serves as a faculty member in the Healthful Living and Fitness Education (HFE) program at the University of North Carolina Wilmington. He also holds a Master of Arts in Teaching (MAT) in Health and Physical Education and a B.S. in Exercise Science. In addition to his academic and coaching roles, Andy is a certified USA Swimming Coach and holds the Certified Strength and Conditioning Specialist (CSCS) credential through the National Strength and Conditioning Association (NSCA).

When not on the pool deck, you can find Andy surfing, rock climbing, or spending time with his wife and three children.', photo_url = CASE WHEN photo_url = '' THEN '/assets/cdn/img/andy-headshot_060002.jpg' ELSE photo_url END, publish = 'photo,role,subtitle,groups,email,bio', sort = 30 WHERE email = 'andy@nseaswim.com';
INSERT INTO coach_authors (name, role, email, photo_url) SELECT 'Genny Hauser', 'Assistant Coach', 'genny@nseaswim.com', '/assets/cdn/img/genny_hs.jpg' WHERE NOT EXISTS (SELECT 1 FROM coach_authors WHERE email = 'genny@nseaswim.com');
UPDATE coach_authors SET role = 'Assistant Coach', subtitle = '', groups = 'Breakers,Surge', phone = '', bio = 'Genny is from Raleigh, NC and grew up swimming competitively for the Marlins of Raleigh swim team. She came to Wilmington and started school at UNCW in 2020, where she was on the swim and dive team her freshman year and competed for the schools club swim team at the national level her remaining years in college.

Genny graduated with a Bachelor of Arts degree in May of 2025 and majored in healthful living and fitness education, concentrating in lifetime fitness. During her last semester of school, Genny completed a 100 hour internship with NSEA where she was introduced to coaching swimmers. During her internship she had the opportunity to work as a part of a research team, studying ways to enhance feedback that coaches can give to swimmers using various forms of technology. Genny is listed as a co-author for the study which is now in consideration for publication in the International Journal of Sport Science & Coaching.

Genny is a certified water safety instructor and also coaches UNCW’s club swim team. She enjoys being outside and in nature during her free time, puzzles, trying new restaurants, football season, and seeing live music.', photo_url = CASE WHEN photo_url = '' THEN '/assets/cdn/img/genny_hs.jpg' ELSE photo_url END, publish = 'photo,role,subtitle,groups,email,bio', sort = 40 WHERE email = 'genny@nseaswim.com';
INSERT INTO coach_authors (name, role, email, photo_url) SELECT 'Rachel Soubier', 'Assistant Coach', 'rachel@nseaswim.com', '/assets/cdn/img/rachel_hs.jpg' WHERE NOT EXISTS (SELECT 1 FROM coach_authors WHERE email = 'rachel@nseaswim.com');
UPDATE coach_authors SET role = 'Assistant Coach', subtitle = '', groups = 'Breakers,Surge', phone = '', bio = 'Rachel is from Ellicott City, Maryland, where she learned to swim at 3 years old and grew up swimming for Rockville Montgomery Swim Club. She coached and gave lessons for her summer league swim team, Connecticut Belair, for several years. In college, she competed at the Division I level for the University of Pittsburgh and UNCW as a mid/distance freestyler and backstroker.

Rachel graduated from UNCW in December 2025 with a Bachelor of Science degree in Cybersecurity, concentrating in Cyber Operations. During her final year, she worked as a research assistant and published a paper on malware. After graduation she wanted to return to coaching, and she joined the YMCA Narwhals summer swim team staff in the summer of 2026.

In her free time, Rachel continues to swim as part of a local masters group and particularly enjoys open water events. Outside of the water, she works in cybersecurity risk management for the North Carolina state government. She likes watching baseball, reading, and playing with her cat, Maki.', photo_url = CASE WHEN photo_url = '' THEN '/assets/cdn/img/rachel_hs.jpg' ELSE photo_url END, publish = 'photo,role,subtitle,groups,email,bio', sort = 50 WHERE email = 'rachel@nseaswim.com';
UPDATE coach_authors SET photo_alt = 'Coach Rachel Soubier on the pool deck at Earl Jackson Pool' WHERE email = 'rachel@nseaswim.com';

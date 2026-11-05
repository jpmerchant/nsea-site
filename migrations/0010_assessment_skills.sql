-- Assessment skill library (admin console: Assessments).
-- A skill belongs to a category (General, a diving type, or a stroke). Each assessed group has its own checklist, made by
-- attaching skills to it with a mark: G = gating (must score 3+ to be suggested for that group), A = assessed, L = logged
-- measurement that is not scored (distance swum). Seeded from JP's "New Swimmer Assessment: Templates" doc, Nov 4 2026.

CREATE TABLE assess_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL COLLATE NOCASE,
  cue TEXT NOT NULL DEFAULT '',                -- what the coach looks for
  kind TEXT NOT NULL DEFAULT 'score',          -- score (1 to 4) | yesno | distance (yards)
  sort INTEGER NOT NULL DEFAULT 0,             -- order inside the category
  active INTEGER NOT NULL DEFAULT 1,           -- 0 = archived: off every checklist, history kept
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (category, name)
);

CREATE TABLE assess_group_skills (
  skill_id INTEGER NOT NULL REFERENCES assess_skills(id),
  group_name TEXT NOT NULL,
  mark TEXT NOT NULL CHECK (mark IN ('G', 'A', 'L')),
  PRIMARY KEY (skill_id, group_name)
);
CREATE INDEX assess_group_skills_group ON assess_group_skills (group_name);

-- Minimum distance swum per stroke and group, in yards. A swimmer below it is flagged for review, never held out.
CREATE TABLE assess_min_distance (
  stroke TEXT NOT NULL,
  group_name TEXT NOT NULL,
  yards INTEGER NOT NULL CHECK (yards > 0),
  PRIMARY KEY (stroke, group_name)
);


-- General
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('General', 'Bobs / streamline jumps', 'Repeated bobs with exhale underwater; arms tight overhead on the jump', 'score', 10);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Bobs / streamline jumps';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'General' AND name = 'Bobs / streamline jumps';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('General', 'Front float', 'Face in, body flat, recovers to standing', 'score', 20);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Front float';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'General' AND name = 'Front float';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('General', 'Back float', 'Head back, hips up, relaxed', 'score', 30);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Back float';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'General' AND name = 'Back float';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('General', 'Float rotations', 'Rolls front to back and back to front under control', 'score', 40);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'A' FROM assess_skills WHERE category = 'General' AND name = 'Float rotations';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'General' AND name = 'Float rotations';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('General', 'Comfortable in water', 'Enters and moves without fear or panic', 'score', 50);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Comfortable in water';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'General' AND name = 'Comfortable in water';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('General', 'Comfortable in deep water', 'Stays calm and works in water over their head', 'score', 60);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'A' FROM assess_skills WHERE category = 'General' AND name = 'Comfortable in deep water';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Comfortable in deep water';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'General' AND name = 'Comfortable in deep water';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('General', 'Comfortable underwater', 'Face and head under, eyes open, blows bubbles', 'score', 70);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Comfortable underwater';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'General' AND name = 'Comfortable underwater';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('General', 'Listens', 'Pays attention when the coach speaks', 'score', 80);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Listens';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Listens';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Listens';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Listens';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('General', 'Follows directions', 'Does what is asked, in order', 'score', 90);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Follows directions';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Follows directions';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Follows directions';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'General' AND name = 'Follows directions';

-- Diving: shallow water
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Diving: shallow water', 'Kneeling dive', 'Falls in from a kneel, arms in streamline', 'yesno', 10);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'A' FROM assess_skills WHERE category = 'Diving: shallow water' AND name = 'Kneeling dive';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Diving: shallow water' AND name = 'Kneeling dive';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Diving: shallow water', 'Standing dive', 'Dives from standing, head down, arms in streamline', 'yesno', 20);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'A' FROM assess_skills WHERE category = 'Diving: shallow water' AND name = 'Standing dive';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Diving: shallow water' AND name = 'Standing dive';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Diving: shallow water', 'Shallow standing dive', 'Low-angle dive from standing', 'yesno', 30);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'A' FROM assess_skills WHERE category = 'Diving: shallow water' AND name = 'Shallow standing dive';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Diving: shallow water' AND name = 'Shallow standing dive';

-- Diving: deep water
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Diving: deep water', 'Kneeling dive', 'Same skill in deep water', 'yesno', 10);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'A' FROM assess_skills WHERE category = 'Diving: deep water' AND name = 'Kneeling dive';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Diving: deep water' AND name = 'Kneeling dive';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Diving: deep water' AND name = 'Kneeling dive';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Diving: deep water', 'Shallow standing dive', 'Low-angle dive from standing', 'yesno', 20);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Diving: deep water' AND name = 'Shallow standing dive';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Diving: deep water' AND name = 'Shallow standing dive';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Diving: deep water', 'Racing dive', 'Dives from the deck with a racing set-up', 'yesno', 30);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Diving: deep water' AND name = 'Racing dive';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'A' FROM assess_skills WHERE category = 'Diving: deep water' AND name = 'Racing dive';

-- Diving: off the blocks
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Diving: off the blocks', 'Standing dive', 'Controlled dive from the block', 'yesno', 10);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Diving: off the blocks' AND name = 'Standing dive';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'A' FROM assess_skills WHERE category = 'Diving: off the blocks' AND name = 'Standing dive';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Diving: off the blocks', 'Racing start', 'Full racing start, streamline entry', 'yesno', 20);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Diving: off the blocks' AND name = 'Racing start';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'A' FROM assess_skills WHERE category = 'Diving: off the blocks' AND name = 'Racing start';

-- Freestyle
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Freestyle', 'Rotary arms', 'Alternating arms, full recovery', 'score', 10);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Rotary arms';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Rotary arms';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Rotary arms';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Freestyle', 'Stable head', 'Head still, eyes down', 'score', 20);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Stable head';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Stable head';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Stable head';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Freestyle', 'Steady kick', 'Continuous kick from the hips', 'score', 30);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Steady kick';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Steady kick';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Steady kick';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Freestyle', 'Breathing to side', 'Turns to breathe without lifting the head', 'score', 40);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Breathing to side';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Breathing to side';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Breathing to side';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Freestyle', 'Flip turn', 'Tucks and pushes off the wall on their front', 'score', 50);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Flip turn';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Flip turn';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Freestyle', 'Underwater streamlines', 'Streamline off the wall', 'score', 60);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Underwater streamlines';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Underwater streamlines';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Underwater streamlines';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Freestyle', 'Distance swum', 'Distance swum without stopping; logged and used in the evaluation', 'distance', 70);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'L' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'L' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'L' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'L' FROM assess_skills WHERE category = 'Freestyle' AND name = 'Distance swum';

-- Backstroke
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Backstroke', 'Rotary arms', 'Alternating arms, full recovery', 'score', 10);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Rotary arms';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Rotary arms';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Rotary arms';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Backstroke', 'Stays on back', 'Stays flat on the back without rolling to the front', 'score', 20);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Stays on back';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Stays on back';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Stays on back';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Backstroke', 'Stable head', 'Head still, ears in the water', 'score', 30);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Stable head';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Stable head';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Stable head';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Backstroke', 'Steady kick', 'Continuous kick from the hips', 'score', 40);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Steady kick';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Steady kick';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Steady kick';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Backstroke', 'Flip turn', 'Turns over to the wall and pushes off', 'score', 50);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Flip turn';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Flip turn';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Backstroke', 'Underwater streamlines', 'Streamline off the wall', 'score', 60);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Underwater streamlines';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Underwater streamlines';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Underwater streamlines';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Backstroke', 'Distance swum', 'Distance swum without stopping; logged and used in the evaluation', 'distance', 70);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Splash', 'L' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'L' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'L' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'L' FROM assess_skills WHERE category = 'Backstroke' AND name = 'Distance swum';

-- Breaststroke
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Breaststroke', 'Legal / sync arms', 'Arms move together, in front of the shoulders', 'score', 10);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Legal / sync arms';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Legal / sync arms';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Legal / sync arms';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Breaststroke', 'Legal / sync legs', 'Simultaneous whip kick', 'score', 20);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Legal / sync legs';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Legal / sync legs';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Legal / sync legs';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Breaststroke', 'Underwater streamline', 'Streamline off the wall', 'score', 30);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Underwater streamline';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Underwater streamline';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Breaststroke', 'Pullout', 'One pull and one kick underwater off the wall', 'score', 40);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Pullout';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Pullout';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Breaststroke', 'Breath: forward', 'Lifts forward to breathe', 'score', 50);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Breath: forward';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Breath: forward';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Breath: forward';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Breaststroke', 'Breath: timing', 'Breathes at the right point in the stroke', 'score', 60);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Breath: timing';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Breath: timing';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Breaststroke', 'Distance swum', 'Distance swum without stopping; logged and used in the evaluation', 'distance', 70);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'L' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'L' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'L' FROM assess_skills WHERE category = 'Breaststroke' AND name = 'Distance swum';

-- Butterfly
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Butterfly', 'Legal / sync arms', 'Both arms recover together over the water', 'score', 10);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Legal / sync arms';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Legal / sync arms';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Legal / sync arms';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Butterfly', 'Legal / sync legs', 'Both legs kick together', 'score', 20);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'A' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Legal / sync legs';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Legal / sync legs';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Legal / sync legs';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Butterfly', 'Breath: forward', 'Lifts forward to breathe', 'score', 30);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Breath: forward';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Breath: forward';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Butterfly', 'Breath: timing', 'Breathes at the right point in the stroke', 'score', 40);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Breath: timing';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Breath: timing';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Butterfly', 'Underwater streamline', 'Streamline off the wall', 'score', 50);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'A' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Underwater streamline';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'G' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Underwater streamline';
INSERT INTO assess_skills (category, name, cue, kind, sort) VALUES ('Butterfly', 'Distance swum', 'Distance swum without stopping; logged and used in the evaluation', 'distance', 60);
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Tidepool', 'L' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Riptide', 'L' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Distance swum';
INSERT INTO assess_group_skills (skill_id, group_name, mark) SELECT id, 'Breakers', 'L' FROM assess_skills WHERE category = 'Butterfly' AND name = 'Distance swum';

-- Minimum distance swum (yards)
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Freestyle', 'Splash', 25);
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Freestyle', 'Tidepool', 50);
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Freestyle', 'Riptide', 100);
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Backstroke', 'Splash', 25);
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Backstroke', 'Tidepool', 50);
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Backstroke', 'Riptide', 100);
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Breaststroke', 'Tidepool', 25);
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Breaststroke', 'Riptide', 50);
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Butterfly', 'Tidepool', 25);
INSERT INTO assess_min_distance (stroke, group_name, yards) VALUES ('Butterfly', 'Riptide', 50);

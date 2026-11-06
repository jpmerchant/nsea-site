-- Mini-practice sets (Riptide and above): a set is a library entry of kind 'set' in the category "Mini practice".
-- It is attached to groups and ordered exactly like a skill, and is rated 1 to 4 at the assessment.
-- name = the set's short title, detail = the set as written, cue = what the coach watches for.
ALTER TABLE assess_skills ADD COLUMN detail TEXT NOT NULL DEFAULT '';

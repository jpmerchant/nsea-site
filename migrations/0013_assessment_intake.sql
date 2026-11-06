-- New swimmer assessment: what the public request form collects, kept beside the request.
-- family_ref groups siblings who were submitted together; flags are the staff-review notes from the intake rules.
ALTER TABLE assess_requests ADD COLUMN family_ref TEXT;
ALTER TABLE assess_requests ADD COLUMN dob TEXT;                              -- YYYY-MM-DD
ALTER TABLE assess_requests ADD COLUMN path TEXT NOT NULL DEFAULT 'schedule'; -- schedule | background_review
ALTER TABLE assess_requests ADD COLUMN assess_for TEXT;                       -- the group the assessment is for (highest asked)
ALTER TABLE assess_requests ADD COLUMN groups_asked TEXT;                     -- JSON array of group names
ALTER TABLE assess_requests ADD COLUMN intake TEXT;                           -- JSON: experience, competitive details, history, heard
ALTER TABLE assess_requests ADD COLUMN flags TEXT;                            -- JSON array of { code, message }
CREATE INDEX assess_requests_family ON assess_requests (family_ref);

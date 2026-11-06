-- New swimmer assessment: an optional second point of contact for the family (the other parent, a guardian, a grandparent).
ALTER TABLE assess_requests ADD COLUMN contact2_name TEXT;
ALTER TABLE assess_requests ADD COLUMN contact2_email TEXT;
ALTER TABLE assess_requests ADD COLUMN contact2_phone TEXT;

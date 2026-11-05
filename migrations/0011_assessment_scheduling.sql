-- New swimmer assessment scheduling (admin console: Assessments > Scheduling).
-- Staff publish 15-minute availability slots; a request (entered by staff now, by the public form later) is scheduled into
-- a slot or onto a custom date and time. Dates and times are Eastern (the pool's local time), stored as text.

CREATE TABLE assess_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_date TEXT NOT NULL,                       -- YYYY-MM-DD
  start_time TEXT NOT NULL,                      -- HH:MM, 24 hour
  minutes INTEGER NOT NULL DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'open',           -- open | booked
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (slot_date, start_time)
);
CREATE INDEX assess_slots_date ON assess_slots (slot_date);

CREATE TABLE assess_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'new',            -- new | scheduled | declined | cancelled
  source TEXT NOT NULL DEFAULT 'admin',          -- admin | form
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  swimmer_name TEXT NOT NULL,
  swimmer_age INTEGER,
  notes TEXT,                                    -- what the family told us
  preferred TEXT,                                -- JSON: up to 3 of { date, time }
  slot_id INTEGER REFERENCES assess_slots(id),   -- set when scheduled into a published slot
  appt_date TEXT,                                -- set when scheduled (slot or custom)
  appt_time TEXT,
  staff_note TEXT,                               -- internal: decline reason, who is coaching, etc.
  confirmed_by TEXT,
  confirmed_at TEXT,
  calendar_event_id TEXT,                        -- Google Calendar event, once the calendar sync exists
  confirm_sent_at TEXT,
  reminder_sent_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX assess_requests_status ON assess_requests (status);
CREATE INDEX assess_requests_appt ON assess_requests (appt_date, appt_time);

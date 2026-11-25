-- Family Thanks: notes of thanks that families send from the public form (/embeds/share-thanks.html).
-- Nothing shows publicly until someone with the Content role approves it in the admin console (Content > Family Thanks).
-- Approved notes appear on the Thanks Wall widget (/embeds/thanks-wall.html, which reads /api/content/thanks).

CREATE TABLE family_thanks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL,                        -- the note as shown publicly (the approver may fix typos)
  original TEXT NOT NULL,                    -- the note exactly as the family sent it
  signed TEXT NOT NULL,                      -- how the family signs it, e.g. "The Rivera family" (shown publicly)
  email TEXT,                                -- optional and private: never returned by the public API
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | approved | rejected
  featured INTEGER NOT NULL DEFAULT 0,       -- pinned to the top of the wall
  sender_hash TEXT,                          -- hash of IP + day, used only to limit how many notes one sender sends a day
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by TEXT
);
CREATE INDEX family_thanks_status ON family_thanks (status, created_at);
CREATE INDEX family_thanks_sender ON family_thanks (sender_hash, created_at);

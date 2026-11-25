-- Shared live overrides on top of the static baseline (public/companies_data.js).
-- One row per company id that has been edited/added by anyone. Latest write wins.
CREATE TABLE IF NOT EXISTS company_overrides (
  id         INTEGER PRIMARY KEY,           -- company id (baseline id, or client-generated for new records)
  data       TEXT    NOT NULL,              -- full company record as JSON
  rev        INTEGER NOT NULL,              -- global monotonically increasing revision (sync cursor)
  updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_overrides_rev ON company_overrides(rev);

-- Append-only audit trail of every write (who changed what, when).
CREATE TABLE IF NOT EXISTS company_history (
  hid        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         INTEGER NOT NULL,
  rev        INTEGER NOT NULL,
  data       TEXT    NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_company_history_id ON company_history(id);

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT
);

-- Atomic revision allocator (UPDATE ... RETURNING is atomic, so concurrent writers never share a rev).
CREATE TABLE IF NOT EXISTS rev_counter (k INTEGER PRIMARY KEY CHECK (k = 1), v INTEGER NOT NULL);
INSERT OR IGNORE INTO rev_counter (k, v) VALUES (1, 0);

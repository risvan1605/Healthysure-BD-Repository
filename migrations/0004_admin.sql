-- Admin (export) password, stored server-side as a salted PBKDF2 hash.
-- Until a row exists, the ADMIN_PASSWORD secret is the password.
CREATE TABLE IF NOT EXISTS admin_credentials (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  salt       TEXT    NOT NULL,
  hash       TEXT    NOT NULL,
  iterations INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- Every admin-password check (who, when, for what, success?) — also used for throttling.
CREATE TABLE IF NOT EXISTS admin_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  ip         TEXT,
  action     TEXT    NOT NULL,   -- excel_export | crm_export | change_password
  ok         INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_email ON admin_audit(email, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_ip ON admin_audit(ip, created_at);

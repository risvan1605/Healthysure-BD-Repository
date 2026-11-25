-- Server-side sessions: logout (and expiry) really invalidate a cookie. Only a SHA-256 of the
-- random session token is stored, so a database leak does not yield usable cookies.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,
  email      TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);

-- Failed code verifications, for per-IP throttling.
CREATE TABLE IF NOT EXISTS auth_failures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_failures_ip ON auth_failures(ip, created_at);

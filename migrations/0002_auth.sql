-- One-time sign-in codes (emailed via SendGrid). Only an HMAC of the code is stored.
CREATE TABLE IF NOT EXISTS otp_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  code_hash  TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,            -- unix seconds
  attempts   INTEGER NOT NULL DEFAULT 0,  -- wrong guesses against this code
  ip         TEXT,
  created_at INTEGER NOT NULL             -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_ip ON otp_codes(ip, created_at);

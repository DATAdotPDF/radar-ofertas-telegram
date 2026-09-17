CREATE TABLE IF NOT EXISTS oauth_sessions (
  provider TEXT NOT NULL,
  state TEXT NOT NULL PRIMARY KEY,
  verifier_ciphertext TEXT NOT NULL,
  verifier_iv TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_oauth_tokens (
  provider TEXT NOT NULL PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

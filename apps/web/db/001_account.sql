-- Account tables for wallet sign-in, watchlist and in-app alerts (serverless, Neon Postgres).
-- Run once in the Neon SQL Editor. Safe to run again: every statement is IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS users (
  wallet text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce_hash text PRIMARY KEY,
  wallet text NOT NULL,
  message text NOT NULL,
  domain text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_nonces_wallet_idx ON auth_nonces (wallet, expires_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  wallet text NOT NULL REFERENCES users (wallet),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS watchlists (
  wallet text NOT NULL REFERENCES users (wallet),
  theme_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, theme_id)
);
CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY,
  wallet text NOT NULL REFERENCES users (wallet),
  theme_id text NOT NULL,
  threshold double precision NOT NULL CHECK (threshold BETWEEN 0 AND 1),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_wallet_idx ON alerts (wallet);

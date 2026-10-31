BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS venues (
  id text PRIMARY KEY, trading_enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO venues(id) VALUES ('polymarket'),('kalshi'),('velocity') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS markets (
  id text PRIMARY KEY, venue text NOT NULL REFERENCES venues(id), venue_market_id text NOT NULL,
  data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(venue, venue_market_id)
);
CREATE TABLE IF NOT EXISTS themes (
  id text PRIMARY KEY, slug text NOT NULL UNIQUE, title text NOT NULL, description text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}', direction smallint NOT NULL CHECK(direction IN (-1,1)),
  review_status text NOT NULL DEFAULT 'candidate' CHECK(review_status IN ('candidate','approved','rejected')),
  perp_symbol text, confidence double precision NOT NULL DEFAULT 0 CHECK(confidence BETWEEN 0 AND 1),
  review_note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS theme_markets (
  theme_id text NOT NULL REFERENCES themes(id), market_id text NOT NULL REFERENCES markets(id),
  equivalence_key text, PRIMARY KEY(theme_id, market_id)
);
CREATE TABLE IF NOT EXISTS theme_reviews (
  id bigserial PRIMARY KEY, theme_id text NOT NULL REFERENCES themes(id), reviewer text NOT NULL,
  status text NOT NULL CHECK(status IN ('candidate','approved','rejected')), reason text NOT NULL,
  rules_hash text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS market_snapshots (
  id bigserial PRIMARY KEY, market_id text NOT NULL REFERENCES markets(id), captured_at timestamptz NOT NULL,
  yes_bid double precision, yes_ask double precision, yes_mid double precision,
  volume_24h double precision, data jsonb NOT NULL, UNIQUE(market_id, captured_at)
);
CREATE INDEX IF NOT EXISTS market_history_idx ON market_snapshots(market_id, captured_at DESC);
CREATE TABLE IF NOT EXISTS perp_markets (symbol text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS perp_snapshots (
  id bigserial PRIMARY KEY, symbol text NOT NULL REFERENCES perp_markets(symbol), captured_at timestamptz NOT NULL,
  mark double precision NOT NULL, oracle double precision NOT NULL, data jsonb NOT NULL, UNIQUE(symbol,captured_at)
);
CREATE INDEX IF NOT EXISTS perp_history_idx ON perp_snapshots(symbol, captured_at DESC);
CREATE TABLE IF NOT EXISTS signals (
  id text PRIMARY KEY, theme_id text NOT NULL REFERENCES themes(id), type text NOT NULL CHECK(type IN ('ODDS_LEAD','PERP_LEAD')),
  created_at timestamptz NOT NULL, payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS signal_time_idx ON signals(created_at DESC);
CREATE TABLE IF NOT EXISTS users (wallet text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce_hash text PRIMARY KEY, wallet text NOT NULL, message text NOT NULL, domain text NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, wallet text NOT NULL REFERENCES users(wallet),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS watchlists (
  wallet text NOT NULL REFERENCES users(wallet), theme_id text NOT NULL REFERENCES themes(id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(wallet,theme_id)
);
CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY, wallet text NOT NULL REFERENCES users(wallet), theme_id text NOT NULL REFERENCES themes(id),
  threshold double precision NOT NULL CHECK(threshold BETWEEN 0 AND 1), enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alert_deliveries (
  id bigserial PRIMARY KEY, alert_id uuid NOT NULL REFERENCES alerts(id), signal_id text REFERENCES signals(id),
  status text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS execution_intents (
  id uuid PRIMARY KEY, wallet text REFERENCES users(wallet), network text NOT NULL,
  status text NOT NULL DEFAULT 'disabled', request jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS execution_audit (
  id bigserial PRIMARY KEY, intent_id uuid REFERENCES execution_intents(id), action text NOT NULL,
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS venue_health (venue text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS worker_state (id text PRIMARY KEY, captured_at timestamptz NOT NULL);
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;

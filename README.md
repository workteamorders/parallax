# Parallax

A read-only Solana research terminal connecting actual prediction-market odds to discovered Velocity perpetual markets. Prediction contracts are not perp price forecasts, settlement-equivalent hedges, or guaranteed arbitrage.

**Trading is disabled on every network.** There is no order-signing SDK, server-held wallet key, deposit, withdrawal, or order submission path. Polymarket execution is OFF and Kalshi is read-only/unavailable where reported. A wallet message signature authenticates a research session only.

## Local Development

Requires Node 26, pnpm 11.5.2, and Docker/Colima. Install workspace dependencies before starting services. No environment files are required for local defaults, and the application does not load them.

```sh
pnpm install
docker compose up -d --wait
pnpm seed:themes
pnpm worker
```

In another terminal, after workspace dependencies are installed:

```sh
pnpm dev
```

- Web: `http://127.0.0.1:3100`.
- API: `http://127.0.0.1:4100`, bound to `127.0.0.1` by default.
- Allowed browser origin: `http://127.0.0.1:3100`. Use `WEB_ORIGIN` to select one exact origin; wildcards are not allowed.
- PostgreSQL: `127.0.0.1:55432`, database/user `parallax`, development-only password `parallax_local_only`.
- Redis: `127.0.0.1:56379`. Compose exposes both databases on loopback only and preserves named volumes.
- API and worker take a PostgreSQL advisory migration lock at startup. Seed and worker share a renewable Redis ingestion lease; all Jupiter requests share a 2.2-second request slot.
- Seed retrieves actual single-market details. It does not insert fixtures or synthesize unavailable quotes.

If the web app uses another port, set the same explicit `WEB_ORIGIN` for API and worker processes. Use `127.0.0.1` consistently in browser URLs so session cookies remain same-site.

## Research Data

The checked-in manifest contains **43 individually reviewed contracts: 39 open at review, 32 approved directional research mappings, seven candidates, and four rejected stale discovery listings**. Review date: October 29, 2026. Nineteen additional supported BTC/SOL contracts were individually re-fetched and their rules checked against the preserved review evidence. Availability and approval can subsequently change; live details, expiry, and rule/strike checks take precedence. Separate strikes are separate contracts, not independent macro narratives or matched cross-venue pairs.

All seeded prediction markets have Polymarket provenance and Jupiter transport. Jupiter is not another venue. The documented `provider=kalshi` crypto query returned an empty data array during verification. Direct Gamma, Kalshi elections, and `external-api.kalshi.com` public GETs subsequently succeeded with TLS verification; worker health probes report current connectivity separately from reviewed contract coverage. Unknown `gx` provenance is excluded rather than assumed to mean Kalshi.

Missing market-level 24-hour volume and liquidity are `null`. Event volume is not assigned to every strike. Jupiter microUSD prices are divided by 1,000,000. Velocity mark/oracle prices are already human decimals; funding strings are preserved without annualizing undocumented units. Discovery excludes spot markets.

Histories start when the worker captures real samples. There is no fabricated seven-day backfill. Signals require enough prior matched samples; empty signals on a new database are expected. A chart with one observation or no historical observations is an honest state.

## API

```sh
curl http://127.0.0.1:4100/health
curl http://127.0.0.1:4100/terminal
curl 'http://127.0.0.1:4100/candles?symbol=SOL-PERP&resolution=60&limit=48'
curl http://127.0.0.1:4100/themes/sol-110-october/history
```

`GET /terminal` implements `TerminalData` from `packages/shared/src/index.ts`. `WS /feed` publishes invalidation events; the browser refetches `/terminal`. Candle symbols must exist in actual recent Velocity discovery.

Prediction quotes over five minutes old, expired, rejected, future-dated or invalidly timestamped are nulled on every API response, including cache hits, without changing their source `capturedAt`. This does not depend on the worker still running. Historical observations remain intact. Approved mapping status is not proof that a contract is currently open or quoted.

Optional SIWS-style sessions support `/auth/challenge`, `/auth/verify`, `/auth/session`, `/auth/logout`, persistent `/watchlist`, and `/alerts`. Challenges expire after five minutes and are single-use; sessions expire after 24 hours. Only a wallet public address and signed authentication message are accepted. In-app threshold notices are evaluated by the worker. Telegram is gracefully disabled; no token or account linking is implemented.

See [API Notes](docs/API-NOTES.md) for exact payloads and [Decisions](docs/DECISIONS.md) for safety constraints, source verification, review policy, and known limitations.

## Review Workflow

```sh
pnpm review:themes list
pnpm review:themes discover polymarket
pnpm review:themes discover kalshi
pnpm review:themes inspect POLY-5611739
pnpm review:themes decide sol-110-october candidate operator 'Retain as candidate while reviewing the exact source and expiry.'
```

Full rules, current quotes, provenance, and rule hash are printed by `inspect`. `decide` records reviewer, status, reason, and hash in `theme_reviews`. Reseeding does not silently override an operator's approval or rejection. Rule, strike, provider, or expiry changes downgrade approvals and require another review. Adding a contract or changing its mapped perp requires a reviewed manifest/code change; the CLI does not guess economic mappings.

## Verification

The Rift is a cinematic charcoal/mineral/ember world built around two procedural floating landforms and a luminous fracture. Its Three.js scene supports bounded mouse exploration, belief/reaction focus, reset and pause; touch/reduced-motion devices render stable frames. An immediate SVG illustration remains available while WebGL initializes or when it is unavailable. The artwork is decorative, not a model of probability, correlation or opportunity. Actual reviewed events can be selected using previous/next, keyboard arrows, the searchable/filterable event atlas or the dense data-table alternative. Split charts, reviewed-rule views, wallet research sessions, watchlists and in-app alerts retain the existing API. Portfolio and trade panels explicitly identify unavailable onchain functionality. This is a live research build, not a trading-ready product or a claim that the original full execution Definition of Done is met.

Run the full workspace gates:

```sh
pnpm typecheck
pnpm lint
pnpm test
RUN_INTEGRATION=1 pnpm test
pnpm build
```

`pnpm test` intentionally skips real-service integration tests; the explicit `RUN_INTEGRATION=1` run requires the project's PostgreSQL and Redis. Browser tests require web, API and worker to be running with seeded data:

```sh
pnpm test:e2e
```

Playwright uses installed Chrome via `channel: 'chrome'`, with desktop, phone and narrow reduced-motion cases. UI tests require actual nonempty reviewed data, verify real WebGL frame pixels and independently test the SVG fallback with WebGL deliberately disabled. The original seed/coverage requirement is separate: contracts naturally expire, and current approval counts must be checked through the review CLI/database rather than inferred from a passing visual test. No fixtures replace expired quotes. Screenshots and traces are under `apps/web/test-results/`, including `rift-world-desktop.png`, `rift-world-mobile.png` and the fallback views.

For a production-build local preview, stop only this project's development web process and run `pnpm --filter @parallax/web start` after `pnpm build`. Keep API and worker running separately. Use `http://127.0.0.1:3100`, not `localhost`, to match the exact origin.

Web configuration reference: `API_INTERNAL_URL` (default `http://127.0.0.1:4100`), `WEB_ORIGIN` (default `http://127.0.0.1:3100`) and `NEXT_PUBLIC_FEED_URL` (default `ws://127.0.0.1:4100/feed`). The last is public build-time configuration; use a same-operator WSS endpoint and corresponding exact origin in an HTTPS deployment. See each app's placeholder `.env.example`; this project does not load environment files automatically.

Run the owned-package checks after setup:

```sh
pnpm --filter @parallax/shared typecheck
pnpm --filter @parallax/api typecheck
pnpm --filter @parallax/shared lint
pnpm --filter @parallax/api lint
pnpm --filter @parallax/shared test
pnpm --filter @parallax/api test
RUN_INTEGRATION=1 pnpm --filter @parallax/api test
pnpm --filter @parallax/shared build
pnpm --filter @parallax/api build
```

`lint` in the API/shared packages runs ESLint with TypeScript parsing, reusing the already-installed workspace web lint toolchain through an explicit resolver in `apps/api/scripts/lint.mjs`. It does not import web application code or install anything. Typechecking remains a separate command. Unit fixtures are sanitized excerpts of actual public responses. Divergence tests deliberately use synthetic series only in tests. Integration tests use real local PostgreSQL/Redis, create ephemeral research sessions/watchlists/alerts, and remove their records afterward. They cover replay races, expired nonces, colon-bearing IDs, body/rate limits, CORS, geoblock denial, WebSocket origin/policy checks, and actual Redis invalidation. They never submit a blockchain order.

See `docs/API-NOTES.md` for the recorded verification status and remaining execution-test limitations. Development credentials are not suitable for a deployment; use managed secrets passed directly to the process and authenticated infrastructure in production. Never put wallet signing keys on this server.

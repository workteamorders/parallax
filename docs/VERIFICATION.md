# Verification Report

## Implemented Build

Parallax / The Rift is a running read-only Solana research terminal, not a trading-ready launch. It includes the monorepo, typed public-data adapters, PostgreSQL/Redis, migrations, worker, reviewed contract manifest, real snapshots, signal math, sessions, watchlists, probability threshold notices, application WebSocket invalidation, a procedural Three.js landscape, responsive research interface and draft legal pages.

The web app is currently running in development mode at `http://127.0.0.1:3100`, following the owner's request to use `npm run dev`; API is `http://127.0.0.1:4100`. Production compilation is verified separately. API and worker remain running alongside the project's Docker infrastructure. Another pre-existing IPv6 listener on port 3100 was not touched; use the exact IPv4 URL.

## Commands Actually Run

| Command | Final result |
| --- | --- |
| `pnpm install --offline` | Passed after the initial dependency installation and explicit build-script policy. |
| `pnpm typecheck` | Passed in shared, API and web; Next route types generated. |
| `pnpm lint` | Passed actual ESLint in all three packages, no warnings. |
| `pnpm test` | The Rift revision passed 39 tests; ten real-service integration tests are intentionally skipped by the default test mode and were exercised in the separate integration run. |
| `RUN_INTEGRATION=1 pnpm test` | The Rift revision passed 49 tests, none skipped: seven shared, 36 API, six web tests including deterministic geometry, finite vertices and normalized surface normals. |
| `pnpm build` | Passed shared/API TypeScript builds and Next.js production build. A non-fatal Node 26 experimental localStorage warning is emitted by wallet-library prerendering; no browser localStorage file is created. |
| `pnpm test:e2e` | The Rift revision passed all 18 Playwright tests: nine desktop and nine phone-viewport cases against the running development stack, including a deliberately disabled WebGL environment. The original research build was also tested against a production server. |
| `docker compose config --quiet` | Passed. |
| `docker compose ps` | PostgreSQL and Redis healthy on project-only loopback ports 55432 and 56379. |
| `pnpm seed:themes` | Passed live single-contract fetch and persistence; no fixtures used as production data. |
| `pnpm review:themes list` | Passed, preserving all 43 review records and reasons. |
| `curl http://127.0.0.1:4100/health` | HTTP 200; healthy, PostgreSQL/Redis true, worker fresh, execution and Telegram disabled. |

The browser tests exercise `/`, `/markets`, a real `/t/[slug]`, `/signals`, `/portfolio`, `/alerts`, and `/legal/risk`. They check actual chart paths, 24h/seven-day axes, search, asset filtering, reference inspection, wallet dialog/Escape, honest unavailable states, no horizontal page overflow at phone width, and an injected API outage with no substitute quotes. The current visual test requires actual nonempty reviewed data, not a fabricated minimum of unexpired approvals; original seed coverage is checked separately. The WebGL path must render nontransparent pixels after pause/reset/scroll, while a separate test disables WebGL and verifies the illustrated fallback and controls. Browser page/console errors are checked in the overview case. An earlier production console probe returned `consoleErrors: []`.

The Rift supersedes the former Signal Station: previous/next and keyboard event selection, watchlist/asset filtering, event-atlas/table switching, artistic belief/reaction focus, pause/reset, mobile navigation, a 320px reduced-motion case and WebGL fallback are tested. Retained framebuffers and resize guards prevent a paused surface from being cleared. No trading behavior or API response contract changed. Scene-only screenshots are written to `apps/web/test-results/rift-world-desktop.png` and `rift-world-mobile.png`, with full-page and fallback variants beside them.

Screenshots are regenerated under `apps/web/test-results/overview-desktop.png`, `overview-mobile.png`, `theme-desktop.png`, and `theme-mobile.png`. API outages are injected only in the browser test, never in runtime providers.

## Persistence Evidence

The following read-only command ran against the real project database:

```sh
docker compose exec -T postgres psql -U parallax -d parallax -c "SELECT review_status, count(*) FROM themes GROUP BY review_status ORDER BY review_status; SELECT count(*) AS prediction_snapshots FROM market_snapshots; SELECT count(*) AS perp_snapshots FROM perp_snapshots; SELECT count(*) AS reviewed_contracts FROM theme_reviews;"
```

Recorded output:

```text
approved                 31
candidate                 8
rejected                  4
prediction_snapshots   1434
perp_snapshots          180
reviewed_contracts       43
```

Counts increase as the worker runs; approval can downgrade on actual expiry/rule changes. The earlier seed approved 32 contracts; an expired noon-ET contract was subsequently downgraded, not silently retained as a live market. Several approved contracts share an event with distinct strikes/windows. These are not 31 independent narratives, cross-venue pairs or validated hedges.

## Not Verified or Implemented

The original full execution Definition of Done is **not met**. No blockchain order, cancellation or builder approval was implemented or exercised, and no funded wallet was used. Portfolio subaccount reconciliation, deposits, withdrawals and leverage are unavailable. Research-signature integration tests are not order-signing tests.

No Kalshi equivalent is seeded; there is no valid two-venue spread to display. Prediction quotes use Polymarket provenance via Jupiter, while direct Gamma/Kalshi calls currently verify connectivity only. External provider WebSocket ingestion, Telegram linking/delivery, spread/mismatch/divergence alert types and an LLM provider are not implemented. Seven-day odds history is accumulated, not fabricated; signals remain empty during baseline warmup.

Commercial-data permissions, complete geographic policies, authenticated production edge forwarding, stronger CSP nonce/hash handling, retention/deletion workflows and legal review remain launch blockers. Full decisions and discrepancies are in `DECISIONS.md` and official-source details in `API-NOTES.md`.

## Owner-Only Actions

- Review the contract mappings, venue/data-use terms, geographical requirements, and draft legal pages with qualified counsel before public launch.
- Once an execution integration exists, connect and fund a Solana devnet wallet in the owner's own wallet UI and validate approval/order/cancel behavior before any mainnet enablement.
- Verify Velocity's current builder registration/revenue-share and collateral requirements, then authorize setup using the owner's wallet. The Hyperliquid 100-USDC requirement and `HL_BUILDER_ADDRESS` do not apply to this build.
- Supply a Telegram bot token only after secure linking and delivery have been implemented. Setting a token alone cannot enable the current build.

Never send a wallet private key or seed phrase to this server.

## Devnet Trading and Deploy Revision (verified in a cloud workspace, 2026-11-01)

Run there: `pnpm typecheck`, `pnpm lint`, `pnpm test` (see counts in the final report), `pnpm build`; the production web build loaded the Velocity SDK in Chromium and rendered the devnet panel with no CSP errors against a mock API; the API and worker ran with production settings against local Postgres 16 and Redis. Read-only devnet RPC checks (program and dUSDT mint exist) were done through the owner's browser.

Not done: any signed devnet transaction, Playwright e2e against live data, the Docker image build, live Jupiter/Velocity ingestion from the workspace. See `docs/DEVNET-TRADING.md` and `docs/DEPLOY.md`.

## Live-only mode (verified in a cloud workspace, 2026-11-01)

Web unit tests (20) cover: all sources failing (no quote, no approved theme, honest health), manifest verification (a contract whose rules differ from the reviewed fingerprint cannot stay approved), rejected/expired contracts never fetched, env-driven trading flag (never mainnet), candle input validation before any network call, candle success/404, history empty/404. The production build ran in live mode and was exercised over HTTP and in Chromium with the upstream hosts unreachable: the pages render, every route answers as designed, there were no console errors. NOT verified: the success path against the real Jupiter and Velocity services, and Vercel itself.

## Devnet trading rewrite and real-program simulation (2026-11-03)

The first deployed build failed in the browser with "AnchorProvider is not supported in the browser build": the SDK's browser build cannot run `VelocityClient`. The module was rewritten on `VelocityCore` with a `program.instruction` shim built from the camelCased IDL (a coder built from the raw snake_case IDL silently writes zeroes for camelCase fields, which the parity tests caught).

Verified: web unit tests (34, including 14 new: shim parity with Anchor, offline session flows, faucet), typecheck, lint, production build, and a Chromium run against the production bundle with a fake Wallet Standard wallet and a mocked RPC (session opens, market and balance read, one simulation, one wallet prompt). Against the real devnet program, read through the owner's browser: account sizes and discriminators match, and one simulated transaction (faucet mint, create user, deposit, market order, cancel) succeeded. NOT verified: any signed transaction, the builder-code path on chain, Phantom signing.

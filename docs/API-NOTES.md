# API Notes

## Contract

The authoritative browser types are exported from `packages/shared/src/index.ts`: `TerminalData`, `Theme`, `PredictionMarket`, `Perp`, `Signal`, `VenueHealth`, `Candle`, and `ThemeHistory`. The shared package also exports tested `probabilityMid` and `measureLead` math; see Decisions for the exact mirrored signal formulas and defaults.

| Route | Behavior |
| --- | --- |
| `GET /health` | PostgreSQL/Redis readiness, worker heartbeat/freshness, core-data health, trading disabled, Telegram disabled. Infrastructure outage returns 503; live-data warmup/degradation returns 200 with `status: degraded`. |
| `GET /terminal` | Exact `TerminalData` object, cached for five seconds. Prediction quote freshness is rechecked on every response, including cache hits: stale (>5 min), future/invalid-timestamp, expired and rejected live bid/ask/mid values are null. Original quote `capturedAt` is retained. Terminal `capturedAt` is the last completed ingestion cycle, or response time if no cycle exists; individual quote timestamps remain authoritative. |
| `GET /candles?symbol=SOL-PERP&resolution=60&limit=48` | `{candles:[{ts,open,high,low,close,oracleClose}]}`, actual ascending Velocity candles. `ts` is Unix seconds. Resolutions: `1,5,15,60,240,D,W,M`; limit 1-500. Symbol must have appeared in successful active-perp discovery in the last day. |
| `GET /themes/:slug/history` | `{probability:[{ts,value}],perp:[{ts,value}]}`, Unix seconds; actual samples from trailing seven days. Probability is oriented by theme direction. Empty arrays are valid; unknown slug is 404. |
| `WS /feed` | Requires exact `Origin: WEB_ORIGIN`. Sends `{type:'connected',capturedAt}` then `{type:'update',capturedAt}` after cache invalidation. Read-only; client messages close the socket. Refetch terminal after connection/update/reconnect. |
| `POST /trade` | Always 403. No transaction bytes, quotes for execution, signing, or broadcast. Polymarket execution OFF, Kalshi read-only. |

All JSON inputs reject unknown fields; query/parameter/body errors return 400. CORS only permits the configured exact origin; a supplied different Origin returns 403. Read/write budgets are separate: 600 GETs and 120 writes per minute per direct client IP. Challenge/verify have separate ten-per-minute groups. No forwarding IP/country header is trusted. Error responses do not expose database URLs, upstream bodies, cookies, or signature material.

`PredictionMarket.venueMarketId` preserves Jupiter's opaque provider-prefixed ID such as `POLY-5611739`; it is not assumed to be a Polymarket CLOB condition ID. `source` is the actual detail URL, `transport` is `jupiter`, and `venue` retains underlying provenance. Trading code must never assume this identifier is order-ready.

`Perp.change24h` is source percentage points, e.g. `-0.68` means -0.68%, not a fraction to multiply by 100. Open interest retains source base-asset quantities and signed shorts. Funding values are source strings, not annualized percentages. `volume24h` on perps comes from source `quoteVolume`; prediction market-level volume and liquidity remain null because the required unit/window was not verified.

## Sessions

Use the same hostname for browser/API, `credentials: 'include'`, and the exact configured Origin. Do not send a private key or seed phrase.

```http
POST /auth/challenge
Origin: http://127.0.0.1:3100
Content-Type: application/json

{"address":"<base58 Solana public address>"}
```

Response: `{nonce,message,expiresAt}`. Ask the wallet to sign **exactly** the UTF-8 bytes of `message`. The signed message explicitly states that it does not authorize transactions.

```http
POST /auth/verify
Origin: http://127.0.0.1:3100
Content-Type: application/json

{"address":"<same address>","nonce":"<64 hex characters>","signature":"<base58 detached 64-byte signature>"}
```

Success: `{authenticated:true,address}` and an HttpOnly session cookie. Base64 is not accepted for signatures. Invalid, expired, mismatched-domain, or replayed challenges return 401. Nonces expire in five minutes; sessions in 24 hours. Verification is transactional and race-safe. The backend does not issue or refresh a transaction authorization.

- `GET /auth/session` returns `{authenticated:boolean,address:string|null}`.
- `POST /auth/logout` with `{}` revokes the stored session and clears its cookie; exact Origin required.
- Production uses `__Host-parallax_session`, Secure, SameSite Strict, Path `/`, without a Domain attribute. Local development uses `parallax_session` to work on HTTP loopback.

## Watchlists and Alerts

All routes below require a session; all writes require exact Origin.

| Route | Body / Result |
| --- | --- |
| `GET /watchlist` | `{themes:string[]}` (theme IDs equal current slugs). |
| `POST /watchlist` | `{themeId:string}` -> `{saved:true,themeId}`; idempotent. |
| `DELETE /watchlist/:id` | Removes only this wallet's entry by theme ID (URL-encode it). |
| `GET /alerts` | `{alerts:[{id,themeId,threshold,enabled}],deliveries:[...],telegram:{enabled:false}}`. |
| `POST /alerts` | `{themeId:string,threshold:number}` with threshold 0-1 -> `{id,enabled:true,channel:'in-app',telegram:{enabled:false}}`. Up to 50 retained alerts per wallet. |
| `DELETE /alerts/:id` | UUID required; disables only this wallet's alert. |

Threshold notices use direction-oriented midpoints, not executable prices. Worker freshness/expiry checks apply; at most one in-app notice per alert per hour. Delivery `reason` is a JSON-encoded text record containing observed probability, threshold, quote timestamp and theme ID. No Telegram delivery is attempted.

Theme IDs are separate from URL slugs: watchlist/alert inputs accept bounded IDs of 1-512 ASCII alphanumeric, colon, underscore or hyphen characters, including `polymarket:POLY-...`. They are parameterized SQL values, never SQL identifiers. History lookup remains a bounded lowercase URL slug. A syntactically valid but unknown ID is 404, not a validation failure.

## Configuration

Values are read from process environment only; no environment file loader is used. Do not put wallet keys or provider API keys in this server.

| Variable | Default / Meaning |
| --- | --- |
| `API_HOST` | `127.0.0.1` |
| `API_PORT` | `4100` |
| `WEB_ORIGIN` | `http://127.0.0.1:3100`; normalized to exact origin. Production requires HTTPS. |
| `DATABASE_URL` | Local project PostgreSQL on 55432, development-only credentials documented in README/compose. |
| `REDIS_URL` | `redis://127.0.0.1:56379` |
| `SOLANA_NETWORK` | `devnet`; allowed `devnet` or `mainnet-beta`, preference only, never enables trading. |
| `BUILDER_FEE_TENTHS_BP` | `20`, floored/clamped to 0-100, protocol ceiling 1,000. |
| `BLOCKED_COUNTRIES` | `US,CU,IR,KP,SY`; the server nevertheless denies unverified execution location regardless of this list. Not a comprehensive legal policy. |
| `WORKER_INTERVAL_MS` | `120000`, minimum 60000, wait after each finished cycle. |
| `SIGNAL_WINDOW_MINUTES` | `60`, integer 1-1440; W for current and baseline changes. |
| `SIGNAL_Z_THRESHOLD` | `2`, positive finite standardized leader threshold. |
| `SIGNAL_FOLLOW_THRESHOLD` | `0.5`, 0-1; signed follower projection threshold. |
| `SIGNAL_MIN_COUNT` | `30`, integer at least 30; minimum prior non-overlapping baseline comparisons. |
| `NODE_ENV` | `development`; production enables Secure host-only session cookie and HTTPS-origin requirement. |

## Source Verification

Verified public calls on October 29, 2026 with certificate verification retained:

- `GET https://data.velocity.exchange/stats/markets`: HTTP success; active SOL/BTC/ETH/HYPE/ZEC perps at indices 0-4, interleaved spot markets.
- `GET https://data.velocity.exchange/market/SOL-PERP/candles/60?limit=2`: success with `records`, Unix seconds, `fillOpen/High/Low/Close` and `oracleClose`. Actual fill candles can be flat on low-volume periods; oracle candles can differ.
- `GET https://api.jup.ag/prediction/v1/events?filter=trending&includeMarkets=true&category=crypto&start=0&end=20`: success, 20 events with nested contracts; some listed-open short-duration contracts were already closed at the single-market endpoint.
- `GET https://api.jup.ag/prediction/v1/markets/{id}`: 43 individually read rule sets, including 39 open contracts and four closed rejects. Nineteen additional individual detail responses matched the preserved BTC/SOL evidence. Live seeding succeeded with 32 approvals, seven candidates and four rejects. Exact IDs/hashes/reasons are in `apps/api/src/theme-manifest.ts` and `src/data/reviewed.ts`.
- `GET https://api.jup.ag/prediction/v1/events?provider=kalshi&filter=trending&includeMarkets=true&category=crypto&start=0&end=2`: HTTP 200, `data: []`. No Kalshi data was invented.
- `HEAD https://gamma-api.polymarket.com/markets`: HTTP 200, deprecated legacy endpoint warning, directs to `/markets/keyset`. It is not the production ingestion adapter.
- `GET https://gamma-api.polymarket.com/markets/keyset?limit=1&active=true&closed=false`: HTTP 200 with actual market records. This current endpoint is used for worker connectivity probes.
- An early `HEAD https://api.elections.kalshi.com/trade-api/v2/markets` curl attempt failed to connect. Later GETs with `?limit=1&status=open` succeeded with HTTP 200 and actual records at both the elections host and `https://external-api.kalshi.com/trade-api/v2/markets`. No insecure TLS retry was attempted. These live successes supersede any assertion that direct Kalshi is permanently unavailable.

Direct connectivity probes cache their original checked timestamp for 60 seconds, shorter than the worker cycle, so each regular cycle refreshes the probes rather than repeatedly presenting aging cached checks. Transient failures and later recoveries are reported honestly; connectivity alone does not make an unreviewed contract eligible for terminal quotes or signals. Gamma, Kalshi elections and Kalshi external probes appear as separate health entries, not independent prediction venues in theme consensus.

Official price/rule references read: [Jupiter Get Events](https://developers.jup.ag/docs/api-reference/prediction/get-events.md), [Jupiter Get Market](https://developers.jup.ag/docs/api-reference/prediction/get-market.md), and [Velocity documentation](https://docs.velocity.exchange/). The seed/review/worker paths do not depend on saved external tool output.

## Verification Status

- Docker Compose PostgreSQL and Redis were started/checked healthy at the specified project ports.
- Initial migration was applied to the real project PostgreSQL successfully and then rerun successfully: schema version 1 and 20 public tables.
- `docker compose config --quiet` passed. Node's TypeScript syntax checks passed for every API source/test/fixture and shared source file; this is not a substitute for TypeScript typechecking.
- After the parent installed dependencies, API TypeScript checking and builds passed. Shared TypeScript checking/builds and real ESLint checks passed. Two incompatible older entrypoints were routed to the same current runtime; their distinct review evidence was retained and re-verified rather than discarded.
- API unit/provider tests passed; the real-service integration run passed all 31 API tests. It exercises PostgreSQL/Redis, session expiration/logout, parallel replay denial, colon-bearing theme IDs, watchlists/alerts, request validation, CORS, CSP, direct-IP Redis rate limits, body limits, deny-all execution despite spoofed geography, WebSocket origin/policy, and actual pub/sub invalidation. Shared math tests passed all six tests, including the 60-minute defaults, exact mirrored formula, configurable W, thresholds, seven-day bounds, and no lookahead.
- `pnpm seed:themes` successfully fetched all 43 live contract details and persisted 43 initial review records. `pnpm review:themes list` confirmed reasons and statuses. Real worker cycles have persisted further prediction/perp samples; no test fixture is used as runtime data.
- The running API on `http://127.0.0.1:4100` returned actual terminal data (43 themes, 32 approved, five discovered perps), 48 actual SOL hourly candles, and nonempty collected theme/perp history. `/health` reports live infrastructure/worker state and correctly degrades on partial upstream failures. Zero signals are expected while the real hourly-baseline history is insufficient.
- API and worker were started as detached background processes with logs `parallax-api.log` and `parallax-worker.log` in the workspace. Process details are included in the final handoff. No dependency installation was run during this follow-up.
- No order was submitted or signed; no on-chain order test is claimed. Tests of detached wallet authentication signatures are not trading execution tests.

## Running Handoff

Verified after the restarted worker completed its current-code cycle on October 29, 2026 at 14:34:36 UTC:

- API launcher PID `84016`, watcher PID `84042`, serving process PID `85797`; command `nohup pnpm --filter @parallax/api dev > parallax-api.log 2>&1 < /dev/null &`.
- Worker launcher PID `85906`, nested pnpm PID `85918`, tsx PID `85933`, worker process PID `85939`; command `nohup pnpm worker >> parallax-worker.log 2>&1 < /dev/null &`.
- Previous worker was signaled gracefully and exited cleanly before replacement. No duplicate ingestion lease was left running.
- `/health`: HTTP 200, `status: healthy`, PostgreSQL/Redis available, worker fresh. `/terminal`: 43 themes, 32 approved, five actual perps, zero warmup signals. Jupiter's latest cycle recorded 39 detail updates and zero failures.
- Direct Gamma, Kalshi elections, and Kalshi external health entries were healthy. Aggregate Kalshi remained correctly degraded for lack of reviewed/mapped terminal contracts, not because the public API was unreachable.
- PostgreSQL contained 314 actual prediction snapshots covering 43 contracts, 35 perp snapshots across five symbols, and 43 preserved initial reviews. These counts continue increasing as the worker runs.
- SOL hourly candles returned 48 records; `sol-110-october` history returned eight actual probability samples and seven perp samples. External WebSocket verification against the serving API received a real Redis-backed update event.

The API development watcher can change its serving child PID after source edits; launcher PID is the stable process-tree root. Logs are normal stdout/stderr captures, not configuration or secret files. The web process remains owned and managed by the parent task.

## Correctness Review

The final backend/shared review corrected the follower signs to use raw probability delta and raw perp log return, rather than z-score sign, and added zero-change leader suppression. Synthetic-only regression tests exercise a nonzero baseline mean that reverses the raw/z-score sign, for both mirrored signals. API freshness is enforced independently of worker progress and cache age without changing source capture times or deleting historical observations.

Consensus no longer invents equal liquidity weights: single-contract midpoints remain usable, while multi-contract groups use only known finite positive liquidity after identity deduplication and return null when all weights are unknown/unusable. Multi-contract historical averaging is intentionally disabled until time-aligned liquidity evidence exists. The current terminal contains no seeded multi-venue equivalent groups, so this does not manufacture additional venue coverage.

`rulesDiff` is a tested diagnostic helper, also displayed by `review:themes inspect`: it flags >24-hour close differences, missing/invalid closes, differing/unknown named sources and numeric thresholds, and opposite outcome orientation. It is not a semantic rules engine; the exact reviewed equivalence gate remains conservative. Builder clamp tests cover negative/fractional finite values, both infinities and NaN.

Post-review checks passed: **36 API tests with real PostgreSQL/Redis integration, seven shared-math tests, API/shared typecheck, actual ESLint and builds**. Live inspection of `POLY-5611739` printed its current source rules and all clear diagnostic flags against stored rules. A live terminal read immediately after the October 29 noon-ET contracts expired showed null live quotes with their original capture times before the next worker cycle could downgrade mapping status, confirming API-side expiry enforcement independently of worker progress. Existing SOL history remained available with 32 actual probability samples and 31 perp samples at that check; collection continues.

The worker was gracefully restarted to load the corrected shared math; its current launcher PID is `92495` (`pnpm worker`, appending to `parallax-worker.log`), superseding the earlier handoff's worker PID. At 16:02:13 UTC the replacement completed a cycle and `/health` returned HTTP 200, healthy, with a fresh heartbeat. The terminal contained 43 entries: **31 currently approved, eight candidates, four rejected**, five perps and zero warmup signals. The decrease from 32 approvals is the legitimate expiry downgrade of the October 29 BTC noon contract, not a replaced or fabricated review. Live checks found **zero stale non-null prediction midpoints and zero expired non-null prediction midpoints**. API launcher PID `84016` remains active; no web/root-manifest changes or execution SDK were added in this review.

## Terms and Documentation Follow-Up

- Official [Polymarket API guide](https://docs.polymarket.com/getting-started/api.md), [trading overview](https://docs.polymarket.com/trading/overview.md), and [builder program](https://docs.polymarket.com/programs/builders/overview.md) were fetched. They confirm public data, EIP-712 L1/HMAC L2 authentication, Polygon settlement, and signed-order builder attribution. No execution or builder account was created. Current documentation describes pUSD; the implementation does not assume older collateral conventions or adapt Solana signatures to EVM auth.
- [Kalshi rate limits](https://docs.kalshi.com/getting_started/rate_limits.md) now describe token buckets for authenticated requests, usually ten tokens per request; Basic predictions read budget is 200 tokens/second. This does not establish the anonymous public-IP limit. The page explicitly says 429 responses do not currently carry Retry-After or X-RateLimit headers and recommends exponential backoff. No rate-limit stress test was performed.
- [Kalshi introduction](https://docs.kalshi.com/welcome/index.md) links the [Developer Agreement](https://kalshi.com/developer-agreement) and says API use is bound by it. The agreement URL was fetched, but the available page text contained site chrome rather than a usable agreement body. Commercial redistribution authorization is not verified. Owner/legal review remains required before public/commercial launch.
- The [Velocity terms page](https://docs.velocity.exchange/protocol/legal-and-regulations/terms-of-use) was fetched but yielded only navigation/title text. It is not evidence that legal review is complete or that any jurisdiction is permitted.
- The [Jupiter Prediction overview](https://developers.jup.ag/docs/prediction/index.md) was re-fetched: API is beta, keyless access is 0.5 RPS, and United States/South Korea IPs are restricted. No proxy is presented as a way to evade a provider restriction. Geography and data-use review must cover research distribution as well as trading. Polymarket's complete current geographic list and anonymous rate limits were not established in the fetched pages; do not assume unlimited access or a cleared commercial license.

## Full-Stack Verification

The web app was exercised with Playwright in isolated Chrome sessions at desktop and phone widths against real running services. Production browser console checks returned no errors/warnings. Tests cover overview, a real theme, real chart history, market search/filter, wallet dialog dismissal, signal warmup, portfolio limitations, Telegram disabled state, legal drafts, and visible API failure without demo prices. Screenshots are in `apps/web/test-results/` after `pnpm test:e2e`.

A direct SQL verification recorded 43 stored contracts/reviews, 31 approved, eight candidates and four rejected, 1,434 real prediction snapshots and 180 perp snapshots. Counts grow while the worker runs. PostgreSQL and Redis were healthy under `docker compose ps`; `/health` returned HTTP 200 with a fresh worker and trading disabled. These facts verify live research ingestion, not a direct Kalshi snapshot adapter, multi-venue equivalence, Telegram delivery or blockchain execution.

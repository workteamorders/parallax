# Deploying

Two modes. Use **live-only** while you are on devnet (free, Vercel only). Move to **full** (Railway or similar)
only when you want stored history and signals, for example before mainnet.

## Mode A: live-only on Vercel (devnet stage, no database, no Railway)

The web app's `/api/*` routes answer straight from the public sources (Velocity stats and candles, Jupiter
contract detail), using the same parsers and the same manifest review check as the seed. Nothing is stored.

What works: probabilities and perp prices for contracts that are still open and still match their reviewed
fingerprint, perp candles, the devnet trading panel. What does not exist in this mode, and is shown as
unavailable rather than invented: stored history charts, divergence signals, wallet sessions, watchlists, alerts.
A contract that cannot be verified live is shown as a candidate with no quote; nothing is ever shown as approved
unless it was checked against its reviewed rules during the same refresh.

Vercel project settings: Root Directory `apps/web` (keep "include files outside the root directory" on, the web
app imports the reviewed manifest from `apps/api`). Environment variables:

```
PARALLAX_LIVE_MODE=1
SOLANA_NETWORK=devnet
DEVNET_TRADING_ENABLED=true          # shows the devnet test panel
NEXT_PUBLIC_FEED_URL=off             # build time: no WebSocket, the page refreshes every 30 s
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com   # optional, devnet only
```

Redeploy after changing any `NEXT_PUBLIC_*` value. The same mode runs locally with no Docker:
`PARALLAX_LIVE_MODE=1 DEVNET_TRADING_ENABLED=true NEXT_PUBLIC_FEED_URL=off pnpm dev:web`.

Not verified from the build workspace: the real upstream calls. That workspace cannot reach Jupiter or Velocity,
so only the failure path (everything unavailable, nothing invented) was exercised end to end; the success path
is covered by unit tests with recorded fixtures. Check `/api/terminal` on your own deployment once.
Rate limits: contract checks run three at a time and are cached (60 s) by the platform; if Jupiter answers 429
the affected contracts show as unverified until the next refresh.

## Mode B: full (stored history and signals)

The web app on Vercel is only the front end. Every page reads `/terminal`, `/candles` and `/themes/*/history`
through its `/api/*` proxy, which forwards to `API_INTERNAL_URL`. Without a reachable API the site shows the
honest empty state ("Awaiting ingestion"), which is exactly what a bare Vercel deploy does today: its default
`API_INTERNAL_URL` is `http://127.0.0.1:4100`, a loopback address that does not exist on Vercel.

You need four things running somewhere that can make outbound HTTPS calls to Jupiter and Velocity:

| Service | What | Notes |
| --- | --- | --- |
| PostgreSQL 17 | history, reviews, sessions | any managed Postgres |
| Redis 7 | caches, rate limits, ingestion lease, feed pub/sub | any managed Redis |
| API | `pnpm --filter @parallax/api start` | image: root `Dockerfile` |
| Worker | `pnpm --filter @parallax/api worker` | same image, different command; run exactly one |

## Backend environment (API and worker)

```
NODE_ENV=production
DATABASE_URL=<postgres url>
REDIS_URL=<redis url>
WEB_ORIGIN=https://<your-vercel-domain>        # exact origin, must be https in production
SOLANA_NETWORK=devnet
DEVNET_TRADING_ENABLED=false                   # true shows the browser devnet ticket; see DEVNET-TRADING.md
```

The image sets `API_HOST=0.0.0.0`. If the host injects `PORT`, the API uses it when `API_PORT` is unset.
The API runs migrations itself at startup (advisory-locked). Run `pnpm seed:themes` once against the production
database (`pnpm --filter @parallax/api seed:themes` from a shell with the same env) so the reviewed contracts exist;
the worker then records snapshots. History and signals only exist after real elapsed collection time.

## Vercel environment (web project, root directory `apps/web`)

```
API_INTERNAL_URL=https://<api-host>             # server-side proxy target
WEB_ORIGIN=https://<your-vercel-domain>         # must equal the API's WEB_ORIGIN exactly
NEXT_PUBLIC_FEED_URL=wss://<api-host>/feed      # build time; also whitelisted in the CSP
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com   # optional, devnet only
NEXT_PUBLIC_BUILDER_ADDRESS=                    # optional, empty means no builder fee
```

Redeploy after changing any `NEXT_PUBLIC_*` value; they are baked into the build.

## Known caveats

- Not verified from this workspace: the container image was not built (no Docker daemon here). The same start
  commands were run directly with production settings against local Postgres and Redis: the API bound `PORT` on
  `0.0.0.0`, `/health` and `/terminal` answered, CORS allowed only the configured origin, `/trade` returned 403, and
  the worker acquired its lease. Live ingestion from Jupiter and Velocity could not be exercised because this
  workspace cannot reach those hosts.
- The API is publicly reachable in this layout. Redis-backed rate limits apply, but all proxied browser traffic
  shares the Vercel server's IP, so the per-IP budgets are shared by all visitors. Put the API behind an
  authenticated edge or raise the budgets deliberately before real traffic.
- Country headers are still not trusted. Execution location checks remain deny-all server side; devnet trading is a
  browser-only test feature with no real funds.
- Next.js is 16.4.3. (16.4.0 stopped the first build with a security notice; see DECISIONS.)

## Mainnet flags (off by default, read docs/MAINNET-CHECKLIST.md first)

```
SOLANA_NETWORK=mainnet-beta
MAINNET_TRADING_ENABLED=true                     # separate from DEVNET_TRADING_ENABLED
NEXT_PUBLIC_SOLANA_RPC_URL=https://<your mainnet RPC>   # required, https, not devnet/testnet/local
NEXT_PUBLIC_MAINNET_MAX_DEPOSIT_USD=10           # optional, can only lower the built-in $25 ceiling
NEXT_PUBLIC_MAINNET_MAX_ORDER_USD=5              # optional, can only lower the built-in $10 ceiling
```

`NEXT_PUBLIC_*` values are read at build time, so redeploy after changing them.

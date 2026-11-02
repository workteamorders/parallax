# Devnet test trading

Status: implemented, **not verified end to end**. No order has been signed against Solana devnet from this
code. It was type-checked against the real SDK types, unit-tested for its arithmetic, and rendered in a real
browser, but the sign-and-send path needs a funded devnet wallet that only the owner can supply.

## How it works

- `DEVNET_TRADING_ENABLED=true` on the API (and `SOLANA_NETWORK=devnet`) makes `/terminal` report
  `trading.enabled: true`. On `mainnet-beta` the flag is ignored. `POST /trade` stays 403 either way: the server
  never builds, signs or relays a transaction and holds no key.
- The web app then shows a "Devnet test trading" panel on theme pages. It lazy-loads
  `@velocity-exchange/sdk` 0.27.0 in the browser, builds instructions with the SDK's `get...Ix` methods, runs
  `simulateTransaction` first, and only then asks your wallet (Wallet Standard via the existing adapter) to sign.
  A simulation error aborts before the wallet prompt.
- Only a devnet RPC is accepted (the host must contain `devnet`). The market index from the public feed is checked
  against the devnet market's name before any order is built; a mismatch disables the order button.
- Builder fee: off unless `NEXT_PUBLIC_BUILDER_ADDRESS` is set. When set, the user first approves the builder
  (escrow + `changeApprovedBuilder`), then orders carry the builder's index (read from the on-chain escrow, never assumed) and the configured fee, clamped to 100
  tenths of a bp (protocol maximum 1000). The builder must also have a `RevenueShare` account; that is the
  builder owner's one-time setup (`initializeRevenueShare`).
- Collateral is dUSDT (`GqmEqYsy8EyvofDpmtFxK8zhYrgWgNokAtYoduQdL7v6`). Getting dUSDT is up to you: the faucet
  program id is not in the public docs and was not guessed. The devnet mint exists and has 6 decimals (checked
  against devnet RPC from the owner's browser); the Velocity program also exists on devnet.

## What was and was not checked

Checked: arithmetic (no float noise, rounding toward the passive side, fee clamps), devnet-only RPC guard,
TypeScript against the real SDK types, production build, SDK loading in Chromium, panel rendering and CSP.
Not checked: account creation, deposit, order, cancel, builder approval, `simulateTransaction` against the real
program, wallet-extension signing, devnet market indexes, fees, margin, funding, liquidation behavior.

## Owner checklist

1. Get a devnet wallet with SOL and dUSDT in your own wallet app. Never paste a private key anywhere.
2. Set the flags, open a theme page with a linked perp, open the devnet session.
3. First do "Create account and deposit" with a tiny amount; read the simulation result if it fails.
4. Place a small limit order far from the market with post-only on, then cancel it. Only then try a market order.
5. Report any simulation error text you see; it names the failing instruction.

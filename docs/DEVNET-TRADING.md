# Devnet test trading

Status: implemented and checked against the real devnet program by **simulation**. No transaction has been
signed or sent from this code: simulation needs no signature, and only the owner's funded wallet can do the
real sign-and-send. See "What was and was not checked".

## How it works

- `DEVNET_TRADING_ENABLED=true` on the API (and `SOLANA_NETWORK=devnet`) makes `/terminal` report
  `trading.enabled: true`. On `mainnet-beta` the flag is ignored. `POST /trade` stays 403 either way: the server
  never builds, signs or relays a transaction and holds no key.
- The web app then shows a "Devnet test trading" panel on theme pages. It lazy-loads
  `@velocity-exchange/sdk` 0.27.0 in the browser. The SDK's browser build cannot construct `VelocityClient`,
  `Program` or `AnchorProvider` (they throw by design), so instructions are built with the subscription-free
  `VelocityCore` plus a small `program.instruction` shim over the camelCased IDL (`lib/velocity-program.ts`).
  The panel then runs `simulateTransaction` first, and only then asks your wallet (Wallet Standard via the existing adapter) to sign.
  A simulation error aborts before the wallet prompt.
- Only a devnet RPC is accepted (the host must contain `devnet`). The market index from the public feed is checked
  against the devnet market's name before any order is built; a mismatch disables the order button.
- Builder fee: off unless `NEXT_PUBLIC_BUILDER_ADDRESS` is set. When set, the user first approves the builder
  (escrow + `changeApprovedBuilder`), then orders carry the builder's index (read from the on-chain escrow, never assumed) and the configured fee, clamped to 100
  tenths of a bp (protocol maximum 1000). The builder must also have a `RevenueShare` account; that is the
  builder owner's one-time setup (`initializeRevenueShare`).
- Collateral is dUSDT (`GqmEqYsy8EyvofDpmtFxK8zhYrgWgNokAtYoduQdL7v6`, 6 decimals, classic SPL Token). Its mint
  authority is the PDA of the SDK's token faucet program (`V4v1mQiAdLz4qwckEb45WqHYceYizoib39cDBHSWfaB`), so the
  panel offers a "Get 100 test dUSDT" button that creates your token account if needed and calls `mint_to_user`.
  The button only appears when the on-chain mint authority equals that faucet PDA.
- Devnet has perp markets 0 SOL-PERP, 1 BTC-PERP and 2 ETH-PERP only. HYPE-PERP and ZEC-PERP exist in the public
  mainnet-data feed but not on devnet, and the panel says so instead of trading them.

## What was and was not checked

Checked against the real devnet deployment (read through the owner's browser):
- Account layouts: `State` (1752 bytes), `SpotMarket` (1064), `PerpMarket` (1560) and their discriminators match
  the IDL coder exactly; spot market 0 is dUSDT, perp markets 0 to 2 are SOL, BTC and ETH.
- `simulateTransaction` with the real programs, one transaction containing: create token account (idempotent),
  faucet `mint_to_user`, `initialize_user`, `deposit` 10 dUSDT, `place_perp_order` (market long 0.0001 BTC) and
  `cancel_orders`. Result: no error. The program also rewrote the auction prices from the devnet oracle, so the
  market-order price cap was accepted.
- A separate simulation showed the program decoding `initialize_user_stats` and `deposit` correctly (it rejected
  them only because the borrowed fee-payer already had stats and no user account).
- Offline: instruction bytes and account lists are identical to the real Anchor `Program` for deposit, user and
  stats init, builder escrow init and approval, market and limit orders with a builder code, and cancel
  (`velocity-program.test.ts`); the session flows run against a fake RPC (`velocity-trade.test.ts`); the
  production bundle opens a session, reads the market and balance and reaches the wallet prompt in Chromium
  with a fake wallet and a mocked RPC.

Not checked: any transaction signed by a real wallet and confirmed on chain; the builder-code path against the
real program (only encoded and compared offline); withdrawals (not implemented); fills, funding, margin
behavior and liquidation; wallet-extension signing in Phantom.

## Owner checklist

1. Get a devnet wallet with SOL (faucet.solana.com) in your own wallet app. dUSDT comes from the panel's faucet button. Never paste a private key anywhere.
2. Set the flags, open a theme page with a linked perp, open the devnet session.
3. First do "Create account and deposit" with a tiny amount; read the simulation result if it fails.
4. Place a small limit order far from the market with post-only on, then cancel it. Only then try a market order.
5. Report any simulation error text you see; it names the failing instruction.

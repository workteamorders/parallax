# Devnet test trading

Status: implemented, checked against the real devnet program by simulation, and **exercised once end to end by the
owner on 2026-11-03** with Phantom (Testnet Mode, Solana Devnet) on the deployed Vercel site. See "What was and was
not checked".

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

Exercised by the owner on 2026-11-03 (Phantom, devnet, the deployed site; the panel reported each as confirmed
on devnet and showed its signature):
1. "Get 100 test dUSDT": wallet dUSDT went from 0 to 100.
2. "Create account and deposit" 10: the Velocity account changed from "Not created yet" to "Created" and wallet
   dUSDT went from 100 to 90.
3. Long market 0.001 BTC and 4. Short market 0.001 BTC: both confirmed.
5. "Cancel all orders on this market": confirmed.
A first order attempt showed "User rejected the request" because the wallet prompt was declined; nothing was sent.
The owner did not look the transactions up in an explorer in this session, and the panel does not show positions,
so whether the market orders filled, and the resulting position, is not verified.

MetaMask: its Solana network list offered Mainnet only (no Devnet, with "Show test networks" on), so its signing
prompt said "Solana Mainnet" and its own simulation reverted. The app cannot choose the network for the wallet:
`signTransaction` receives no chain. Use a wallet that can be switched to devnet (Phantom Testnet Mode worked). Do
not approve a prompt that says Mainnet.

Exercised by the owner later on 2026-11-04 (Phantom, devnet, the deployed site; each confirmed on devnet with a signature):
6. Withdraw of the full account balance when no perp record existed: 49.700766 dUSDT went back to the wallet, account collateral 0.
7. Deposit 10, limit order (post only) placed far from the market, then Cancel all.
8. Long market 0.001 BTC **filled** (the panel then offered "Close position (sell 0.001 BTC, reduce only)"), and Close position
   returned the position to None. The round trip cost about $0.40 of collateral (fees plus the price cap) on a $77 notional.
9. Withdraw of 9 dUSDT after the close: 9 dUSDT back in the wallet, 0.595794 left in the account.

Things the owner's runs showed, worth knowing:
- Open orders count toward the margin requirement. With two stale open orders (earlier market orders that had not filled
  yet), a new limit order was refused in simulation with InsufficientCollateral (6003); Cancel all fixed it.
- After a position is closed, the account still carries a perp record with unsettled PnL. A withdrawal of the **whole**
  balance was refused in simulation (InsufficientCollateral); withdrawing a bit less worked. Nothing was sent when it was refused.
- In a browser with an Indonesian locale, a price typed as 40.000 is read as 40, not 40,000. Type 40000 and check the
  "Reference notional" row before signing.
- The collateral line is the spot balance read with the interest index from when the session opened; it can be one
  micro-unit off (9.999999 after a deposit of 10).

Not checked on chain: the builder-code path (only encoded and compared offline), the short side after the first
trials, funding and liquidation behavior, other wallets, and anything on mainnet. The collateral line excludes
unrealized PnL, funding and fees.

MetaMask: its Solana network list offered Mainnet only (no Devnet, with "Show test networks" on), so its signing
prompt said "Solana Mainnet" and its own simulation reverted. The app cannot choose the network for the wallet:
`signTransaction` receives no chain. Use a wallet that can be switched to devnet (Phantom Testnet Mode worked). Do
not approve a prompt that says Mainnet.

## Owner checklist

1. Get a devnet wallet with SOL (faucet.solana.com) in your own wallet app. dUSDT comes from the panel's faucet button. Never paste a private key anywhere.
2. Set the flags, open a theme page with a linked perp, open the devnet session.
3. First do "Create account and deposit" with a tiny amount; read the simulation result if it fails.
4. Place a small limit order far from the market with post-only on, then cancel it. Only then try a market order.
5. Report any simulation error text you see; it names the failing instruction.

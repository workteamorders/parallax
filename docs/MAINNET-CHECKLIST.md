# Mainnet checklist

Status: **built, off by default.** Mainnet trading code exists but nothing enables it unless you set
`SOLANA_NETWORK=mainnet-beta` **and** `MAINNET_TRADING_ENABLED=true` (a flag separate from `DEVNET_TRADING_ENABLED`,
which can never turn mainnet on). `POST /trade` is still always 403: the server never signs or relays anything.
Do not set those flags until every item in sections 1 and 3 is ticked.

What the code enforces on mainnet (all in the browser, `lib/trade-network.ts`, with tests):
- The RPC must be https and must not look like devnet, testnet or local. `NEXT_PUBLIC_SOLANA_RPC_URL` has no mainnet default; set it to a mainnet RPC.
- The quote asset must be the mainnet USDT mint (`Es9vMFrz…NYB`); any other mint stops the session.
- The test faucet is disabled.
- Ceilings in code: at most $25 collateral in the account and $10 per new order. Configuration can only lower them
  (`NEXT_PUBLIC_MAINNET_MAX_DEPOSIT_USD`, default $10; `NEXT_PUBLIC_MAINNET_MAX_ORDER_USD`, default $5). The deposit
  limit counts what the account already holds. The order limit is measured at the price cap. Closing and withdrawing are never limited.
- You must type MAINNET before a session opens, and the panel carries a red warning with the limits.

## 0. Your own limits (fill these in before anything else)

- Most I accept to lose in total: $5
- Largest single order: $3
- Largest total deposit into Velocity: $5
- Date I decided these numbers: 2026-11-04

Reference point: the wallet you gave me (MetaMask, `41us3N…u5bu`) holds 0.0949 SOL. At the SOL-PERP price on the site
that day (about $93.5) this is roughly $8.9 in total. The collateral on Velocity is a stablecoin, not SOL, so you would
first have to swap SOL for it, and you must keep some SOL for network fees and the one-time account rent. With about
$9 in total, the order size you can use is very small and fees are a large share of it.

## 1. Proven on devnet (done by you on 2026-11-03 and 2026-11-04)

- [x] Faucet, create account and deposit, market long and short, cancel all
- [x] Position and collateral view shows the numbers you expect after an order
- [x] Long market order filled, and **Close position** brought the position to zero (reduce-only)
- [x] **Withdraw to wallet** returned funds (the full balance when no perp record existed; 9 of 9.6 after a trade)
- [x] Limit order (post only) placed and cancelled
- [x] You looked up at least one of these transactions in a Solana explorer (devnet) and saw it confirmed

Known behaviours to expect on mainnet too:
- A round trip (open then close) costs real money: about 0.5% of the notional in the devnet run. On a $5 order that is a few cents; fees on mainnet may differ.
- After closing, withdrawing the whole balance can be refused until a little is left; withdraw slightly less. A small remainder may stay in the account.
- Open orders use margin. Cancel them before depositing or withdrawing around a trade.

## 2. Built (code), still to be proven

- [x] Separate mainnet flag, off by default
- [x] Hard caps in code on deposit and new orders, clamped to ceilings
- [x] Mainnet RPC and USDT mint checks, faucet disabled, type-MAINNET unlock, red warning
- [x] Simulation before every wallet prompt (same path as devnet)
- [ ] A paid RPC endpoint set in `NEXT_PUBLIC_SOLANA_RPC_URL` (public RPCs rate-limit and can drop transactions)
- [ ] First real run by you with the smallest amount (section 4); nothing in this code has touched real funds yet. Close and Withdraw are proven on devnet only.
- [ ] Mainnet may gate new accounts behind a whitelist ticket token (the program state has a whitelist mint). If so, creating the account fails in simulation and nothing is sent; that is expected and safe.

Honest limit: the app cannot check which network your wallet is set to. Signing receives no chain, and the app sends the
signed transaction through its own RPC, so the transaction goes to mainnet whatever the wallet shows. Read the wallet
prompt: it should say Solana Mainnet and show the amount you meant.

## 3. Not code, but required

- [ ] Legal review: offering or facilitating derivatives trading may be regulated where you and your users are
- [ ] Permission to use the market data feeds commercially (check each source's terms)
- [ ] Backend (Railway) running in full mode on devnet and stable for some days
- [ ] Edge hardening: CSP headers, rate limits, and no secrets in the browser bundle
- [ ] Builder-fee setup tested on devnet, or kept off

## 4. First mainnet session (only after 1 to 3)

1. Use a fresh wallet that holds only what section 0 allows.
2. Deposit the smallest amount that works, not the maximum.
3. Open one tiny position, then close it. Do not hold it.
4. Withdraw everything back to the wallet and check the balance on an explorer.
5. Stop and look at the fees you actually paid before doing anything larger.

## 5. What this project does not do

- It does not give investment advice, hold keys, or sign for you. Your wallet signs every transaction.
- It cannot promise a position fills at the displayed price, or that a hedge works.
- Collateral shown in the panel is approximate and excludes unrealized PnL, funding and fees.

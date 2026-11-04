# Recorded mainnet demo: runbook

Goal: a recorded, real-money demo of every feature, with the least possible chance of losing more than you decided
to lose or of leaking something on video. Do the parts in order. Do not skip the rehearsal.

## A. Before you touch mainnet

1. Fill section 0 of `MAINNET-CHECKLIST.md` (your loss limit). Write the number down. When the budget is spent, stop recording.
2. **Devnet rehearsal, recorded or not, with every feature.** Do the full script in section D on devnet first. Anything
   that fails on devnet will fail on mainnet, only with real fees. Do not go on until every step has worked once.
3. Use a **fresh wallet** for the demo (new Phantom or MetaMask profile). Send it only what the budget allows. Never the
   wallet that holds your savings. Its address will be visible in the recording, and so will its balance and transactions.
4. Paid RPC: create the key and **restrict it to your site's domain** in the provider's dashboard. A `NEXT_PUBLIC_` key is
   readable by anyone who opens the browser's network tab, including in your recording. Never open the Vercel env page on camera.
5. Convert SOL to USDT before recording, in your wallet's swap or on a swap site, **not** on camera with your seed phrase
   anywhere near. Keep at least 0.03 SOL for fees and account rent. The USDT goes to the demo wallet.
6. Redeploy with the mainnet flags (see `DEPLOY.md`). Check the site header shows MAINNET and the panel shows the red banner.

## B. Things that can go wrong, and what it means

- **"Order blocked by the safety limit":** the order is above the per-order cap. The cap is at most $10 in code. If a market's minimum
  order size is above $10, the app cannot place orders there at all; pick another market or change the code on purpose.
- **Simulation fails on "create account":** mainnet may require a whitelist ticket token for new accounts. Nothing is sent.
  Stop and tell me the exact error text.
- **"Mainnet needs a mainnet RPC endpoint":** `NEXT_PUBLIC_SOLANA_RPC_URL` is missing or looks like devnet. Fix and redeploy.
- **Order sent but not filled yet:** wait and press the refresh or reopen the session. Do not send it twice.
- **Withdraw fails with an open position:** close the position first, then withdraw.
- **Withdraw of the whole balance is refused after a trade (InsufficientCollateral):** this happened on devnet. Withdraw a bit less
  (for example the balance minus $0.60); the remainder is a small leftover in the account. Say so on camera instead of hiding it.
- **A new order is refused with InsufficientCollateral while the account looks fine:** stale open orders use margin. Press Cancel all first.
- **Typing prices:** type 40000, not 40.000. In a browser with an Indonesian locale the dot reads as a decimal point. Check "Reference notional" before signing.

## C. What must not appear on camera

- Seed phrase or private key, the wallet's "show secret" screens, password manager.
- The Vercel or RPC provider dashboards, env variable pages, API keys.
- Your email, other open tabs (record one window only), notifications.
- Say "not financial advice", and that perpetual futures can be liquidated.

## D. Feature script (same on devnet and mainnet)

1. Open the site, show the header (network badge, wallet address shortened).
2. Connect the wallet. Show that the wallet prompt names the right network.
3. Open the session (mainnet: type MAINNET first). Show the market, wallet balance and the safety limits.
4. Create the account and deposit the smallest workable amount. Show the confirmed signature, then open it in an explorer.
5. Show the account collateral line and the position line.
6. Place a **limit order far from the market, post only**. Show it is open. Press **Cancel all orders**. Show it is gone.
7. Place one tiny **market order** (Long). Show the position and its entry price. On devnet it filled within seconds; on mainnet wait
   a short while and press nothing twice. If it stays "Flat, 1 open order(s)", cancel it and say it did not fill.
8. **Close position.** Show the position is None.
9. Type a withdrawal amount slightly below the collateral (or use **Fill with all collateral** and lower it by about $0.60), then **Withdraw**.
   Show the USDT back in the wallet and open the transaction in an explorer. Mention the small remainder left in the account.
10. Say what it cost: compare the starting and ending wallet balance, including SOL. That number is the honest cost of the demo.

Skipped on purpose: builder fee (off unless configured), the test faucet (devnet only), short side (same code path as long;
do it on devnet).

## E. After recording

- Withdraw everything and confirm the balance in an explorer.
- Switch the deployment back to devnet (unset `MAINNET_TRADING_ENABLED`) unless you intend to keep mainnet open to others.
  Leaving mainnet on means anyone who opens the site can use it with their own wallet.
- Rotate or delete the demo RPC key.
- Legal: a public mainnet trading demo may be regulated where you and your viewers are. This project does not give legal advice.

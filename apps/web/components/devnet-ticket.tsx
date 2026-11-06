"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { CircleAlert, CircleCheck, LoaderCircle, FlaskConical, TriangleAlert, X } from "lucide-react";
import type { Perp } from "@parallax/shared";
import { useObservatory } from "./provider";
import { usd } from "@/lib/format";
import { addActivity, explorerTxUrl, loadActivity, saveActivity, type Activity } from "@/lib/activity";
import {
  builderFeeUsd,
  clampBuilderFee,
  decimalToUnits,
  worstPriceUnits,
  type Side,
} from "@/lib/trade-math";
import { depositLimitError, orderLimitError, parseMainnetLimits } from "@/lib/trade-network";
import {
  DEVNET_RPC_DEFAULT,
  FAUCET_AMOUNT_UNITS,
  TradeError,
  approveBuilder,
  cancelAllOnMarket,
  closePosition,
  createAccountAndDeposit,
  depositMore,
  devnetMarketMatches,
  devnetMarketName,
  findApprovedBuilderIndex,
  hasUserAccount,
  mintTestQuote,
  openSession,
  placeOrder,
  readAccountSummary,
  walletQuoteBalance,
  withdrawQuote,
  type AccountSummary,
  type Session,
  type SignerWallet,
} from "@/lib/velocity-trade";

const RPC_ENV = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
/** Hard limits for mainnet, clamped to the ceilings in trade-network.ts whatever the configuration says. */
const MAINNET_LIMITS = parseMainnetLimits({
  maxDepositUsd: process.env.NEXT_PUBLIC_MAINNET_MAX_DEPOSIT_USD,
  maxOrderUsd: process.env.NEXT_PUBLIC_MAINNET_MAX_ORDER_USD,
});
const limitDollars = (units: bigint) => `$${(Number(units) / 1e6).toFixed(2)}`;
const BUILDER_ADDRESS = process.env.NEXT_PUBLIC_BUILDER_ADDRESS ?? "";

const unitsToDecimal = (units: bigint, decimals: number) => {
  const text = units.toString().padStart(decimals + 1, "0");
  return `${text.slice(0, -decimals)}.${text.slice(-decimals)}`.replace(/\.?0+$/, "");
};

const signedUnitsToDecimal = (units: bigint, decimals: number) =>
  `${units < 0n ? "-" : ""}${unitsToDecimal(units < 0n ? -units : units, decimals) || "0"}`;

type Notice ={ tone: "ok" | "error"; text: string; logs?: string[] } | null;

/** A pop-up for one action. It starts as "pending", then becomes "ok" or "error". Errors stay until closed. */
interface Toast {
  id: number;
  tone: "pending" | "ok" | "error";
  title: string;
  text: string;
  signature?: string;
}

const TOAST_OK_MS = 12_000;
const explorerUrl = (signature: string, network: "devnet" | "mainnet-beta") =>
  `https://explorer.solana.com/tx/${signature}${network === "devnet" ? "?cluster=devnet" : ""}`;

export function DevnetTicket({ perp }: { perp?: Perp }) {
  const { data } = useObservatory();
  const wallet = useWallet();
  const network = data?.trading.network === "mainnet-beta" ? "mainnet-beta" : "devnet";
  const isMain = network === "mainnet-beta";
  const quoteName = isMain ? "USDT" : "dUSDT";
  const rpcUrl = RPC_ENV ?? (isMain ? "" : DEVNET_RPC_DEFAULT);
  const limits = isMain ? MAINNET_LIMITS : undefined;
  const [ack, setAck] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Session activity: what this panel did in this tab. Kept in sessionStorage only (see lib/activity.ts).
  const [activity, setActivity] = useState<Activity[]>([]);
  const activityRef = useRef<Activity[]>([]);
  useEffect(() => {
    activityRef.current = loadActivity();
    setActivity(activityRef.current);
  }, []);
  const recordActivity = useCallback((entry: Activity) => {
    activityRef.current = addActivity(activityRef.current, entry);
    saveActivity(activityRef.current);
    setActivity(activityRef.current);
  }, []);
  const clearActivity = useCallback(() => {
    activityRef.current = [];
    saveActivity([]);
    setActivity([]);
  }, []);
  const toastId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);
  const mainnetReady = !isMain || ack.trim() === "MAINNET";
  const sessionRef = useRef<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [account, setAccount] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [side, setSide] = useState<Side>("Long");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [postOnly, setPostOnly] = useState(false);
  const [deposit, setDeposit] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [builderIndex, setBuilderIndex] = useState<number | null>(null);

  const feeTenthsBp = clampBuilderFee(data?.trading.builderFeeTenthsBp ?? 20);
  const useBuilder = BUILDER_ADDRESS !== "";

  const signer: SignerWallet | null =
    wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions
      ? {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction as SignerWallet["signTransaction"],
          signAllTransactions: wallet.signAllTransactions as SignerWallet["signAllTransactions"],
        }
      : null;

  // Drop the session whenever the wallet changes or disconnects.
  const walletKey = wallet.publicKey?.toBase58() ?? null;
  useEffect(() => {
    return () => {
      const current = sessionRef.current;
      sessionRef.current = null;
      setSession(null);
      setAccount(null);
      setBalance(null);
      setSummary(null);
      if (current) void current.close().catch(() => undefined);
    };
  }, [walletKey]);

  const refresh = useCallback(
    async (s: Session) => {
      const [exists, bal, sum] = await Promise.all([hasUserAccount(s), walletQuoteBalance(s), readAccountSummary(s)]);
      setAccount(exists);
      setBalance(bal);
      setSummary(sum);
      if (BUILDER_ADDRESS && exists) {
        const { PublicKey } = await import("@solana/web3.js");
        setBuilderIndex(await findApprovedBuilderIndex(s, new PublicKey(BUILDER_ADDRESS), feeTenthsBp));
      } else {
        setBuilderIndex(null);
      }
    },
    [feeTenthsBp],
  );

  const run = useCallback(async (label: string, work: () => Promise<{ signature: string } | void>) => {
    const id = ++toastId.current;
    const settle = (toast: Omit<Toast, "id">) => {
      setToasts((all) => all.map((t) => (t.id === id ? { id, ...toast } : t)));
      if (toast.tone === "ok") timers.current.set(id, setTimeout(() => dismissToast(id), TOAST_OK_MS));
    };
    setToasts((all) => [
      ...all.slice(-3),
      { id, tone: "pending", title: label, text: `Checking, then waiting for your wallet and for confirmation on ${network}.` },
    ]);
    setBusy(label);
    setNotice(null);
    try {
      const result = await work();
      recordActivity({ id, at: new Date().toISOString(), label, status: "confirmed", network, ...(result ? { signature: result.signature } : {}) });
      setNotice({ tone: "ok", text: result ? `${label} confirmed on ${network}. Signature ${result.signature}` : `${label} done` });
      settle({
        tone: "ok",
        title: `${label}: success`,
        text: result ? `Confirmed on ${network}.` : "Done.",
        signature: result?.signature,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unexpected error";
      if (error instanceof TradeError) setNotice({ tone: "error", text: error.message, logs: error.logs?.slice(-6) });
      else setNotice({ tone: "error", text });
      const short = text.length > 220 ? `${text.slice(0, 220)}…` : text;
      recordActivity({ id, at: new Date().toISOString(), label, status: "not-sent", network, reason: short });
      settle({ tone: "error", title: `${label}: failed, nothing was sent`, text: short });
    } finally {
      setBusy(null);
    }
  }, [network, dismissToast, recordActivity]);

  const connect = () =>
    run("Connect", async () => {
      if (!signer) throw new TradeError("Connect a wallet first", "config");
      const s = await openSession(signer, rpcUrl, network, limits);
      sessionRef.current = s;
      setSession(s);
      await refresh(s);
    });

  const marketOk = session && perp ? devnetMarketMatches(session, perp.marketIndex, perp.symbol.replace(/^.*:/, "")) : null;
  const sizeUnits = decimalToUnits(size, 9);
  const limitUnits = decimalToUnits(price, 6);
  const marketWorst = perp ? worstPriceUnits(perp.mark, side, Number(slippage)) : null;
  const priceUnits = kind === "limit" ? limitUnits : marketWorst;
  const amount = Number(size);
  const refPrice = kind === "limit" ? Number(price) : (perp?.mark ?? 0);
  const notional = amount > 0 && Number.isFinite(amount) && refPrice > 0 ? amount * refPrice : null;
  const orderBlocked = sizeUnits && priceUnits ? orderLimitError(limits, sizeUnits, priceUnits, false) : null;
  const depositUnitsInput = decimalToUnits(deposit, 6);
  const depositBlocked = depositUnitsInput ? depositLimitError(limits, depositUnitsInput, summary?.collateralUnits ?? 0n) : null;
  const canOrder =
    Boolean(session && signer && perp && account && marketOk && sizeUnits && priceUnits && !busy && !orderBlocked) &&
    (!useBuilder || builderIndex !== null);

  const position = perp ? summary?.positions.find((p) => p.marketIndex === perp.marketIndex) ?? null : null;
  const positionAbs = position ? (position.baseUnits < 0n ? -position.baseUnits : position.baseUnits) : 0n;
  const entryPrice =
    position && positionAbs > 0n ? Number(position.entryQuoteUnits < 0n ? -position.entryQuoteUnits : position.entryQuoteUnits) / 1e6 / (Number(positionAbs) / 1e9) : null;
  const closeSide: Side = position && position.baseUnits > 0n ? "Short" : "Long";
  const closeWorst = perp ? worstPriceUnits(perp.mark, closeSide, Number(slippage)) : null;
  const canClose = Boolean(session && signer && perp && marketOk && position && positionAbs > 0n && closeWorst && !busy);

  const submitClose = () =>
    run(`Close ${unitsToDecimal(positionAbs, 9)} ${perp?.baseAsset ?? ""}`, async () => {
      if (!session || !signer || !position || !closeWorst) throw new TradeError("There is no open position to close", "config");
      const result = await closePosition(session, signer, position, positionAbs, closeWorst);
      await refresh(session);
      return result;
    });

  const submitOrder = () =>
    run(`${side} ${size} ${perp?.baseAsset ?? ""}`, async () => {
      if (!session || !signer || !perp || !sizeUnits || !priceUnits) throw new TradeError("Order is incomplete", "config");
      const result = await placeOrder(session, signer, {
        marketIndex: perp.marketIndex,
        side,
        baseUnits: sizeUnits,
        kind,
        priceUnits,
        postOnly: kind === "limit" && postOnly,
        builder: useBuilder && builderIndex !== null ? { index: builderIndex, feeTenthsBp: feeTenthsBp } : undefined,
      });
      await refresh(session);
      return result;
    });

  return (
    <section
      className={`panel trade-panel devnet-ticket${isMain ? " mainnet-ticket" : ""}`}
      id="devnet-ticket"
      aria-label={isMain ? "Mainnet trading" : "Devnet test trading"}
      data-no-cursor-fx=""
    >
      <div className="panel-kicker">
        <span>{isMain ? "04 / MAINNET TRADING, REAL FUNDS" : "04 / DEVNET TEST TRADING"}</span>
        {isMain ? <TriangleAlert size={13} /> : <FlaskConical size={13} />}
      </div>
      {isMain ? (
        <div className="trade-lock mainnet-warning" role="alert">
          <TriangleAlert size={14} />
          <p>
            <strong>MAINNET. Real USDT. You can lose all of it.</strong>
            Safety limits in this app: the account may hold at most {limitDollars(MAINNET_LIMITS.maxDepositUnits)} in
            total, and one new order may be at most {limitDollars(MAINNET_LIMITS.maxOrderQuoteUnits)} at its price
            cap. Closing a position and withdrawing are never limited. Your wallet signs every transaction, and each
            one is checked first. Its prompt must say Solana Mainnet. Perpetual futures are leveraged and can be liquidated.
            This is not investment advice, and the first mainnet use of this panel has not been proven yet.
          </p>
        </div>
      ) : (
        <div className="trade-lock">
          <FlaskConical size={14} />
          <p>
            <strong>Test funds only. Not verified end to end.</strong>
            Your wallet signs every transaction, and each one is checked first. Quotes above are mainnet data, devnet prices
            differ. Collateral is dUSDT. This is not a recommendation and nothing here touches mainnet.
          </p>
        </div>
      )}

      {busy && busy !== "Connect" && (
        <div className="reference-preview" role="status">
          <strong>Working</strong>
          <p>
            {busy}: checking, then waiting for your wallet, then waiting for confirmation on {network}. This can take up to a
            minute. Do not press the button again.
          </p>
        </div>
      )}
      {notice && !busy && (
        <div className="reference-preview" role="status">
          <strong>{notice.tone === "ok" ? "Done" : "Not sent or failed"}</strong>
          <p>{notice.text}</p>
          {notice.logs?.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}

      {isMain && !session && (
        <label className="trade-input">
          <span>
            Type MAINNET to unlock <span>confirmation</span>
          </span>
          <input type="text" autoComplete="off" spellCheck={false} placeholder="MAINNET" value={ack} onChange={(e) => setAck(e.target.value)} />
        </label>
      )}

      {!session ? (
        <button className="button primary full" disabled={!signer || busy !== null || !mainnetReady} onClick={connect}>
          {busy === "Connect" ? <LoaderCircle size={14} className="spin" /> : null}
          {!signer ? "Connect a wallet first" : !mainnetReady ? "Type MAINNET above to continue" : isMain ? "Open mainnet session" : "Open devnet session"}
        </button>
      ) : (
        <>
          <dl className="trade-breakdown">
            <div>
              <dt>{isMain ? "Mainnet market" : "Devnet market"}</dt>
              <dd>
                {perp
                  ? marketOk
                    ? `${devnetMarketName(session, perp.marketIndex)} (index ${perp.marketIndex})`
                    : `Not available on ${network} at this index`
                  : "No linked perp"}
              </dd>
            </div>
            <div>
              <dt>Wallet {quoteName}</dt>
              <dd>{balance === null ? "--" : unitsToDecimal(balance, 6)}</dd>
            </div>
            <div>
              <dt>Velocity account</dt>
              <dd>{account === null ? "--" : account ? "Created" : "Not created yet"}</dd>
            </div>
            {summary && (
              <div>
                <dt>Account collateral</dt>
                <dd>{signedUnitsToDecimal(summary.collateralUnits, 6)} {quoteName}</dd>
              </div>
            )}
            {summary && (
              <div>
                <dt>Position on this market</dt>
                <dd>
                  {position
                    ? `${position.baseUnits > 0n ? "Long" : position.baseUnits < 0n ? "Short" : "Flat"} ${unitsToDecimal(positionAbs, 9) || "0"} ${perp?.baseAsset ?? ""}${entryPrice ? `, entry about ${usd(entryPrice)}` : ""}${position.openOrders ? `, ${position.openOrders} open order(s)` : ""}`
                    : "None"}
                </dd>
              </div>
            )}
          </dl>

          {session.core.faucet && (
            <button
              className="button full"
              disabled={!signer || busy !== null}
              onClick={() =>
                run("Get test dUSDT", async () => {
                  if (!signer) throw new TradeError("Connect a wallet first", "config");
                  const result = await mintTestQuote(session, signer);
                  await refresh(session);
                  return result;
                })
              }
            >
              Get {unitsToDecimal(FAUCET_AMOUNT_UNITS, 6)} test dUSDT (devnet faucet)
            </button>
          )}

          <label className="trade-input">
            <span>
              {account ? "Deposit more" : "Create account and deposit"} <span>{quoteName}</span>
            </span>
            <input type="number" min="0" step="any" placeholder="0.00" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </label>
          <button
            className="button primary full"
            disabled={!signer || busy !== null || !depositUnitsInput || Boolean(depositBlocked)}
            onClick={() =>
              run(account ? "Deposit" : "Create account and deposit", async () => {
                const units = decimalToUnits(deposit, 6);
                if (!signer || !units) throw new TradeError("Enter a deposit amount", "config");
                const result = account ? await depositMore(session, signer, units) : await createAccountAndDeposit(session, signer, units);
                await refresh(session);
                return result;
              })
            }
          >
            {account ? "Deposit" : "Create account and deposit"}
          </button>
          {depositBlocked && <p className="margin-disclosure">{depositBlocked}</p>}

          {account && (
            <>
              <label className="trade-input">
                <span>
                  Withdraw to wallet <span>{quoteName}</span>
                </span>
                <input type="number" min="0" step="any" placeholder="0.00" value={withdraw} onChange={(e) => setWithdraw(e.target.value)} />
              </label>
              <button
                className="button full"
                disabled={!summary || summary.collateralUnits <= 0n || busy !== null}
                onClick={() => summary && setWithdraw(unitsToDecimal(summary.collateralUnits, 6))}
              >
                Fill with all collateral
              </button>
              <button
                className="button full"
                disabled={!signer || busy !== null || !decimalToUnits(withdraw, 6)}
                onClick={() =>
                  run("Withdraw", async () => {
                    const units = decimalToUnits(withdraw, 6);
                    if (!signer || !units) throw new TradeError("Enter a withdrawal amount", "config");
                    const result = await withdrawQuote(session, signer, units);
                    await refresh(session);
                    return result;
                  })
                }
              >
                Withdraw (reduce only, margin enforced by the program)
              </button>
            </>
          )}

          {useBuilder && (
            <button
              className="button full"
              disabled={!signer || busy !== null || !account || builderIndex !== null}
              onClick={() =>
                run("Approve builder", async () => {
                  if (!signer) throw new TradeError("Connect a wallet first", "config");
                  const { PublicKey } = await import("@solana/web3.js");
                  const result = await approveBuilder(session, signer, new PublicKey(BUILDER_ADDRESS), feeTenthsBp);
                  await refresh(session);
                  return result;
                })
              }
            >
              {builderIndex !== null ? `Builder approved (slot ${builderIndex})` : `Approve builder fee up to ${feeTenthsBp / 10} bps`}
            </button>
          )}

          <div className="segmented side-selector">
            {(["Long", "Short"] as const).map((s) => (
              <button key={s} className={side === s ? "active" : ""} onClick={() => setSide(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="order-types">
            {(["market", "limit"] as const).map((k) => (
              <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
                {k === "market" ? "Market" : "Limit"}
              </button>
            ))}
          </div>
          <label className="trade-input">
            <span>
              Size <span>{perp?.baseAsset ?? "BASE"}</span>
            </span>
            <input type="number" min="0" step="any" placeholder="0.00" value={size} onChange={(e) => setSize(e.target.value)} />
          </label>
          {kind === "limit" ? (
            <>
              <label className="trade-input">
                <span>
                  Limit price <span>USD</span>
                </span>
                <input type="number" min="0" step="any" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
              </label>
              <label className="slippage-label">
                Post only (reject instead of crossing)
                <input type="checkbox" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />
              </label>
            </>
          ) : (
            <label className="slippage-label">
              Worst-price cap
              <span>
                <input aria-label="Slippage cap percent" type="number" min="0.01" max="5" step="0.1" value={slippage} onChange={(e) => setSlippage(e.target.value)} />%
              </span>
            </label>
          )}
          <dl className="trade-breakdown">
            <div>
              <dt>Reference notional</dt>
              <dd>{usd(notional)}</dd>
            </div>
            <div>
              <dt>Builder fee</dt>
              <dd>{useBuilder ? `${feeTenthsBp / 10} bps (${usd(notional == null ? null : builderFeeUsd(notional, feeTenthsBp))})` : "None (no builder configured)"}</dd>
            </div>
            <div>
              <dt>Protocol and network fee</dt>
              <dd>Shown by your wallet before you confirm</dd>
            </div>
          </dl>
          {orderBlocked && <p className="margin-disclosure">{orderBlocked}</p>}
          <button className="button primary full" disabled={!canOrder} onClick={submitOrder}>
            {busy && busy.startsWith(side) ? <LoaderCircle size={14} className="spin" /> : null}
            Place {side} {kind}
          </button>
          <button
            className="button full"
            disabled={!signer || busy !== null || !perp || !marketOk || !account}
            onClick={() =>
              run("Cancel all orders", async () => {
                if (!signer || !perp) throw new TradeError("No market", "config");
                const result = await cancelAllOnMarket(session, signer, perp.marketIndex);
                await refresh(session);
                return result;
              })
            }
          >
            Cancel all orders on this market
          </button>
          <button className="button full" disabled={!canClose} onClick={submitClose}>
            {position && positionAbs > 0n
              ? `Close position (${closeSide === "Short" ? "sell" : "buy"} ${unitsToDecimal(positionAbs, 9)} ${perp?.baseAsset ?? ""}, reduce only)`
              : "Close position (no open position)"}
          </button>
        </>
      )}

      <p className="margin-disclosure">
        {isMain ? (
          <>
            Velocity uses cross-margin within each subaccount, and positions can be liquidated. Fees, funding and oracle
            prices are real. The deposit, order and cancel steps worked on devnet with Phantom; the reduce-only close, the
            position view and the withdrawal are newer and were proven on devnet only if you tested them. Check that your
            wallet prompt says Solana Mainnet and the amount is what you intend before signing. Withdraw everything and
            check your balance on a block explorer after each session.
          </>
        ) : (
          <>
            Velocity uses cross-margin within each subaccount. Devnet quotes, fees and oracle prices can differ from the
            mainnet figures shown elsewhere on this page. The owner ran faucet, deposit, market orders and cancel on
            devnet with Phantom; the reduce-only close and the position view are new and unproven on chain. Review each
            wallet prompt and check that it says Devnet before signing.
          </>
        )}
      </p>
      {activity.some((a) => a.network === network) && (
        <div className="activity" aria-label="Session activity">
          <div className="activity-head">
            <strong>Session activity</strong>
            <button type="button" onClick={clearActivity}>
              Clear
            </button>
          </div>
          <ul>
            {activity
              .filter((a) => a.network === network)
              .map((a) => {
                const link = a.signature ? explorerTxUrl(a.signature, a.network) : null;
                return (
                  <li key={a.id} className={a.status}>
                    <time dateTime={a.at}>{new Date(a.at).toLocaleTimeString()}</time>
                    <span className="activity-label">{a.label === "Connect" ? "Open session" : a.label}</span>
                    <span className="activity-status">{a.status === "confirmed" ? "Confirmed" : "Not sent"}</span>
                    {link && a.signature ? (
                      <a href={link} target="_blank" rel="noopener noreferrer">
                        {a.signature.slice(0, 6)}…{a.signature.slice(-6)}
                      </a>
                    ) : a.reason ? (
                      <span className="activity-reason">{a.reason}</span>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
          </ul>
          <p className="activity-note">Kept in this browser tab only and cleared when the tab closes.</p>
        </div>
      )}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="tx-toasts" aria-live="polite" aria-atomic="false">
            {toasts.map((t) => (
              <div key={t.id} className={`tx-toast ${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
                <span className="tx-toast-icon">
                  {t.tone === "pending" ? <LoaderCircle size={16} className="spin" /> : t.tone === "ok" ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
                </span>
                <div className="tx-toast-body">
                  <strong>{t.title}</strong>
                  <p>{t.text}</p>
                  {t.signature && (
                    <a href={explorerUrl(t.signature, network)} target="_blank" rel="noopener noreferrer">
                      View on explorer
                    </a>
                  )}
                </div>
                <button type="button" className="tx-toast-close" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </section>
  );
}

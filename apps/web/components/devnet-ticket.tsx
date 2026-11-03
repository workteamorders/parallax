"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LoaderCircle, FlaskConical } from "lucide-react";
import type { Perp } from "@parallax/shared";
import { useObservatory } from "./provider";
import { usd } from "@/lib/format";
import {
  builderFeeUsd,
  clampBuilderFee,
  decimalToUnits,
  worstPriceUnits,
  type Side,
} from "@/lib/trade-math";
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
  type AccountSummary,
  type Session,
  type SignerWallet,
} from "@/lib/velocity-trade";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEVNET_RPC_DEFAULT;
const BUILDER_ADDRESS = process.env.NEXT_PUBLIC_BUILDER_ADDRESS ?? "";

const unitsToDecimal = (units: bigint, decimals: number) => {
  const text = units.toString().padStart(decimals + 1, "0");
  return `${text.slice(0, -decimals)}.${text.slice(-decimals)}`.replace(/\.?0+$/, "");
};

const signedUnitsToDecimal = (units: bigint, decimals: number) =>
  `${units < 0n ? "-" : ""}${unitsToDecimal(units < 0n ? -units : units, decimals) || "0"}`;

type Notice ={ tone: "ok" | "error"; text: string; logs?: string[] } | null;

export function DevnetTicket({ perp }: { perp?: Perp }) {
  const { data } = useObservatory();
  const wallet = useWallet();
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
    setBusy(label);
    setNotice(null);
    try {
      const result = await work();
      setNotice({ tone: "ok", text: result ? `${label} confirmed on devnet. Signature ${result.signature}` : `${label} done` });
    } catch (error) {
      if (error instanceof TradeError) setNotice({ tone: "error", text: error.message, logs: error.logs?.slice(-6) });
      else setNotice({ tone: "error", text: error instanceof Error ? error.message : "Unexpected error" });
    } finally {
      setBusy(null);
    }
  }, []);

  const connect = () =>
    run("Connect", async () => {
      if (!signer) throw new TradeError("Connect a wallet first", "config");
      const s = await openSession(signer, RPC_URL);
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
  const canOrder =
    Boolean(session && signer && perp && account && marketOk && sizeUnits && priceUnits && !busy) &&
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
    <section className="panel trade-panel devnet-ticket" id="devnet-ticket" aria-label="Devnet test trading">
      <div className="panel-kicker">
        <span>04 / DEVNET TEST TRADING</span>
        <FlaskConical size={13} />
      </div>
      <div className="trade-lock">
        <FlaskConical size={14} />
        <p>
          <strong>Test funds only. Not verified end to end.</strong>
          Your wallet signs every transaction after a simulation. Quotes above are mainnet data, devnet prices
          differ. Collateral is dUSDT. This is not a recommendation and nothing here touches mainnet.
        </p>
      </div>

      {!session ? (
        <button className="button primary full" disabled={!signer || busy !== null} onClick={connect}>
          {busy === "Connect" ? <LoaderCircle size={14} className="spin" /> : null}
          {signer ? "Open devnet session" : "Connect a wallet first"}
        </button>
      ) : (
        <>
          <dl className="trade-breakdown">
            <div>
              <dt>Devnet market</dt>
              <dd>
                {perp
                  ? marketOk
                    ? `${devnetMarketName(session, perp.marketIndex)} (index ${perp.marketIndex})`
                    : "Not available on devnet at this index"
                  : "No linked perp"}
              </dd>
            </div>
            <div>
              <dt>Wallet dUSDT</dt>
              <dd>{balance === null ? "--" : unitsToDecimal(balance, 6)}</dd>
            </div>
            <div>
              <dt>Velocity account</dt>
              <dd>{account === null ? "--" : account ? "Created" : "Not created yet"}</dd>
            </div>
            {summary && (
              <div>
                <dt>Account collateral</dt>
                <dd>{signedUnitsToDecimal(summary.collateralUnits, 6)} dUSDT</dd>
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
              {account ? "Deposit more" : "Create account and deposit"} <span>dUSDT</span>
            </span>
            <input type="number" min="0" step="any" placeholder="0.00" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </label>
          <button
            className="button primary full"
            disabled={!signer || busy !== null || !decimalToUnits(deposit, 6)}
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
              <dd>Shown by your wallet after simulation</dd>
            </div>
          </dl>
          <button className="button primary full" disabled={!canOrder} onClick={submitOrder}>
            {busy && busy.startsWith(side) ? <LoaderCircle size={14} className="spin" /> : null}
            Simulate, then sign {side} {kind}
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

      {notice && (
        <div className="reference-preview" role="status">
          <strong>{notice.tone === "ok" ? "Done" : "Not sent or failed"}</strong>
          <p>{notice.text}</p>
          {notice.logs?.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      <p className="margin-disclosure">
        Velocity uses cross-margin within each subaccount. Devnet quotes, fees and oracle prices can differ from the
        mainnet figures shown elsewhere on this page. The owner ran faucet, deposit, market orders and cancel on
        devnet with Phantom; the reduce-only close and the position view are new and unproven on chain. Review each
        wallet prompt and check that it says Devnet before signing.
      </p>
    </section>
  );
}

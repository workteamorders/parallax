/**
 * Pure order arithmetic for the devnet ticket. No floats are used for on-chain integers: decimal strings
 * are converted with integer math so 0.1 + 0.2 style noise can never reach a transaction.
 */
export const BASE_PRECISION_DECIMALS = 9; // perp base amounts, 1e9
export const PRICE_PRECISION_DECIMALS = 6; // prices and quote (USDT/dUSDT), 1e6
export const APP_MAX_BUILDER_FEE_TENTHS_BP = 100; // app ceiling; protocol ceiling is 1000

/** "1.25" -> 1250000000n at 9 decimals. Null when empty, non-numeric, negative, zero, or finer than `decimals`. */
export function decimalToUnits(raw: string, decimals: number): bigint | null {
  const text = raw.trim();
  const match = /^(\d{1,15})(?:\.(\d{1,18}))?$/.exec(text);
  if (!match) return null;
  const frac = match[2] ?? "";
  if (frac.length > decimals) return null;
  const units = BigInt(match[1]! + frac.padEnd(decimals, "0"));
  return units > 0n ? units : null;
}

export type Side = "Long" | "Short";

/**
 * Worst acceptable price for a market order: buys may pay up to mark*(1+slip), sells may receive down to
 * mark*(1-slip). Rounded to the passive side at 1e6 so the bound is never looser than requested.
 * Null for invalid mark or slippage (the caller must then refuse the order).
 */
export function worstPriceUnits(mark: number, side: Side, slippagePct: number): bigint | null {
  if (!Number.isFinite(mark) || mark <= 0) return null;
  if (!Number.isFinite(slippagePct) || slippagePct <= 0 || slippagePct > 5) return null;
  // Integer math: float products such as 100 * 1.005 * 1e6 land just below the exact value.
  const markMicro = BigInt(Math.round(mark * 10 ** PRICE_PRECISION_DECIMALS));
  const slipBps = BigInt(Math.round(slippagePct * 100));
  if (slipBps <= 0n || markMicro <= 0n) return null;
  const numerator = markMicro * (side === "Long" ? 10_000n + slipBps : 10_000n - slipBps);
  const worst = side === "Long" ? numerator / 10_000n : (numerator + 9_999n) / 10_000n;
  return worst > 0n ? worst : null;
}

/** Clamp a configured builder fee (tenths of a bp) to the app ceiling; invalid input falls back to the default. */
export function clampBuilderFee(raw: unknown, fallback = 20): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  const value = Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  return Math.min(value, APP_MAX_BUILDER_FEE_TENTHS_BP);
}

/** Builder fee in USD for a notional, in tenths of a bp (20 -> 0.02%). */
export function builderFeeUsd(notionalUsd: number, tenthsBp: number): number {
  return (notionalUsd * clampBuilderFee(tenthsBp)) / 100_000;
}

/** Devnet RPC is the only supported cluster for this ticket. */
export function isDevnetRpc(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.includes("devnet");
  } catch {
    return false;
  }
}

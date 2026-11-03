/**
 * Network rules and hard limits for browser trading. Pure functions, no I/O.
 *
 * Devnet has no limits (test funds). Mainnet always has limits, and the limits can only be tightened by
 * configuration: whatever NEXT_PUBLIC_MAINNET_* says, it is clamped to the ceilings below, which are part of the
 * code. Raising a ceiling is a code change that has to be made on purpose.
 */
export type TradeNetwork = "devnet" | "mainnet-beta";

export interface TradeLimits {
  /** Largest total collateral allowed in the Velocity account after a deposit, in quote base units (1e6). */
  maxDepositUnits: bigint;
  /** Largest notional of one new (not reduce-only) order, in quote base units (1e6), measured at the price cap. */
  maxOrderQuoteUnits: bigint;
}

/** Absolute ceilings. Not configurable. $25 total in the account, $10 per new order. */
export const MAINNET_HARD_CAPS: TradeLimits = { maxDepositUnits: 25_000_000n, maxOrderQuoteUnits: 10_000_000n };
/** Used when the configuration does not set a limit. $10 total in the account, $5 per new order. */
export const MAINNET_DEFAULT_LIMITS: TradeLimits = { maxDepositUnits: 10_000_000n, maxOrderQuoteUnits: 5_000_000n };

/** The mainnet quote asset of Velocity spot market 0 (USDT), from the SDK's mainnet-beta config. */
export const MAINNET_QUOTE_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

function dollarsToUnits(raw: string | undefined): bigint | null {
  if (raw === undefined) return null;
  const match = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(raw.trim());
  if (!match) return null;
  const units = BigInt(match[1]! + (match[2] ?? "").padEnd(6, "0"));
  return units > 0n ? units : null;
}

const smaller = (a: bigint, b: bigint) => (a < b ? a : b);

/** Reads dollar amounts from configuration. Missing or invalid values fall back to the defaults, then everything is clamped to the ceilings. */
export function parseMainnetLimits(env: { maxDepositUsd?: string; maxOrderUsd?: string }): TradeLimits {
  return {
    maxDepositUnits: smaller(dollarsToUnits(env.maxDepositUsd) ?? MAINNET_DEFAULT_LIMITS.maxDepositUnits, MAINNET_HARD_CAPS.maxDepositUnits),
    maxOrderQuoteUnits: smaller(dollarsToUnits(env.maxOrderUsd) ?? MAINNET_DEFAULT_LIMITS.maxOrderQuoteUnits, MAINNET_HARD_CAPS.maxOrderQuoteUnits),
  };
}

const NON_MAINNET_HOST = /devnet|testnet|localhost|127\.0\.0\.1|\[::1\]|\.local$/i;

/** A mainnet RPC must be https and must not look like a devnet, testnet or local endpoint. */
export function isMainnetRpc(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !NON_MAINNET_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Notional in quote base units (1e6) of `baseUnits` (1e9) at `priceUnits` (1e6), rounded up so the check is never looser than the order. */
export function orderQuoteUnits(baseUnits: bigint, priceUnits: bigint): bigint {
  return (baseUnits * priceUnits + 999_999_999n) / 1_000_000_000n;
}

const dollars = (units: bigint) => `$${(Number(units) / 1e6).toFixed(2)}`;

/** Null when the deposit is allowed. `currentCollateralUnits` is the account's collateral already inside Velocity (negative counts as zero). */
export function depositLimitError(limits: TradeLimits | undefined, depositUnits: bigint, currentCollateralUnits: bigint): string | null {
  if (!limits) return null;
  const current = currentCollateralUnits > 0n ? currentCollateralUnits : 0n;
  if (current + depositUnits > limits.maxDepositUnits) {
    return `Deposit blocked by the safety limit: the account may hold at most ${dollars(limits.maxDepositUnits)} (it holds about ${dollars(current)}, this deposit adds ${dollars(depositUnits)}).`;
  }
  return null;
}

/** Null when the order is allowed. Reduce-only orders (closing) are never limited. */
export function orderLimitError(limits: TradeLimits | undefined, baseUnits: bigint, priceUnits: bigint, reduceOnly: boolean): string | null {
  if (!limits || reduceOnly) return null;
  const notional = orderQuoteUnits(baseUnits, priceUnits);
  if (notional > limits.maxOrderQuoteUnits) {
    return `Order blocked by the safety limit: ${dollars(notional)} at the price cap is above the ${dollars(limits.maxOrderQuoteUnits)} maximum per order.`;
  }
  return null;
}

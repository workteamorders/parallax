import { describe, expect, it } from "vitest";
import {
  MAINNET_DEFAULT_LIMITS,
  MAINNET_HARD_CAPS,
  depositLimitError,
  isMainnetRpc,
  orderLimitError,
  orderQuoteUnits,
  parseMainnetLimits,
} from "./trade-network";

describe("mainnet limits", () => {
  it("falls back to the defaults for missing or invalid values", () => {
    expect(parseMainnetLimits({})).toEqual(MAINNET_DEFAULT_LIMITS);
    expect(parseMainnetLimits({ maxDepositUsd: "abc", maxOrderUsd: "-3" })).toEqual(MAINNET_DEFAULT_LIMITS);
    expect(parseMainnetLimits({ maxDepositUsd: "0", maxOrderUsd: "" })).toEqual(MAINNET_DEFAULT_LIMITS);
  });
  it("accepts tighter limits and clamps looser ones to the hard ceilings", () => {
    expect(parseMainnetLimits({ maxDepositUsd: "4.5", maxOrderUsd: "2" })).toEqual({ maxDepositUnits: 4_500_000n, maxOrderQuoteUnits: 2_000_000n });
    expect(parseMainnetLimits({ maxDepositUsd: "100000", maxOrderUsd: "5000" })).toEqual(MAINNET_HARD_CAPS);
  });
  it("tells mainnet RPCs from devnet, testnet and local ones", () => {
    expect(isMainnetRpc("https://api.mainnet-beta.solana.com")).toBe(true);
    expect(isMainnetRpc("https://rpc.example-provider.com/key")).toBe(true);
    expect(isMainnetRpc("https://api.devnet.solana.com")).toBe(false);
    expect(isMainnetRpc("https://api.testnet.solana.com")).toBe(false);
    expect(isMainnetRpc("http://rpc.example.com")).toBe(false);
    expect(isMainnetRpc("https://localhost:8899")).toBe(false);
    expect(isMainnetRpc("not a url")).toBe(false);
  });
  it("rounds order notional up so the check is never looser than the order", () => {
    expect(orderQuoteUnits(1_000_000_000n, 77_500_000_000n)).toBe(77_500_000_000n);
    expect(orderQuoteUnits(1n, 1n)).toBe(1n);
    expect(orderQuoteUnits(60_000n, 77_500_000_000n)).toBe(4_650_000n);
  });
  it("checks deposits against what the account already holds and ignores borrows", () => {
    const limits = MAINNET_DEFAULT_LIMITS;
    expect(depositLimitError(undefined, 99_000_000n, 0n)).toBeNull();
    expect(depositLimitError(limits, 10_000_000n, 0n)).toBeNull();
    expect(depositLimitError(limits, 10_000_001n, 0n)).toMatch(/safety limit/);
    expect(depositLimitError(limits, 1n, 10_000_000n)).toMatch(/safety limit/);
    expect(depositLimitError(limits, 10_000_000n, -5_000_000n)).toBeNull();
  });
  it("limits new orders but never reduce-only ones", () => {
    const limits = MAINNET_DEFAULT_LIMITS;
    expect(orderLimitError(limits, 1_000_000_000n, 77_500_000_000n, false)).toMatch(/safety limit/);
    expect(orderLimitError(limits, 1_000_000_000n, 77_500_000_000n, true)).toBeNull();
    expect(orderLimitError(undefined, 1_000_000_000n, 77_500_000_000n, false)).toBeNull();
    expect(orderLimitError(limits, 60_000n, 77_500_000_000n, false)).toBeNull();
  });
});

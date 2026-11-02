import { describe, expect, it } from "vitest";
import {
  builderFeeUsd,
  clampBuilderFee,
  decimalToUnits,
  isDevnetRpc,
  worstPriceUnits,
} from "./trade-math";

describe("decimal to on-chain units", () => {
  it("converts without float noise", () => {
    expect(decimalToUnits("1", 9)).toBe(1_000_000_000n);
    expect(decimalToUnits("0.1", 9)).toBe(100_000_000n);
    expect(decimalToUnits("0.000000001", 9)).toBe(1n);
    expect(decimalToUnits("123.456789", 6)).toBe(123_456_789n);
  });
  it("rejects zero, negatives, junk, exponents and excess precision", () => {
    for (const bad of ["", " ", "0", "0.0", "-1", "1e3", "abc", "1.0000000001", "1,5", "NaN", "Infinity", "1.", ".5"])
      expect(decimalToUnits(bad, 9), bad).toBeNull();
    expect(decimalToUnits("1.0000001", 6)).toBeNull();
  });
});

describe("market order worst price", () => {
  it("is never looser than requested: buys round down, sells round up", () => {
    expect(worstPriceUnits(100, "Long", 0.5)).toBe(100_500_000n);
    expect(worstPriceUnits(100, "Short", 0.5)).toBe(99_500_000n);
  });
  it("refuses invalid marks and slippage", () => {
    expect(worstPriceUnits(0, "Long", 0.5)).toBeNull();
    expect(worstPriceUnits(NaN, "Long", 0.5)).toBeNull();
    expect(worstPriceUnits(100, "Long", 0)).toBeNull();
    expect(worstPriceUnits(100, "Long", 5.01)).toBeNull();
    expect(worstPriceUnits(100, "Short", -1)).toBeNull();
  });
});

describe("builder fee", () => {
  it("clamps to the app ceiling of 100 tenths-bp and falls back to 20", () => {
    expect([clampBuilderFee(-1), clampBuilderFee(20.9), clampBuilderFee(1000), clampBuilderFee("abc"), clampBuilderFee("")]).toEqual([20, 20, 100, 20, 20]);
    expect(clampBuilderFee(0)).toBe(0);
  });
  it("computes USD from tenths of a basis point", () => {
    expect(builderFeeUsd(10_000, 20)).toBeCloseTo(2);
    expect(builderFeeUsd(10_000, 5000)).toBeCloseTo(10);
  });
});

describe("devnet-only RPC", () => {
  it("accepts devnet hosts only", () => {
    expect(isDevnetRpc("https://api.devnet.solana.com")).toBe(true);
    expect(isDevnetRpc("https://devnet.helius-rpc.com/?api-key=x")).toBe(true);
    expect(isDevnetRpc("https://api.mainnet-beta.solana.com")).toBe(false);
    expect(isDevnetRpc("not a url")).toBe(false);
  });
});

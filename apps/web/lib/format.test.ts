import { describe, expect, it } from "vitest";
import { usd, pct, signed, linePath } from "./format";
describe("honest financial display", () => {
  it("does not turn unavailable quotes into zero", () => {
    expect(usd(null)).toBe("—");
    expect(pct(null)).toBe("—");
    expect(pct(0)).toBe("0.0%");
  });
  it("formats percentage points and prices separately", () => {
    expect(usd(100.25)).toBe("$100.25");
    expect(signed(-1.5)).toBe("-1.50%");
  });
  it("preserves actual time coordinates and avoids division by zero", () => {
    expect(linePath([{ ts: 1, value: 2 }])).not.toMatch(/NaN|Infinity/);
    expect(linePath([])).toBe("");
    expect(
      linePath([
        { ts: 0, value: 0 },
        { ts: 10, value: 1 },
      ]),
    ).toBe("M16.00,132.00 L684.00,18.00");
  });
});

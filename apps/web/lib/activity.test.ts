import { describe, expect, it } from "vitest";
import { ACTIVITY_MAX, addActivity, explorerTxUrl, isSignature, parseActivity, type Activity } from "./activity";

const SIG = "5".repeat(88);
const entry = (id: number, extra: Partial<Activity> = {}): Activity => ({
  id, at: "2026-11-06T02:30:00.000Z", label: "Deposit", status: "confirmed", network: "mainnet-beta", signature: SIG, ...extra,
});

describe("session activity", () => {
  it("builds explorer links only for valid signatures", () => {
    expect(explorerTxUrl(SIG, "mainnet-beta")).toBe(`https://explorer.solana.com/tx/${SIG}`);
    expect(explorerTxUrl(SIG, "devnet")).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
    expect(explorerTxUrl("javascript:alert(1)", "mainnet-beta")).toBeNull();
    expect(explorerTxUrl(`${SIG}/../x`, "mainnet-beta")).toBeNull();
    expect(isSignature("0OIl" + "5".repeat(80))).toBe(false); // characters outside the base58 alphabet
  });

  it("adds newest first, replaces the same id and caps the length", () => {
    let list: Activity[] = [];
    for (let i = 0; i < ACTIVITY_MAX + 5; i++) list = addActivity(list, entry(i));
    expect(list).toHaveLength(ACTIVITY_MAX);
    expect(list[0]!.id).toBe(ACTIVITY_MAX + 4);
    const replaced = addActivity(list, entry(list[3]!.id, { label: "Withdraw" }));
    expect(replaced[0]!.label).toBe("Withdraw");
    expect(replaced.filter((a) => a.id === list[3]!.id)).toHaveLength(1);
  });

  it("drops malformed or tampered stored entries and keeps good ones", () => {
    const raw = JSON.stringify([
      entry(1),
      { ...entry(2), network: "somewhere" },
      { ...entry(3), status: "weird" },
      { ...entry(4), at: "not a date" },
      { ...entry(5), signature: "javascript:alert(1)" },
      { ...entry(6), label: "x".repeat(500) },
      "text",
      null,
    ]);
    const out = parseActivity(raw);
    expect(out.map((a) => a.id)).toEqual([1, 5, 6]);
    expect(out[1]!.signature).toBeUndefined();
    expect(out[2]!.label).toHaveLength(80);
  });

  it("returns an empty list for missing or broken storage", () => {
    expect(parseActivity(null)).toEqual([]);
    expect(parseActivity("{not json")).toEqual([]);
    expect(parseActivity('{"a":1}')).toEqual([]);
  });

  it("keeps a reason only on entries where nothing was sent", () => {
    const out = parseActivity(JSON.stringify([
      entry(1, { status: "not-sent", signature: undefined, reason: "Simulation failed, nothing was sent" }),
      entry(2, { reason: "should be ignored" }),
    ]));
    expect(out[0]!.reason).toMatch(/nothing was sent/);
    expect(out[1]!.reason).toBeUndefined();
  });
});

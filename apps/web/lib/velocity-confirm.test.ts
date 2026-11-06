import { describe, expect, it } from "vitest";
import type { Connection } from "@solana/web3.js";
import { TradeError, waitForConfirmation } from "./velocity-trade";

type Status = { err: unknown; confirmationStatus?: string } | null;

function fake(opts: { statuses: Array<Status | Error>; height: number; history?: Status }) {
  let calls = 0;
  let sends = 0;
  const connection = {
    getSignatureStatuses: async (_sigs: string[], cfg?: { searchTransactionHistory?: boolean }) => {
      if (cfg?.searchTransactionHistory) return { value: [opts.history ?? null] };
      const next = opts.statuses[Math.min(calls++, opts.statuses.length - 1)]!;
      if (next instanceof Error) throw next;
      return { value: [next] };
    },
    getBlockHeight: async () => opts.height,
    sendRawTransaction: async () => {
      sends++;
      return "sig";
    },
  };
  return { connection: connection as unknown as Connection, sends: () => sends };
}

const raw = new Uint8Array([1, 2, 3]);

describe("waitForConfirmation", () => {
  it("returns once the signature is confirmed", async () => {
    const f = fake({ statuses: [null, { err: null, confirmationStatus: "processed" }, { err: null, confirmationStatus: "confirmed" }], height: 10 });
    await expect(waitForConfirmation(f.connection, "sig", 100, raw, 1)).resolves.toBeUndefined();
  });

  it("re-broadcasts the same signed bytes while waiting", async () => {
    const f = fake({ statuses: [null, null, null, null, { err: null, confirmationStatus: "finalized" }], height: 10 });
    await waitForConfirmation(f.connection, "sig", 100, raw, 1);
    expect(f.sends()).toBeGreaterThanOrEqual(1);
  });

  it("reports an on-chain failure as failed", async () => {
    const f = fake({ statuses: [{ err: { InstructionError: [1, { Custom: 6059 }] } }], height: 10 });
    await expect(waitForConfirmation(f.connection, "sig", 100, raw, 1)).rejects.toMatchObject({ code: "failed" });
  });

  it("reports expired (not ambiguous) when the blockhash is gone and the signature is unknown", async () => {
    const f = fake({ statuses: [null], height: 101 });
    const err = await waitForConfirmation(f.connection, "sig", 100, raw, 1).catch((e) => e);
    expect(err).toBeInstanceOf(TradeError);
    expect(err.code).toBe("expired");
    expect(err.message).toMatch(/not executed/);
  });

  it("still succeeds when the signature shows up in history after expiry", async () => {
    const f = fake({ statuses: [null], height: 101, history: { err: null, confirmationStatus: "confirmed" } });
    await expect(waitForConfirmation(f.connection, "sig", 100, raw, 1)).resolves.toBeUndefined();
  });

  it("survives a few RPC errors but gives up after repeated ones", async () => {
    const ok = fake({ statuses: [new Error("rpc"), new Error("rpc"), { err: null, confirmationStatus: "confirmed" }], height: 10 });
    await expect(waitForConfirmation(ok.connection, "sig", 100, raw, 1)).resolves.toBeUndefined();
    const bad = fake({ statuses: [new Error("rpc down")], height: 10 });
    await expect(waitForConfirmation(bad.connection, "sig", 100, raw, 1)).rejects.toThrow("rpc down");
  });
});

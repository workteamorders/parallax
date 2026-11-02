import { describe, expect, it } from "vitest";
import { liveCandles, liveHistory, liveTerminal, liveTrading, type LiveDeps } from "./terminal";
import { manifest } from "../../../api/src/theme-manifest";
import { jupiterMarket, velocityCandles, velocityMarkets } from "../../../api/tests/fixtures/live";

const now = new Date("2026-10-29T12:00:00Z");
function deps(handler: (url: string) => Response | Promise<Response>, env: Record<string, string> = {}): LiveDeps {
  return { now: () => now, env, fetcher: async (url) => handler(url) };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const bad = (status: number) => new Response("{}", { status });

describe("live-only terminal", () => {
  it("shows honest unavailable states when every source fails, with no invented quotes or signals", async () => {
    const data = await liveTerminal(deps(() => bad(503)));
    expect(data.perps).toEqual([]);
    expect(data.signals).toEqual([]);
    expect(data.themes.length).toBe(manifest.length);
    expect(data.themes.every((t) => t.markets.every((m) => m.yesMid === null && m.yesBid === null && m.yesAsk === null))).toBe(true);
    expect(data.themes.some((t) => t.reviewStatus === "approved")).toBe(false);
    const health = Object.fromEntries(data.health.map((h) => [h.venue, h.status]));
    expect(health.velocity).toBe("unavailable");
    expect(health.jupiter).toBe("unavailable");
    expect(health["live-mode"]).toBe("degraded");
  });

  it("verifies a contract against the manifest and exposes only real quotes", async () => {
    const entry = manifest.find((m) => m.status === "approved" && m.closeTime * 1000 > now.getTime())!;
    const data = await liveTerminal(
      deps((url) => {
        if (url.endsWith("/stats/markets")) return ok(velocityMarkets);
        if (url.includes(`/markets/${entry.marketId}`)) return ok({ ...jupiterMarket, marketId: entry.marketId }); // fixture rules differ from the reviewed ones
        return bad(404);
      }),
    );
    const theme = data.themes.find((t) => t.slug === entry.slug)!;
    // The fixture's rule text/title/expiry do not match the reviewed fingerprint, so it must NOT stay approved.
    expect(theme.reviewStatus).toBe("candidate");
    expect(theme.reviewNote).toContain("RULES/STRIKE/EXPIRY CHANGED");
    expect(theme.markets[0]!.yesMid).toBeCloseTo(0.055);
    expect(data.perps).toHaveLength(1);
  });

  it("never fetches rejected or expired contracts and keeps rejected rejected", async () => {
    const seen: string[] = [];
    const data = await liveTerminal(deps((url) => (seen.push(url), bad(503))));
    const rejected = manifest.filter((m) => m.status === "rejected");
    const expired = manifest.filter((m) => m.closeTime * 1000 <= now.getTime());
    for (const m of [...rejected, ...expired]) expect(seen.some((u) => u.includes(`/markets/${m.marketId}`))).toBe(false);
    for (const m of rejected) expect(data.themes.find((t) => t.slug === m.slug)!.reviewStatus).toBe("rejected");
  });

  it("reports trading from env: devnet flag only, never mainnet", () => {
    expect(liveTrading({}).enabled).toBe(false);
    expect(liveTrading({ DEVNET_TRADING_ENABLED: "true" })).toMatchObject({ enabled: true, network: "devnet" });
    expect(liveTrading({ DEVNET_TRADING_ENABLED: "true", SOLANA_NETWORK: "mainnet-beta" }).enabled).toBe(false);
  });
});

describe("live candles and history", () => {
  it("validates input before any network call", async () => {
    let called = 0;
    const d = deps(() => (called++, ok(velocityMarkets)));
    for (const q of ["symbol=../x", "symbol=SOL-PERP&resolution=7", "symbol=SOL-PERP&limit=0", "symbol=SOL-PERP&limit=501", "symbol=sol-perp"])
      expect(await liveCandles(d, new URLSearchParams(q))).toMatchObject({ status: 400 });
    expect(called).toBe(0);
  });
  it("returns actual candles for a discovered perp and 404 for an unknown one", async () => {
    const d = deps((url) => (url.endsWith("/stats/markets") ? ok(velocityMarkets) : url.includes("/candles/") ? ok(velocityCandles) : bad(404)));
    const good = await liveCandles(d, new URLSearchParams("symbol=SOL-PERP&resolution=60&limit=2"));
    expect("candles" in good && good.candles.length).toBe(2);
    expect(await liveCandles(d, new URLSearchParams("symbol=DOGE-PERP"))).toMatchObject({ status: 404 });
  });
  it("history is empty for known themes and null for unknown", () => {
    expect(liveHistory(manifest[0]!.slug)).toEqual({ probability: [], perp: [] });
    expect(liveHistory("nope")).toBeNull();
  });
});

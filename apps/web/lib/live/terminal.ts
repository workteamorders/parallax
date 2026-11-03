/**
 * Live-only data path for hosting without a database (devnet stage). Everything is fetched on demand from
 * the same public sources as the worker (Velocity stats/candles, Jupiter prediction detail) and checked
 * with the same parsers and the same manifest review rules as the seed. Nothing is stored, so there is no
 * history, no signals, no sessions and no alerts; those are reported as unavailable, never invented.
 */
import type { Candle, Perp, PredictionMarket, TerminalData, Theme, ThemeHistory, VenueHealth } from "@parallax/shared";
import { jupiterMarketSchema, parseCandles, parsePerps, parsePrediction } from "../../../api/src/providers-core";
import { manifest, reviewedAt, type ReviewedTheme } from "../../../api/src/theme-manifest";
import { rulesHash } from "../../../api/src/analytics";
import { builderFee, tradingStatus } from "../../../api/src/trading-status";

const VELOCITY = "https://data.velocity.exchange";
const JUPITER = "https://api.jup.ag/prediction/v1";
const CONCURRENCY = 3;

export type Fetcher = (url: string, init?: { ttl: number }) => Promise<Response>;

export interface LiveDeps {
  fetcher: Fetcher;
  now: () => Date;
  env: Record<string, string | undefined>;
}

async function json(deps: LiveDeps, url: string, ttl: number): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await deps.fetcher(url, { ttl });
    if (response.status === 429 && attempt === 0) {
      await response.body?.cancel();
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  throw new Error("rate limited");
}

export function liveTrading(env: LiveDeps["env"]) {
  const network = env.SOLANA_NETWORK === "mainnet-beta" ? "mainnet-beta" : "devnet";
  const flag = env.DEVNET_TRADING_ENABLED === "true" ? "true" : "false";
  const mainnetFlag = env.MAINNET_TRADING_ENABLED === "true" ? "true" : "false";
  return tradingStatus(network, flag, builderFee(Number(env.BUILDER_FEE_TENTHS_BP ?? 20)), mainnetFlag);
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(runners);
  return out;
}

function stub(entry: ReviewedTheme, capturedAt: string): PredictionMarket {
  return {
    venue: "polymarket", venueMarketId: entry.marketId, title: entry.marketTitle,
    yesBid: null, yesAsk: null, yesMid: null, volume24h: null, liquidity: null,
    closeTime: new Date(entry.closeTime * 1000).toISOString(), rules: "",
    source: `${JUPITER}/markets/${encodeURIComponent(entry.marketId)}`, transport: "jupiter", capturedAt,
  };
}

interface Resolved { theme: Theme; fetched: boolean; failed: boolean }

async function resolveTheme(deps: LiveDeps, entry: ReviewedTheme, capturedAt: string): Promise<Resolved> {
  const base = {
    id: entry.slug, slug: entry.slug, title: entry.title,
    description: "Individually reviewed prediction contract. A directional research relationship is not settlement equivalence or a hedge.",
    tags: ["crypto", entry.perpSymbol?.split("-")[0]?.toLowerCase() ?? "unmapped"],
    direction: entry.direction, perpSymbol: entry.perpSymbol, volume24h: null,
  };
  const make = (status: Theme["reviewStatus"], note: string, market: PredictionMarket): Theme => ({
    ...base, reviewStatus: status, markets: [market], confidence: status === "approved" ? 0.8 : 0.15, reviewNote: note,
  });
  const reason = `${entry.reason} Reviewed ${reviewedAt}.`;
  if (entry.status === "rejected") return { theme: make("rejected", reason, stub(entry, capturedAt)), fetched: false, failed: false };
  if (entry.closeTime * 1000 <= deps.now().getTime())
    return { theme: make("candidate", `Expired contract; no live signal. ${reason}`, stub(entry, capturedAt)), fetched: false, failed: false };
  try {
    const raw = jupiterMarketSchema.parse(await json(deps, `${JUPITER}/markets/${encodeURIComponent(entry.marketId)}`, 60));
    if (raw.marketId !== entry.marketId) throw new Error("different market");
    const market = parsePrediction(raw, capturedAt);
    if (!market) throw new Error("unverified provider");
    const matches = rulesHash(market.rules) === entry.rulesHash && raw.title === entry.marketTitle && raw.closeTime === entry.closeTime
      && (entry.openTime === undefined || raw.openTime === entry.openTime);
    const active = raw.status === "open" && raw.closeTime * 1000 > deps.now().getTime();
    const status = matches && active ? entry.status : "candidate";
    if (!active) market.yesBid = market.yesAsk = market.yesMid = null;
    const note = `${reason} ${!matches ? "RULES/STRIKE/EXPIRY CHANGED: re-review required. " : ""}${!active ? "No longer open; excluded from signals. " : ""}`;
    return { theme: make(status, note, market), fetched: true, failed: false };
  } catch {
    return {
      theme: make("candidate", `Live check unavailable, so this contract is not verified right now. ${reason}`, stub(entry, capturedAt)),
      fetched: false, failed: true,
    };
  }
}

export async function liveTerminal(deps: LiveDeps): Promise<TerminalData> {
  const capturedAt = deps.now().toISOString();
  let perps: Perp[] = [];
  let velocity: VenueHealth;
  try {
    perps = parsePerps(await json(deps, `${VELOCITY}/stats/markets`, 30), capturedAt);
    if (!perps.length) throw new Error("empty");
    velocity = { venue: "velocity", status: "healthy", message: `${perps.length} active perps; human-decimal prices; funding units undocumented, no annualization.`, checkedAt: capturedAt };
  } catch {
    velocity = { venue: "velocity", status: "unavailable", message: "Live discovery unavailable right now.", checkedAt: capturedAt };
  }
  const resolved = await mapLimit(manifest, CONCURRENCY, (entry) => resolveTheme(deps, entry, capturedAt));
  const attempted = resolved.filter((r) => r.fetched || r.failed);
  const ok = resolved.filter((r) => r.fetched).length;
  const failed = resolved.filter((r) => r.failed).length;
  const jupiterStatus: VenueHealth["status"] = !attempted.length ? "unavailable" : ok === 0 ? "unavailable" : failed ? "degraded" : "healthy";
  const jupiter: VenueHealth = {
    venue: "jupiter", status: jupiterStatus, checkedAt: capturedAt,
    message: `${ok} live contract checks, ${failed} failures. Transport only, not an independent venue.`,
  };
  const health: VenueHealth[] = [
    velocity,
    jupiter,
    { ...jupiter, venue: "polymarket", message: `${ok} live contract checks via Jupiter, with Polymarket provenance. Execution OFF; no cross-venue equivalence claimed.` },
    { venue: "kalshi", status: "unavailable", checkedAt: capturedAt, message: "Not checked in live-only mode. No Kalshi data is shown or invented." },
    { venue: "live-mode", status: "degraded", checkedAt: capturedAt, message: "Live-only mode: no database, so no stored history, signals, sessions, watchlists or alerts." },
  ];
  const order = { approved: 0, candidate: 1, rejected: 2 } as const;
  const themes = resolved.map((r) => r.theme).sort((a, b) => order[a.reviewStatus] - order[b.reviewStatus] || a.slug.localeCompare(b.slug));
  return { themes, perps, signals: [], health, capturedAt, trading: liveTrading(deps.env) };
}

const RESOLUTIONS = new Set(["1", "5", "15", "60", "240", "D", "W", "M"]);
export async function liveCandles(deps: LiveDeps, params: URLSearchParams): Promise<{ candles: Candle[] } | { error: string; status: number }> {
  const symbol = params.get("symbol") ?? "";
  const resolution = params.get("resolution") ?? "60";
  const limit = Number(params.get("limit") ?? 48);
  if (!/^[A-Z0-9]{1,12}-PERP$/.test(symbol) || !RESOLUTIONS.has(resolution) || !Number.isInteger(limit) || limit < 1 || limit > 500)
    return { error: "Invalid candle request", status: 400 };
  try {
    const perps = parsePerps(await json(deps, `${VELOCITY}/stats/markets`, 30));
    if (!perps.some((p) => p.symbol === symbol)) return { error: "Unknown market", status: 404 };
    const raw = await json(deps, `${VELOCITY}/market/${symbol}/candles/${resolution}?limit=${limit}`, 30);
    return { candles: parseCandles(raw) };
  } catch {
    return { error: "Market data unavailable", status: 503 };
  }
}

/** Live-only mode stores nothing: a known theme has an empty (valid) history, an unknown one is 404. */
export function liveHistory(slug: string): ThemeHistory | null {
  return manifest.some((m) => m.slug === slug) ? { probability: [], perp: [] } : null;
}

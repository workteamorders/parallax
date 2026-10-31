import { z } from 'zod';
import type { Candle, Perp, PredictionMarket, VenueHealth } from '@parallax/shared';
import { redis } from './db.js';
import { randomUUID } from 'node:crypto';

const decimal = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)]).transform(Number).pipe(z.number().finite());
const nullableDecimal = decimal.nullish();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const roots = { jupiter: 'https://api.jup.ag/prediction/v1', velocity: 'https://data.velocity.exchange' };

async function paceJupiter(): Promise<void> {
  // A Redis slot is shared by API, worker and review CLI, including retries.
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await redis.set('parallax:jupiter:slot', randomUUID(), 'PX', 2200, 'NX')) return;
    await sleep(250);
  }
  throw new Error('Jupiter request queue timeout');
}

export async function providerJson(provider: keyof typeof roots, path: string): Promise<unknown> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid provider path');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (provider === 'jupiter') await paceJupiter();
    let response: Response;
    try {
      response = await fetch(`${roots[provider]}${path}`, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { accept: 'application/json' } });
    } catch {
      if (attempt === 2) throw new Error(`${provider}: network unavailable`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      await sleep(Math.min(30000, Math.max(1000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)));
      continue;
    }
    if (!response.ok) throw new Error(`${provider}: HTTP ${response.status}`);
    return response.json();
  }
  throw new Error(`${provider}: retry exhausted`);
}

const perpSchema = z.object({
  symbol: z.string(), marketIndex: z.number().int().nonnegative(), baseAsset: z.string(), quoteAsset: z.string(),
  markPrice: decimal.pipe(z.number().positive()), oraclePrice: decimal.pipe(z.number().positive()),
  priceChange24hPercent: z.union([decimal, z.literal('')]).optional(), quoteVolume: decimal.pipe(z.number().nonnegative()),
  openInterest: z.object({ long: decimal, short: decimal }),
  fundingRate: z.object({ long: z.string(), short: z.string() }),
});
export function parsePerps(raw: unknown, capturedAt = new Date().toISOString()): Perp[] {
  const response = z.object({ success: z.literal(true), markets: z.array(z.object({ marketType: z.string(), status: z.string() }).passthrough()) }).parse(raw);
  return response.markets.filter(m => m.marketType === 'perp' && m.status === 'active').map(input => {
    const m = perpSchema.parse(input);
    return { symbol: m.symbol, marketIndex: m.marketIndex, baseAsset: m.baseAsset, quoteAsset: m.quoteAsset,
      mark: m.markPrice, oracle: m.oraclePrice, change24h: typeof m.priceChange24hPercent === 'number' ? m.priceChange24hPercent : null,
      volume24h: m.quoteVolume, openInterestLong: m.openInterest.long, openInterestShort: m.openInterest.short,
      fundingLong: m.fundingRate.long, fundingShort: m.fundingRate.short, capturedAt };
  });
}

export const jupiterMarketSchema = z.object({
  marketId: z.string().min(1), title: z.string().min(1), provider: z.string(), status: z.string(),
  closeTime: z.number().finite().nonnegative(), rulesPrimary: z.string().default(''), rulesSecondary: z.string().default(''),
  openTime: z.number().finite().nonnegative().optional(),
  pricing: z.object({ buyYesPriceUsd: nullableDecimal, sellYesPriceUsd: nullableDecimal, volume: nullableDecimal }).nullish(),
});
export type JupiterMarket = z.infer<typeof jupiterMarketSchema>;
export const jupiterEventSchema = z.object({
  eventId: z.string(), isActive: z.boolean(), category: z.string(),
  metadata: z.object({ title: z.string(), slug: z.string() }), tags: z.array(z.string()).default([]),
  volume24hr: nullableDecimal, markets: z.array(jupiterMarketSchema).default([]),
});
export type JupiterEvent = z.infer<typeof jupiterEventSchema>;
export const jupiterEventsSchema = z.object({ data: z.array(jupiterEventSchema) });

export function parseDiscovery(raw: unknown, capturedAt = new Date().toISOString()) {
  const envelope = z.object({ data: z.array(z.unknown()) }).parse(raw);
  let rejectedRecords = 0;
  const events: JupiterEvent[] = [];
  for (const input of envelope.data) {
    const event = jupiterEventSchema.omit({ markets: true }).extend({ markets: z.array(z.unknown()).default([]) }).safeParse(input);
    if (!event.success) { rejectedRecords++; continue; }
    const markets: JupiterMarket[] = [];
    for (const candidate of event.data.markets) {
      const result = jupiterMarketSchema.safeParse(candidate);
      if (!result.success || [result.data.pricing?.buyYesPriceUsd, result.data.pricing?.sellYesPriceUsd]
        .some(p => p != null && microPrice(p) === null)) { rejectedRecords++; continue; }
      markets.push(result.data);
    }
    events.push({ ...event.data, markets });
  }
  return { events, capturedAt, rejectedRecords };
}

export function microPrice(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) || value < 0 || value > 1e6 ? null : value / 1e6;
}
export function parsePrediction(raw: unknown, capturedAt = new Date().toISOString()): PredictionMarket | null {
  const m = jupiterMarketSchema.parse(raw);
  // gx is not silently relabelled Kalshi: its provenance has not been verified.
  if (m.provider !== 'polymarket' && m.provider !== 'kalshi') return null;
  return { venue: m.provider, venueMarketId: m.marketId, title: m.title,
    ...quote(m),
    volume24h: null, liquidity: null, closeTime: m.closeTime > 0 ? new Date(m.closeTime * 1000).toISOString() : null,
    rules: [m.rulesPrimary, m.rulesSecondary].filter(Boolean).join('\n\n'),
    source: `https://api.jup.ag/prediction/v1/markets/${encodeURIComponent(m.marketId)}`,
    transport: 'jupiter', capturedAt };
}

export function quote(m: JupiterMarket) {
  const bid = microPrice(m.pricing?.sellYesPriceUsd), ask = microPrice(m.pricing?.buyYesPriceUsd);
  const invalid = m.status !== 'open' || (bid !== null && ask !== null && bid > ask);
  return { yesBid: invalid ? null : bid, yesAsk: invalid ? null : ask,
    yesMid: !invalid && bid !== null && ask !== null ? (bid + ask) / 2 : null };
}

export function parseCandles(raw: unknown): Candle[] {
  const result = z.object({ success: z.literal(true), records: z.array(z.object({
    ts: z.number().int().nonnegative(), fillOpen: decimal, fillHigh: decimal, fillLow: decimal, fillClose: decimal, oracleClose: decimal,
  })) }).parse(raw);
  const candles = result.records.map(r => ({ ts: r.ts, open: r.fillOpen, high: r.fillHigh, low: r.fillLow, close: r.fillClose, oracleClose: r.oracleClose }));
  if (candles.some(c => c.low <= 0 || c.oracleClose <= 0 || c.low > c.high || c.open < c.low || c.open > c.high || c.close < c.low || c.close > c.high)) throw new Error('Invalid candle OHLC');
  return candles.sort((a, b) => a.ts - b.ts);
}
export async function fetchPerps(): Promise<Perp[]> { return parsePerps(await providerJson('velocity', '/stats/markets')); }
export async function fetchMarket(id: string): Promise<{ raw: JupiterMarket; market: PredictionMarket | null }> {
  const raw = jupiterMarketSchema.parse(await providerJson('jupiter', `/markets/${encodeURIComponent(id)}`));
  if (raw.marketId !== id) throw new Error('Provider returned a different market ID');
  return { raw, market: parsePrediction(raw) };
}

export async function probeDirectSources(): Promise<VenueHealth[]> {
  const endpoints = [
    { venue: 'gamma', url: 'https://gamma-api.polymarket.com/markets/keyset?limit=1&active=true&closed=false' },
    { venue: 'kalshi-elections', url: 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=1&status=open' },
    { venue: 'kalshi-external', url: 'https://external-api.kalshi.com/trade-api/v2/markets?limit=1&status=open' },
  ];
  return Promise.all(endpoints.map(async ({ venue, url }): Promise<VenueHealth> => {
    const key = `parallax:probe:${venue}`;
    const cached = await redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);
    let result: VenueHealth;
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = z.object({ markets: z.array(z.unknown()) }).parse(await response.json());
      result = { venue, status: 'healthy', message: `Verified TLS GET ${url}: HTTP ${response.status}, ${body.markets.length} market record(s). Connectivity only; not a reviewed equivalence or execution authorization.`, checkedAt: new Date().toISOString() };
    } catch {
      result = { venue, status: 'unavailable', message: `Verified TLS GET ${url} failed or returned an invalid response; no insecure retry.`, checkedAt: new Date().toISOString() };
    }
    await redis.set(key, JSON.stringify(result), 'EX', 60).catch(() => {});
    return result;
  }));
}

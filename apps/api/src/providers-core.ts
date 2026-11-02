import { z } from 'zod';
import type { Candle, Perp, PredictionMarket } from '@parallax/shared';

const decimal = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)]).transform(Number).pipe(z.number().finite());
const nullableDecimal = decimal.nullish();

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

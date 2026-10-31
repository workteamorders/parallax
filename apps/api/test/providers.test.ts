import { describe, it, expect, vi } from 'vitest';
import { parseDiscovery, parsePerps, parseCandles, quote, providerJson } from '../src/providers.js';
import { redis } from '../src/db.js';
import { jupiterLive, velocityLive, candlesLive } from './fixtures/live.js';
import { reviewedEvidence } from '../src/data/reviewed.js';
import { evidenceDecision, buildTheme, ruleHash } from '../src/themes.js';

const capturedAt = '2026-10-29T10:40:38.396Z';
describe('recorded live feed normalization', () => {
  it('filters spot markets and preserves human decimals, signed base OI, and raw funding', () => {
    const perps = parsePerps(velocityLive, capturedAt);
    expect(perps.map(p => p.symbol)).toEqual(['SOL-PERP', 'BTC-PERP', 'ETH-PERP', 'HYPE-PERP', 'ZEC-PERP']);
    expect(perps[0]).toMatchObject({ marketIndex: 0, mark: 100.389, volume24h: 25528.732222,
      openInterestLong: 687.73, openInterestShort: -679.69, fundingLong: '-0.00125', change24h: -2.42 });
  });
  it('normalizes microUSD bid/ask without mislabeling market volume or liquidity', () => {
    const { events } = parseDiscovery(jupiterLive, capturedAt);
    const m = events[1]!.markets.find(m => m.marketId === 'POLY-6084544')!;
    expect(quote(m)).toEqual({ yesBid: 0.55, yesAsk: 0.57, yesMid: 0.56 });
    expect(quote({ ...m, status: 'closed' }).yesMid).toBeNull();
    expect(quote({ ...m, pricing: { sellYesPriceUsd: 0, buyYesPriceUsd: 0 } }).yesMid).toBe(0);
  });
  it('retains actual candle timestamps, fill OHLC, and oracle close in ascending order', () => {
    const candles = parseCandles(candlesLive);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({ ts: 1793264400, open: 100.056779, high: 100.056779,
      low: 100.056779, close: 100.056779, oracleClose: 100.16431 });
  });
  it('quarantines malformed market data and rejects invalid perp/candle data', () => {
    const raw = structuredClone(jupiterLive);
    raw.data[0]!.markets[0]!.pricing.buyYesPriceUsd = 1000001;
    const parsed = parseDiscovery(raw, capturedAt);
    expect(parsed.rejectedRecords).toBe(1);
    expect(parsed.events[0]!.markets).toHaveLength(9);
    expect(() => parsePerps({ success: false, markets: [] }, capturedAt)).toThrow();
    expect(() => parseCandles({ success: true, records: [{ ...candlesLive.records[0], fillHigh: 1 }] })).toThrow();
  });
});

describe('exact-rule single-venue reviews', () => {
  const reviews = new Map(reviewedEvidence.map(e => [e.marketId, evidenceDecision(e)]));
  const symbols = new Set(['BTC-PERP', 'SOL-PERP']);
  const { events } = parseDiscovery(jupiterLive, capturedAt);
  it('approves 21 individually reviewed real contracts, not 21 independent economic events', () => {
    const themes = events.flatMap(e => e.markets.map(m => buildTheme(e, m, capturedAt, reviews, symbols)!));
    expect(themes).toHaveLength(21);
    expect(themes.every(t => t.reviewStatus === 'approved' && t.markets.length === 1)).toBe(true);
    expect(new Set(themes.map(t => t.slug)).size).toBe(21);
    expect(themes.every(t => t.markets[0]!.transport.includes('jup.ag') && t.markets[0]!.venue === 'polymarket')).toBe(true);
    expect(themes.every(t => t.volume24h === null && t.markets[0]!.volume24h === null && t.markets[0]!.liquidity === null)).toBe(true);
  });
  it('invalidates on title, date, creation-window, rule, or provider changes', () => {
    const e = events[0]!, m = e.markets[0]!;
    for (const changed of [{ ...m, title: '85,000' }, { ...m, openTime: m.openTime! + 1 },
      { ...m, closeTime: m.closeTime + 1 }, { ...m, rulesSecondary: 'Resolution amended' }]) {
      expect(ruleHash(e, changed)).not.toBe(ruleHash(e, m));
      expect(buildTheme(e, changed, capturedAt, reviews, symbols)).toMatchObject({ reviewStatus: 'candidate', perpSymbol: null });
    }
    expect(buildTheme(e, { ...m, provider: 'gx' }, capturedAt, reviews, symbols)).toBeNull();
    expect(buildTheme(e, m, '2026-11-02T00:00:00Z', reviews, symbols)?.reviewStatus).toBe('candidate');
    expect(buildTheme(e, m, capturedAt, reviews, new Set())?.perpSymbol).toBeNull();
  });
});

describe('global source rate reservation', () => {
  it('reserves one shared Jupiter slot for every network request', async () => {
    const reservation = vi.spyOn(redis, 'set').mockResolvedValue('OK');
    const fetcher = vi.fn(async () => new Response(JSON.stringify(jupiterLive), { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetcher);
    try {
      await providerJson('jupiter', '/events?provider=polymarket');
      await providerJson('jupiter', '/events?provider=polymarket');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(reservation).toHaveBeenCalledTimes(2);
      expect(reservation).toHaveBeenCalledWith('parallax:jupiter:slot', expect.any(String), 'PX', 2200, 'NX');
      expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('provider=polymarket'), expect.objectContaining({ redirect: 'error' }));
    } finally { vi.unstubAllGlobals(); reservation.mockRestore(); redis.disconnect(); }
  });
});

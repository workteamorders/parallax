import { describe, expect, it, afterAll } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { parsePerps, parsePrediction, parseCandles, microPrice } from '../src/providers.js';
import { orient, executableSpread, equivalent, consensus, divergence, rulesHash, rulesDiff, type PairedSample } from '../src/analytics.js';
import { builderFee, geoDecision, trading, tradingStatus } from '../src/config.js';
import { verifyWalletSignature } from '../src/auth.js';
import { closeConnections } from '../src/db.js';
import { manifest } from '../src/theme-manifest.js';
import { jupiterMarket, velocityCandles, velocityMarkets } from './fixtures/live.js';
import { applyTerminalFreshness } from '../src/store.js';
import type { TerminalData } from '@parallax/shared';

afterAll(closeConnections);
describe('real public provider fixtures', () => {
  it('filters mixed spot discovery and keeps human decimals and signed shorts', () => {
    const perps = parsePerps(velocityMarkets);
    expect(perps).toHaveLength(1);
    expect(perps[0]).toMatchObject({ symbol: 'SOL-PERP', marketIndex: 0, mark: 100.6325, oracle: 100.627544,
      quoteAsset: 'USDT', openInterestShort: -679.69, fundingLong: '-0.00125', change24h: -0.68 });
  });
  it('fails closed on malformed price or provider failure', () => {
    expect(() => parsePerps({ success: false, markets: [] })).toThrow();
    const broken = structuredClone(velocityMarkets);
    broken.markets[1]!.markPrice = 'NaN';
    expect(() => parsePerps(broken)).toThrow();
    expect(microPrice(1000001)).toBeNull();
    expect(microPrice(-1)).toBeNull();
    expect(microPrice(0)).toBe(0);
  });
  it('normalizes microUSD but never labels transport a venue or total volume as 24h', () => {
    const m = parsePrediction(jupiterMarket)!;
    expect(m).toMatchObject({ venue: 'polymarket', transport: 'jupiter', yesAsk: 0.07, yesBid: 0.04, volume24h: null, liquidity: null });
    expect(m.yesMid).toBeCloseTo(0.055);
    expect(rulesHash(m.rules)).toBe(manifest.find(t => t.marketId === m.venueMarketId)!.rulesHash);
    expect(parsePrediction({ ...jupiterMarket, provider: 'gx' })).toBeNull();
  });
  it('does not create a mid for one-sided or crossed books', () => {
    expect(parsePrediction({ ...jupiterMarket, pricing: { buyYesPriceUsd: null, sellYesPriceUsd: 40000 } })?.yesMid).toBeNull();
    expect(parsePrediction({ ...jupiterMarket, pricing: { buyYesPriceUsd: 10000, sellYesPriceUsd: 40000 } })?.yesBid).toBeNull();
  });
  it('keeps candle seconds, fill OHLC and actual oracle close; sorts ascending', () => {
    const candles = parseCandles(velocityCandles);
    expect(candles.map(c => c.ts)).toEqual([1793275200, 1793278800]);
    expect(candles[1]).toMatchObject({ close: 100.056779, oracleClose: 100.578326 });
  });
});
describe('research calculations', () => {
  const market = parsePrediction(jupiterMarket)!;
  it('orients No executable bid/ask correctly rather than swapping Yes labels', () => {
    expect(orient(market, -1).bid).toBeCloseTo(0.93);
    expect(orient(market, -1).ask).toBeCloseTo(0.96);
    const sell = { ...market, yesBid: 0.01, yesAsk: 0.02 };
    expect(executableSpread(market, sell, -1, 0.005)).toBeCloseTo(0.015);
    expect(executableSpread(market, { ...sell, yesAsk: null }, -1)).toBeNull();
  });
  it('requires explicit reviewed equivalence, identical rules and expiry', () => {
    const a = { ...market, equivalenceKey: 'reviewed-contract-A' };
    expect(equivalent(a, { ...a })).toBe(true);
    expect(equivalent(market, market)).toBe(false);
    expect(equivalent(a, { ...a, rules: `${a.rules} Different settlement source.` })).toBe(false);
    expect(equivalent(a, { ...a, closeTime: '2027-01-01T00:00:00Z' })).toBe(false);
    expect(equivalent(a, { ...a, title: '\u2191 120' })).toBe(false);
    expect(equivalent({ ...a, direction: 1 }, { ...a, direction: -1 })).toBe(false);
  });
  it('deduplicates same venue contract accessed through two transports', () => {
    expect(consensus([market, { ...market, transport: 'gamma', yesMid: 0.99 }], 1)).toBeCloseTo(0.055);
    expect(consensus([{ ...market, yesMid: null }], 1)).toBeNull();
    expect(consensus([market], -1)).toBeCloseTo(0.945);
  });
  it('weights only known finite positive liquidity without inventing multi-market weights', () => {
    const a = { ...market, liquidity: 10, yesMid: 0.2 };
    const b = { ...market, venue: 'kalshi' as const, venueMarketId: 'different-reviewed-contract', liquidity: 30, yesMid: 0.8 };
    expect(consensus([a, b], 1)).toBeCloseTo(0.65);
    expect(consensus([a, b], -1)).toBeCloseTo(0.35);
    expect(consensus([a, { ...a, liquidity: 1000, yesMid: 1, transport: 'gamma' }, b], 1)).toBeCloseTo(0.65);
    expect(consensus([{ ...a, liquidity: null }, { ...b, liquidity: null }], 1)).toBeNull();
    expect(consensus([{ ...a, liquidity: null }, b], 1)).toBeCloseTo(0.8);
    for (const liquidity of [0, -1, NaN, Infinity]) expect(consensus([{ ...a, liquidity }, { ...b, liquidity: null }], 1)).toBeNull();
    expect(consensus([{ ...a, liquidity: 1e308 }, { ...b, liquidity: 1e308 }], 1)).toBeCloseTo(0.5);
  });
  it('flags close times strictly over 24 hours, named sources, numeric barriers and outcome orientation', () => {
    const a = { ...market, title: '\u2191 110', direction: 1 as const };
    const same = rulesDiff(a, { ...a, title: '\u2191 $110.00' });
    expect(same).toMatchObject({ closeTimeOver24h: false, closeTimeUnknown: false, namedSourcesDiffer: false,
      namedSourcesUnknown: false, numericThresholdsDiffer: false, numericThresholdsUnknown: false, orientationDiffers: false });
    const close = Date.parse(a.closeTime!);
    expect(rulesDiff(a, { ...a, closeTime: new Date(close + 86400000).toISOString() }).closeTimeOver24h).toBe(false);
    expect(rulesDiff(a, { ...a, closeTime: new Date(close + 86400001).toISOString() }).closeTimeOver24h).toBe(true);
    expect(rulesDiff(a, { ...a, closeTime: new Date(close - 86400001).toISOString() }).closeTimeOver24h).toBe(true);
    expect(rulesDiff(a, { ...a, closeTime: null }).closeTimeUnknown).toBe(true);
    expect(rulesDiff(a, { ...a, rules: 'Resolution source: Chainlink https://data.chain.link/streams/sol-usd' }).namedSourcesDiffer).toBe(true);
    expect(rulesDiff({ ...a, rules: 'Resolution source: https://data.chain.link/streams/sol-usd' },
      { ...a, rules: 'Resolution source: CHAINLINK https://data.chain.link/streams/sol-usd' }).namedSourcesDiffer).toBe(false);
    expect(rulesDiff(a, { ...a, title: '\u2191 120' }).numericThresholdsDiffer).toBe(true);
    expect(rulesDiff({ ...a, title: '$100M' }, { ...a, title: '$100,000,000' }).numericThresholdsDiffer).toBe(false);
    expect(rulesDiff({ ...a, title: '80,000-82,000' }, { ...a, title: '80,000-83,000' }).numericThresholdsDiffer).toBe(true);
    expect(rulesDiff(a, { ...a, rules: `${a.rules} Deadline October 30, 2026 at 12:00 ET.` }).numericThresholdsDiffer).toBe(false);
    expect(rulesDiff(a, { ...a, title: '\u2193 110' }).orientationDiffers).toBe(true);
    expect(rulesDiff(a, { ...a, direction: -1 }).orientationDiffers).toBe(true);
    expect(rulesDiff({ ...a, rules: '', title: 'Unknown' }, { ...a, rules: '', title: 'Unknown' })).toMatchObject({ namedSourcesUnknown: true, numericThresholdsUnknown: true });
  });
  const now = Date.UTC(2026, 9, 29, 12);
  // Synthetic tests only: deterministic historical changes with varying variance.
  const synthetic: PairedSample[] = Array.from({ length: 160 }, (_, i) => ({
    ts: now - (159 - i) * 60 * 60000,
    probability: 0.45 + Math.sin(i * 0.7) * 0.003,
    perp: 100 * Math.exp(Math.cos(i * 0.5) * 0.002),
  }));
  it('requires actual paired history and 30 prior nonoverlapping comparisons', () => {
    expect(divergence('test', [], now)).toBeNull();
    expect(divergence('test', synthetic.slice(-10), now)).toBeNull();
    expect(divergence('test', synthetic.map(s => ({ ...s, probability: 0.5, perp: 100 })), now)).toBeNull();
  });
  it('detects odds-leading divergence without future or >7-day leakage', () => {
    const quietPerp = synthetic[158]!.perp * Math.exp(Math.log(synthetic[157]!.perp / synthetic[0]!.perp) / 157);
    const shocked = synthetic.map((s, i) => i === 159 ? { ...s, probability: 0.75, perp: quietPerp } : s);
    const signal = divergence('test', shocked, now);
    expect(signal?.type).toBe('ODDS_LEAD');
    expect(divergence('test', [...shocked, { ts: now + 1000, probability: 0, perp: 10000 }, { ts: now - 8 * 86400000, probability: 0, perp: 1 }], now)).toEqual(signal);
    expect(divergence('test', shocked, now + 10 * 60000)).toBeNull();
  });
  it('detects perp-leading divergence', () => {
    const quietOdds = synthetic[158]!.probability + (synthetic[157]!.probability - synthetic[0]!.probability) / 157;
    expect(divergence('test', synthetic.map((s, i) => i === 159 ? { ...s, perp: 120, probability: quietOdds } : s), now)?.type).toBe('PERP_LEAD');
  });
});
describe('terminal response freshness', () => {
  const now = Date.UTC(2026, 9, 29, 12);
  const capturedAt = new Date(now).toISOString();
  const packet: TerminalData = {
    themes: [{ id: 'test', slug: 'test', title: 'Test only', description: '', tags: [], direction: 1,
      reviewStatus: 'approved', markets: [parsePrediction(jupiterMarket, capturedAt)!], perpSymbol: null, volume24h: null, confidence: 0.8, reviewNote: 'Test only' }],
    perps: [], signals: [], health: [{ venue: 'jupiter', status: 'healthy', message: 'Test only', checkedAt: capturedAt }], capturedAt, trading,
  };
  it('nulls stale live quotes without changing source timestamps or historical data', () => {
    expect(applyTerminalFreshness(packet, now + 300000).themes[0]!.markets[0]!.yesMid).toBeCloseTo(0.055);
    const stale = applyTerminalFreshness(packet, now + 300001);
    expect(stale.themes[0]!.markets[0]).toMatchObject({ yesBid: null, yesAsk: null, yesMid: null, capturedAt });
    expect(stale.capturedAt).toBe(capturedAt);
    expect(stale.health[0]!.status).toBe('degraded');
    expect(packet.themes[0]!.markets[0]!.yesMid).toBeCloseTo(0.055);
  });
  it('also denies expired, rejected, future-dated and invalid-timestamp live quotes', () => {
    for (const market of [{ ...packet.themes[0]!.markets[0]!, capturedAt: 'invalid' },
      { ...packet.themes[0]!.markets[0]!, capturedAt: new Date(now + 1).toISOString() },
      { ...packet.themes[0]!.markets[0]!, closeTime: capturedAt }]) {
      expect(applyTerminalFreshness({ ...packet, themes: [{ ...packet.themes[0]!, markets: [market] }] }, now).themes[0]!.markets[0]!.yesMid).toBeNull();
    }
    expect(applyTerminalFreshness({ ...packet, themes: [{ ...packet.themes[0]!, reviewStatus: 'rejected' }] }, now).themes[0]!.markets[0]!.yesMid).toBeNull();
  });
});
describe('execution and identity safety', () => {
  it('clamps app fees below protocol cap, default is 20 tenth-bps', () => {
    expect([builderFee(-1), builderFee(-0.1), builderFee(0.9), builderFee(20.9), builderFee(99.9), builderFee(1001), builderFee(NaN), builderFee(Infinity), builderFee(-Infinity)])
      .toEqual([0, 0, 0, 20, 99, 100, 20, 20, 20]);
    expect(trading.enabled).toBe(false);
  });
  it('enables browser devnet trading only on devnet with the explicit flag, never on mainnet', () => {
    expect(tradingStatus('devnet', 'false', 20).enabled).toBe(false);
    expect(tradingStatus('devnet', 'true', 20)).toMatchObject({ enabled: true, network: 'devnet', builderFeeTenthsBp: 20 });
    expect(tradingStatus('mainnet-beta', 'true', 20)).toMatchObject({ enabled: false, network: 'mainnet-beta' });
    expect(tradingStatus('mainnet-beta', 'false', 20).enabled).toBe(false);
  });
  it('fails closed on untrusted or absent location and restricted countries', () => {
    expect(geoDecision('US', true).allowed).toBe(false);
    expect(geoDecision('GB', false).allowed).toBe(false);
    expect(geoDecision(undefined, true).allowed).toBe(false);
    expect(geoDecision('gb', true).allowed).toBe(false);
    expect(geoDecision('GB', true).allowed).toBe(true);
  });
  it('verifies detached wallet messages, rejects changed domain/content and malformed signatures', () => {
    const keys = nacl.sign.keyPair();
    const address = bs58.encode(keys.publicKey), message = 'localhost:3000 wants you to sign in';
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keys.secretKey));
    expect(verifyWalletSignature(address, message, signature)).toBe(true);
    expect(verifyWalletSignature(address, `evil.example ${message}`, signature)).toBe(false);
    expect(verifyWalletSignature(address, message, 'invalid')).toBe(false);
  });
  it('retains 32 approved, seven candidate and four explicitly rejected contracts', () => {
    expect(manifest.filter(t => t.status === 'approved')).toHaveLength(32);
    expect(manifest.filter(t => t.status !== 'rejected')).toHaveLength(39);
    expect(manifest.filter(t => t.status === 'rejected')).toHaveLength(4);
    expect(new Set(manifest.map(t => t.slug)).size).toBe(manifest.length);
    expect(manifest.every(t => t.reason.length > 40 && t.rulesHash.length === 64)).toBe(true);
  });
});

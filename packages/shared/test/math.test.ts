import { describe, it, expect } from 'vitest';
import { probabilityMid, measureLead, type SignalPoint } from '../src/index.js';

describe('probability math', () => {
  it('retains zero and rejects crossed, missing, out-of-range and nonfinite prices', () => {
    expect(probabilityMid(0, 0)).toBe(0);
    expect(probabilityMid(0.55, 0.57)).toBeCloseTo(0.56);
    for (const [bid, ask] of [[null, 0.5], [0.5, null], [0.6, 0.4], [-1, 0.5], [0, 2], [NaN, 1]] as const) {
      expect(probabilityMid(bid, ask)).toBeNull();
    }
  });
});

// Synthetic series are mathematical tests only, never production fallback data.
const now = Date.UTC(2026, 9, 29, 12) / 1000;
const points = (): SignalPoint[] => Array.from({ length: 160 }, (_, i) => ({
  ts: now - (159 - i) * 3600, probability: 0.45 + Math.sin(i * 0.7) * 0.003,
  mark: 100 * Math.exp(Math.cos(i * 0.5) * 0.002)
}));
const oddsShock = () => {
  const samples = points();
  const meanReturn = Math.log(samples[157]!.mark / samples[0]!.mark) / 157;
  samples[159] = { ...samples[159]!, probability: 0.75, mark: samples[158]!.mark * Math.exp(meanReturn) };
  return samples;
};
describe('descriptive lead measurements', () => {
  it('requires a 60-minute window and at least 30 past baseline comparisons', () => {
    expect(measureLead(oddsShock().slice(-31), 1)).toBeNull();
    expect(measureLead(oddsShock().map(p => ({ ...p, ts: now - (now - p.ts) / 1000 })), 1)).toBeNull();
  });
  it('projects follower movement into negative theme direction exactly once', () => {
    const samples = oddsShock();
    const signal = measureLead(samples, -1);
    expect(signal?.type).toBe('ODDS_LEAD');
    expect(signal?.windowMinutes).toBe(60);
    expect(signal?.oddsDeltaPp).toBeCloseTo((0.75 - samples[158]!.probability) * 100);
    expect(signal?.directionalOddsDeltaPp).toBeCloseTo(-signal!.oddsDeltaPp);
    expect(signal?.followZ).toBeCloseTo(0);
  });
  it('mirrors both the leader/follower formula and divergence for perp-leading moves', () => {
    const samples = oddsShock();
    const odds = measureLead(samples, 1)!;
    const mirrored = samples.map(p => ({ ...p, probability: 0.5 + Math.log(p.mark / 100), mark: 100 * Math.exp(p.probability - 0.5) }));
    const perp = measureLead(mirrored, 1)!;
    expect(perp.type).toBe('PERP_LEAD');
    expect(perp.perpZ).toBeCloseTo(odds.oddsZ);
    expect(perp.followZ).toBeCloseTo(odds.followZ);
    expect(perp.divergence).toBeCloseTo(odds.divergence);
  });
  it('suppresses moves that have been followed and applies configurable window/thresholds', () => {
    const samples = oddsShock();
    samples[159]!.mark = 140;
    expect(measureLead(samples, 1)).toBeNull();
    expect(measureLead(oddsShock(), 1, { zThreshold: 1000 })).toBeNull();
    const halfHour = oddsShock().map(p => ({ ...p, ts: now - (now - p.ts) / 2 }));
    expect(measureLead(halfHour, 1, { windowMinutes: 30 })?.windowMinutes).toBe(30);
    expect(measureLead(halfHour, 1, { minCount: 29 })).toBeNull();
  });
  it('uses raw movement signs when a nonzero baseline mean reverses the z-score sign, including the mirror', () => {
    const samples: SignalPoint[] = Array.from({ length: 160 }, (_, i) => ({
      ts: now - (159 - i) * 3600, probability: 0.1 + 0.002 * i + 0.0001 * Math.sin(i * 0.7),
      mark: 100 * Math.exp(0.001 * i + 0.0001 * Math.cos(i * 0.5)),
    }));
    const returns = samples.slice(1, 158).map((p, i) => Math.log(p.mark / samples[i]!.mark));
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const sd = Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1));
    samples[159] = { ...samples[159]!, probability: samples[158]!.probability + 0.001,
      mark: samples[158]!.mark * Math.exp(mean + sd) };
    expect(measureLead(samples, 1)).toBeNull();
    const odds = measureLead(samples, -1)!;
    expect(odds.type).toBe('ODDS_LEAD');
    expect(odds.oddsDeltaPp).toBeGreaterThan(0);
    expect(odds.oddsZ).toBeLessThan(-2);
    expect(odds.followZ).toBeCloseTo(-1);
    const mirrored = samples.map(p => ({ ...p, probability: 0.5 + Math.log(p.mark / 100), mark: 100 * Math.exp(p.probability - 0.1) }));
    expect(measureLead(mirrored, 1)).toBeNull();
    const perp = measureLead(mirrored, -1)!;
    expect(perp.type).toBe('PERP_LEAD');
    expect(perp.perpLogReturn).toBeGreaterThan(0);
    expect(perp.perpZ).toBeLessThan(-2);
    expect(perp.followZ).toBeCloseTo(-1);
    samples[159] = { ...samples[159]!, probability: samples[158]!.probability,
      mark: samples[158]!.mark * Math.exp(mean) };
    expect(measureLead(samples, 1)).toBeNull();
    const zeroPerp = samples.map(p => ({ ...p, probability: 0.5 + Math.log(p.mark / 100), mark: 100 * Math.exp(p.probability - 0.1) }));
    expect(measureLead(zeroPerp, 1)).toBeNull();
  });
  it('excludes future/old data, rejects stale or duplicate samples and degenerate variance', () => {
    const samples = oddsShock();
    const expected = measureLead(samples, 1, {}, now);
    expect(measureLead([...samples, { ts: now + 1, probability: 0, mark: 1 }, { ts: now - 8 * 86400, probability: 0, mark: 1 }], 1, {}, now)).toEqual(expected);
    expect(measureLead(samples, 1, {}, now + 301)).toBeNull();
    expect(measureLead([...samples, samples[0]!], 1, {}, now)).toBeNull();
    expect(measureLead(samples.map(p => ({ ...p, probability: 0.5, mark: 100 })), 1)).toBeNull();
    const invalid = oddsShock(); invalid[159]!.mark = 0;
    expect(measureLead(invalid, 1)).toBeNull();
  });
});

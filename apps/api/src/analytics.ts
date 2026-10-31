import type { PredictionMarket, Signal } from '@parallax/shared';
import { createHash } from 'node:crypto';
import { measureLead, type LeadOptions } from '@parallax/shared';

export function rulesHash(rules: string): string {
  return createHash('sha256').update(rules.replace(/\r\n/g, '\n').trim()).digest('hex');
}
export function equivalent(a: RuleContract & { equivalenceKey?: string }, b: RuleContract & { equivalenceKey?: string }): boolean {
  return Boolean(a.equivalenceKey && a.equivalenceKey === b.equivalenceKey && a.title === b.title && a.closeTime && a.closeTime === b.closeTime && (a.direction ?? 1) === (b.direction ?? 1) && a.rules.trim() && rulesHash(a.rules) === rulesHash(b.rules));
}
export interface RuleContract { title: string; rules: string; closeTime: string | null; direction?: 1 | -1 }
export interface RulesDiff {
  closeTimeOver24h: boolean; closeTimeUnknown: boolean; namedSourcesDiffer: boolean;
  namedSourcesUnknown: boolean; numericThresholdsDiffer: boolean; numericThresholdsUnknown: boolean; orientationDiffers: boolean;
}
export function rulesDiff(a: RuleContract, b: RuleContract): RulesDiff {
  // Conservative textual diagnostics, never a substitute for reviewed equivalence.
  const sources: string[][] = [], thresholds: number[][] = [];
  for (const contract of [a, b]) {
    const names = new Set<string>();
    const text = contract.rules.toLowerCase();
    const recognized = ['binance', 'chainlink', 'coinbase', 'kraken', 'pyth', 'congress.gov'];
    for (const name of recognized) if (text.includes(name)) names.add(name);
    for (const match of text.matchAll(/https?:\/\/([^/\s)"<>]+)/g)) {
      try {
        const host = new URL(match[0]).hostname.replace(/^www\./, '');
        if (host === 'chain.link' || host.endsWith('.chain.link')) names.add('chainlink');
        else if (!recognized.some(name => host.includes(name))) names.add(host);
      } catch { /* Unparseable links cannot attest a named source. */ }
    }
    sources.push([...names].sort());
    const values = new Set<number>();
    const numericTitle = /^(?:[\u2191\u2193]\s*)?\$?\d[\d,]*(?:\.\d+)?(?:\s*[kmb])?(?:\s*-\s*\$?\d[\d,]*(?:\.\d+)?(?:\s*[kmb])?)?$/i.test(contract.title.trim());
    const title = numericTitle ? `$${contract.title.replace(/[\u2191\u2193$]/g, '').replace(/-/g, ' $')}` : contract.title;
    for (const match of `${title}\n${contract.rules}`.matchAll(/(?:\$\s*|[<>]=?\s*|\b(?:above|below|at least|at most|greater than|less than|higher than|lower than|threshold|strike)\s*\$?)(\d[\d,]*(?:\.\d+)?)(?:\s*([kmb])\b)?/gi)) {
      const suffix = match[2]?.toLowerCase();
      const multiplier = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1;
      const value = Number(match[1]!.replace(/,/g, '')) * multiplier;
      if (Number.isFinite(value)) values.add(value);
    }
    thresholds.push([...values].sort((x, y) => x - y));
  }
  const firstClose = Date.parse(a.closeTime ?? ''), secondClose = Date.parse(b.closeTime ?? '');
  const arrow = (title: string) => title.includes('\u2193') ? -1 : title.includes('\u2191') ? 1 : null;
  return { closeTimeOver24h: Number.isFinite(firstClose) && Number.isFinite(secondClose) && Math.abs(firstClose - secondClose) > 86400000,
    closeTimeUnknown: !Number.isFinite(firstClose) || !Number.isFinite(secondClose),
    namedSourcesDiffer: JSON.stringify(sources[0]) !== JSON.stringify(sources[1]),
    namedSourcesUnknown: sources.some(names => names.length === 0),
    numericThresholdsDiffer: JSON.stringify(thresholds[0]) !== JSON.stringify(thresholds[1]),
    numericThresholdsUnknown: thresholds.some(values => values.length === 0),
    orientationDiffers: (a.direction ?? 1) !== (b.direction ?? 1) || (arrow(a.title) !== null && arrow(b.title) !== null && arrow(a.title) !== arrow(b.title)) };
}
export function orient(m: Pick<PredictionMarket, 'yesBid' | 'yesAsk' | 'yesMid'>, direction: 1 | -1) {
  return direction === 1 ? { bid: m.yesBid, ask: m.yesAsk, mid: m.yesMid } : {
    bid: m.yesAsk === null ? null : 1 - m.yesAsk,
    ask: m.yesBid === null ? null : 1 - m.yesBid,
    mid: m.yesMid === null ? null : 1 - m.yesMid,
  };
}
export function executableSpread(buy: PredictionMarket, sell: PredictionMarket, direction: 1 | -1, fee = 0): number | null {
  // Pure quote arithmetic; only use after validating a reviewed equivalence group.
  const a = orient(buy, direction), b = orient(sell, direction);
  return a.ask === null || b.bid === null ? null : b.bid - a.ask - Math.max(0, fee);
}
export function consensus(markets: PredictionMarket[], direction: 1 | -1): number | null {
  const unique = new Map<string, PredictionMarket>();
  for (const m of markets) {
    const key = `${m.venue}:${m.venueMarketId}`;
    if (!unique.has(key)) unique.set(key, m);
  }
  // Caller must supply one reviewed equivalence group, never an event's unrelated strikes.
  const valid = [...unique.values()].filter(m => m.yesMid !== null && Number.isFinite(m.yesMid) && m.yesMid >= 0 && m.yesMid <= 1);
  if (unique.size === 1) return valid[0] ? orient(valid[0], direction).mid : null;
  const weighted = valid.filter(m => m.liquidity !== null && Number.isFinite(m.liquidity) && m.liquidity > 0);
  if (!weighted.length) return null;
  const scale = Math.max(...weighted.map(m => m.liquidity!));
  const total = weighted.reduce((sum, m) => sum + m.liquidity! / scale, 0);
  return weighted.reduce((sum, m) => sum + orient(m, direction).mid! * (m.liquidity! / scale), 0) / total;
}

export interface PairedSample { ts: number; probability: number; perp: number }
export function divergence(themeId: string, samples: PairedSample[], now: number, options: LeadOptions = {}): Signal | null {
  const measurement = measureLead(samples.map(s => ({ ts: s.ts / 1000, probability: s.probability, mark: s.perp })), 1, options, now / 1000);
  if (!measurement) return null;
  return { id: `${themeId}:${measurement.type}:${Math.floor(measurement.ts / (measurement.windowMinutes * 60))}`, themeId, type: measurement.type,
    createdAt: new Date(measurement.ts * 1000).toISOString(), payload: { ...measurement, lookbackDays: 7,
      zThreshold: options.zThreshold ?? 2, followThreshold: options.followThreshold ?? 0.5,
      classification: 'statistical divergence, not causal proof or a trade recommendation' } };
}

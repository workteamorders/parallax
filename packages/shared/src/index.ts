export interface PredictionMarket {
  venue: 'polymarket' | 'kalshi'; venueMarketId: string; title: string;
  yesBid: number | null; yesAsk: number | null; yesMid: number | null;
  volume24h: number | null; liquidity: number | null; closeTime: string | null;
  rules: string; source: string; transport: string; capturedAt: string;
}
export interface Theme {
  id: string; slug: string; title: string; description: string; tags: string[];
  direction: 1 | -1; reviewStatus: 'candidate' | 'approved' | 'rejected';
  markets: PredictionMarket[]; perpSymbol: string | null; volume24h: number | null;
  confidence: number; reviewNote: string;
}
export interface Perp {
  symbol: string; marketIndex: number; baseAsset: string; quoteAsset: string;
  mark: number; oracle: number; change24h: number | null; volume24h: number;
  openInterestLong: number; openInterestShort: number; fundingLong: string;
  fundingShort: string; capturedAt: string;
}
export interface Signal {
  id: string; themeId: string; type: 'ODDS_LEAD' | 'PERP_LEAD';
  createdAt: string; payload: Record<string, unknown>;
}
export interface VenueHealth {
  venue: string; status: 'healthy' | 'degraded' | 'unavailable'; message: string; checkedAt: string;
}
export interface TerminalData {
  themes: Theme[]; perps: Perp[]; signals: Signal[]; health: VenueHealth[];
  capturedAt: string;
  trading: { enabled: boolean; network: 'devnet' | 'mainnet-beta'; reason: string; builderFeeTenthsBp: number };
}
export interface Candle { ts: number; open: number; high: number; low: number; close: number; oracleClose: number }
export interface ThemeHistory { probability: { ts: number; value: number }[]; perp: { ts: number; value: number }[] }

export function probabilityMid(bid: number | null, ask: number | null): number | null {
  return bid === null || ask === null || !Number.isFinite(bid) || !Number.isFinite(ask) || bid < 0 || ask > 1 || bid > ask ? null : (bid + ask) / 2;
}
export interface SignalPoint { ts: number; probability: number; mark: number }
export interface LeadOptions { windowMinutes?: number; zThreshold?: number; followThreshold?: number; minCount?: number }
export interface LeadMeasurement {
  ts: number; type: Signal['type']; oddsZ: number; perpZ: number; followZ: number; divergence: number;
  oddsDeltaPp: number; directionalOddsDeltaPp: number; perpLogReturn: number;
  baselineSamples: number; windowMinutes: number;
}

// All timestamps are seconds. Direction applies to raw YES probability once.
export function measureLead(points: SignalPoint[], direction: 1 | -1, options: LeadOptions = {}, now = points.at(-1)?.ts ?? 0): LeadMeasurement | null {
  const windowMinutes = options.windowMinutes ?? 60, zThreshold = options.zThreshold ?? 2;
  const followThreshold = options.followThreshold ?? 0.5, minCount = options.minCount ?? 30;
  if (!Number.isFinite(now) || !Number.isFinite(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440 || !Number.isFinite(zThreshold) || zThreshold <= 0 || !Number.isFinite(followThreshold) || followThreshold < 0 || followThreshold > 1 || !Number.isInteger(minCount) || minCount < 30) return null;
  const horizon = windowMinutes * 60;
  const sorted = points.filter(p => Number.isFinite(p.ts) && p.ts <= now && p.ts >= now - 7 * 86400 && Number.isFinite(p.mark) && p.mark > 0 && Number.isFinite(p.probability) && p.probability >= 0 && p.probability <= 1)
    .sort((a, b) => a.ts - b.ts);
  if (sorted.some((p, i) => i > 0 && p.ts === sorted[i - 1]!.ts)) return null;
  const current = sorted.at(-1);
  if (!current || now - current.ts > 300 || sorted.length < minCount + 2) return null;
  const prior = sorted.filter(p => p.ts <= current.ts - horizon).at(-1);
  if (!prior || current.ts - prior.ts > horizon + 300) return null;
  const changes: { ts: number; odds: number; perp: number }[] = [];
  let startIndex = 0;
  for (let i = 1; i < sorted.length; i++) {
    const end = sorted[i]!;
    if (end.ts >= prior.ts || (changes.at(-1) && end.ts - changes.at(-1)!.ts < horizon)) continue;
    while (startIndex + 1 < i && sorted[startIndex + 1]!.ts <= end.ts - horizon) startIndex++;
    const start = sorted[startIndex]!;
    if (start.ts <= end.ts - horizon && end.ts - start.ts <= horizon + 300) changes.push({ ts: end.ts, odds: end.probability - start.probability, perp: Math.log(end.mark / start.mark) });
  }
  if (changes.length < minCount) return null;
  const standardize = (value: number, baseline: number[]) => {
    const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const variance = baseline.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (baseline.length - 1);
    return variance < 1e-12 ? null : (value - mean) / Math.sqrt(variance);
  };
  const oddsDelta = current.probability - prior.probability, perpLogReturn = Math.log(current.mark / prior.mark);
  const oddsZ = standardize(oddsDelta, changes.map(c => c.odds));
  const perpZ = standardize(perpLogReturn, changes.map(c => c.perp));
  if (oddsZ === null || perpZ === null) return null;
  // Mirror the follower projection, including direction, rather than selecting
  // whichever absolute z-score is larger without testing whether it was followed.
  const oddsFollow = Math.sign(oddsDelta) * direction * perpZ;
  const perpFollow = Math.sign(perpLogReturn) * direction * oddsZ;
  const oddsLead = oddsDelta !== 0 && Math.abs(oddsZ) >= zThreshold && oddsFollow < followThreshold;
  const perpLead = perpLogReturn !== 0 && Math.abs(perpZ) >= zThreshold && perpFollow < followThreshold;
  if ((!oddsLead && !perpLead) || (oddsLead && perpLead && Math.abs(oddsZ) === Math.abs(perpZ))) return null;
  const type = oddsLead && (!perpLead || Math.abs(oddsZ) > Math.abs(perpZ)) ? 'ODDS_LEAD' : 'PERP_LEAD';
  const followZ = type === 'ODDS_LEAD' ? oddsFollow : perpFollow;
  return { ts: current.ts, type, oddsZ, perpZ, followZ, divergence: Math.abs(type === 'ODDS_LEAD' ? oddsZ : perpZ) - followZ,
    oddsDeltaPp: oddsDelta * 100, directionalOddsDeltaPp: direction * oddsDelta * 100, perpLogReturn,
    baselineSamples: changes.length, windowMinutes };
}

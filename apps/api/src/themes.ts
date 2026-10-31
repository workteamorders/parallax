import { createHash } from 'node:crypto';
import type { Theme } from '@parallax/shared';
import type { JupiterEvent, JupiterMarket } from './providers.js';
import { quote } from './providers.js';
import type { ReviewEvidence } from './data/reviewed.js';

export interface ReviewDecision {
  marketId: string; hash: string; status: Theme['reviewStatus'];
  direction: 1 | -1; perpSymbol: string | null; note: string;
}
export function ruleHash(e: Pick<JupiterEvent, 'eventId' | 'metadata'>, m: JupiterMarket): string {
  // Bind context as well as text: threshold/date often live in titles, not rules.
  return createHash('sha256').update(JSON.stringify([
    e.eventId, e.metadata.title, e.metadata.slug, m.marketId, m.title,
    m.provider, m.openTime ?? null, m.closeTime, m.rulesPrimary, m.rulesSecondary
  ])).digest('hex');
}
export function evidenceDecision(e: ReviewEvidence): ReviewDecision {
  const event = { eventId: e.eventId, metadata: { title: e.eventTitle, slug: e.eventSlug } };
  const market: JupiterMarket = { ...e, status: 'open' };
  return { marketId: e.marketId, hash: ruleHash(event, market), status: 'approved',
    direction: e.direction, perpSymbol: e.perpSymbol, note: e.note };
}
export function buildTheme(e: JupiterEvent, m: JupiterMarket, capturedAt: string,
  reviews: Map<string, ReviewDecision>, discoveredSymbols: Set<string>): Theme | null {
  // Do not infer that gx means Kalshi, or that Jupiter is a second venue.
  if (m.provider !== 'polymarket') return null;
  const hash = ruleHash(e, m);
  const review = reviews.get(m.marketId);
  const matches = review?.hash === hash;
  const live = e.isActive && m.status === 'open' && m.closeTime * 1000 > Date.parse(capturedAt);
  const status = review && matches && live && m.rulesPrimary.trim() ? review.status : 'candidate';
  const approved = status === 'approved';
  const q = quote(m);
  const rules = [m.rulesPrimary, m.rulesSecondary].filter(Boolean).join('\n\n');
  return {
    id: `polymarket:${m.marketId}`, slug: `${e.metadata.slug}-${m.marketId.toLowerCase()}`,
    title: `${e.metadata.title}: ${m.title}`, description: 'Single-venue prediction contract with contextual Velocity perpetual exposure. No cross-venue equivalence claimed.',
    tags: [...new Set([e.category, ...e.tags, 'single-venue'])],
    direction: matches && review ? review.direction : 1, reviewStatus: status,
    markets: [{ venue: 'polymarket', venueMarketId: m.marketId, title: m.title,
      ...q, volume24h: null, liquidity: null, closeTime: new Date(m.closeTime * 1000).toISOString(),
      rules, source: `https://polymarket.com/event/${encodeURIComponent(e.metadata.slug)}`,
      transport: 'https://api.jup.ag/prediction/v1', capturedAt }],
    // Event-wide volume cannot be attributed to an individual binary theme.
    volume24h: null,
    perpSymbol: approved && review?.perpSymbol && discoveredSymbols.has(review.perpSymbol) ? review.perpSymbol : null,
    confidence: approved ? 0.8 : 0.15,
    reviewNote: !live ? 'Inactive, closed, or expired contract; not signal eligible.'
      : !m.rulesPrimary.trim() ? 'Primary rules unavailable; needs review.'
        : matches && review ? review.note : review ? 'Rule/context fingerprint changed. Previous review invalidated; needs re-review.'
          : 'Candidate only. Direction is an unreviewed placeholder; no perp mapping or signals until exact rules and context are reviewed.'
  };
}

import { reviewedEvidence } from '../../src/data/reviewed.js';

/** Public live-response projections observed 2026-10-29. Exact rule strings/IDs/times
 * are deduplicated with the reviewed evidence, not invented. Fixtures are test-only.
 * Buy/sell tuples below are the actual Jupiter microUSD quotes read that day.
 */
const quotes: Record<string, [number, number]> = {
  'POLY-6051332': [200000, 190000], 'POLY-5170739': [140000, 130000],
  'POLY-5170740': [24000, 23000], 'POLY-5407561': [18000, 17000],
  'POLY-5170735': [9000, 8000], 'POLY-5170741': [8000, 6000],
  'POLY-5170742': [5000, 4000], 'POLY-5170734': [4000, 3000],
  'POLY-5170732': [3000, 2000], 'POLY-5170733': [2000, 1000],
  'POLY-6084540': [1000000, 982000], 'POLY-6084541': [995000, 994000],
  'POLY-6084542': [993000, 991000], 'POLY-6084543': [975000, 937000],
  'POLY-6084544': [570000, 550000], 'POLY-6084546': [90000, 70000],
  'POLY-6084548': [25000, 5000], 'POLY-6084550': [20000, 3000],
  'POLY-6084552': [19000, 4000], 'POLY-6084555': [19000, 0],
  'POLY-6084556': [19000, 0]
};
export const jupiterLive = {
  data: ['POLY-1112205', 'POLY-1241190'].map(eventId => {
    const records = reviewedEvidence.filter(e => e.eventId === eventId);
    const e = records[0]!;
    return { eventId, isActive: true, category: 'crypto',
      metadata: { title: e.eventTitle, slug: e.eventSlug },
      volume24hr: eventId === 'POLY-1112205' ? '1040168000000' : '30151000000',
      markets: records.map(r => ({ marketId: r.marketId, title: r.title,
        provider: r.provider, status: 'open', openTime: r.openTime, closeTime: r.closeTime,
        rulesPrimary: r.rulesPrimary, rulesSecondary: r.rulesSecondary,
        pricing: { buyYesPriceUsd: quotes[r.marketId]![0], sellYesPriceUsd: quotes[r.marketId]![1] } })) };
  })
};

export const velocityLive = { success: true, markets: [
  { symbol: 'USDT', marketIndex: 0, marketType: 'spot', status: 'active', oraclePrice: '0.998793' },
  { symbol: 'SOL-PERP', marketIndex: 0, marketType: 'perp', status: 'active', baseAsset: 'SOL', quoteAsset: 'USDT',
    markPrice: '100.389000', oraclePrice: '100.383794', quoteVolume: '25528.732222', priceChange24hPercent: '-2.42',
    openInterest: { long: '687.73', short: '-679.69' }, fundingRate: { long: '-0.00125', short: '0.00125' } },
  { symbol: 'BTC-PERP', marketIndex: 1, marketType: 'perp', status: 'active', baseAsset: 'BTC', quoteAsset: 'USDT',
    markPrice: '80106.050000', oraclePrice: '80146.353157', quoteVolume: '5271.093313', priceChange24hPercent: '-1.54',
    openInterest: { long: '0.0805', short: '-0.3539' }, fundingRate: { long: '-0.001011', short: '0.001011' } },
  { symbol: 'ETH-PERP', marketIndex: 2, marketType: 'perp', status: 'active', baseAsset: 'ETH', quoteAsset: 'USDT',
    markPrice: '2321.085000', oraclePrice: '2321.923711', quoteVolume: '2890.696413', priceChange24hPercent: '-1.82',
    openInterest: { long: '3.192', short: '-7.028' }, fundingRate: { long: '-0.00125', short: '0.00125' } },
  { symbol: 'HYPE-PERP', marketIndex: 3, marketType: 'perp', status: 'active', baseAsset: 'HYPE', quoteAsset: 'USDT',
    markPrice: '82.603500', oraclePrice: '82.834778', quoteVolume: '397.174018', priceChange24hPercent: '0.28',
    openInterest: { long: '30.1', short: '0' }, fundingRate: { long: '-0.00125', short: '0.00125' } },
  { symbol: 'ZEC-PERP', marketIndex: 4, marketType: 'perp', status: 'active', baseAsset: 'ZEC', quoteAsset: 'USDT',
    markPrice: '1267.020000', oraclePrice: '1266.029908', quoteVolume: '130.961809', priceChange24hPercent: '-3.39',
    openInterest: { long: '11.853', short: '-5.5' }, fundingRate: { long: '-0.006356', short: '0.006356' } }
] };

export const candlesLive = { success: true, records: [
  { ts: 1793268000, fillOpen: 100.056779, fillHigh: 100.056779, fillClose: 100.056779, fillLow: 100.056779,
    oracleOpen: 100.16431, oracleHigh: 100.373489, oracleClose: 100.373489, oracleLow: 99.963245, quoteVolume: 0, baseVolume: 0 },
  { ts: 1793264400, fillOpen: 100.056779, fillHigh: 100.056779, fillClose: 100.056779, fillLow: 100.056779,
    oracleOpen: 100.164115, oracleHigh: 100.439782, oracleClose: 100.16431, oracleLow: 99.932096, quoteVolume: 0, baseVolume: 0 }
] };

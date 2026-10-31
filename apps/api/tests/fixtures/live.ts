// Sanitized public response excerpts retrieved with TLS verification on 2026-10-29.
// No authentication, account data, generated prices or production fallback data.
export const velocityMarkets = { success: true, markets: [
  { symbol: 'USDT', marketIndex: 0, marketType: 'spot', status: 'active', oraclePrice: '0.998747' },
  { symbol: 'SOL-PERP', marketIndex: 0, marketType: 'perp', status: 'active', baseAsset: 'SOL', quoteAsset: 'USDT',
    markPrice: '100.632500', oraclePrice: '100.627544', priceChange24hPercent: '-0.68', quoteVolume: '24597.696849',
    openInterest: { long: '687.73', short: '-679.69' }, fundingRate: { long: '-0.00125', short: '0.00125' } },
] };
export const velocityCandles = { success: true, records: [
  { ts: 1793278800, fillOpen: 100.056779, fillHigh: 100.056779, fillClose: 100.056779, fillLow: 100.056779,
    oracleOpen: 100.37124, oracleHigh: 100.739999, oracleClose: 100.578326, oracleLow: 100.37124, quoteVolume: 0, baseVolume: 0 },
  { ts: 1793275200, fillOpen: 100.056779, fillHigh: 100.056779, fillClose: 100.056779, fillLow: 100.056779,
    oracleOpen: 100.351306, oracleHigh: 100.538144, oracleClose: 100.37124, oracleLow: 100.061428, quoteVolume: 0, baseVolume: 0 },
] };
export const jupiterMarket = {
  marketId: 'POLY-5611739', provider: 'polymarket', title: '\u2191 110', status: 'open', closeTime: 1793505600,
  rulesPrimary: 'This market will resolve to "Yes" if any Binance 1 minute candle for SOL/USDT from the creation of this market through 11:59 PM ET on the last day of the month specified in the title has a final High price equal to or greater than the price specified in the title. Otherwise, this market will resolve to "No". Price action before this market\'s creation will not be considered.\n\nThe resolution source for this market is Binance, specifically the SOL/USDT High prices available at https://www.binance.com/en/trade/SOL_USDT, with the chart settings on "1m" for one-minute candles selected on the top bar.\n\nPlease note that the outcome of this market depends solely on the price data from the Binance SOL/USDT trading pair. Prices from other exchanges, different trading pairs, or spot markets will not be considered for the resolution of this market.',
  rulesSecondary: '',
  pricing: { buyYesPriceUsd: 70000, sellYesPriceUsd: 40000, sellNoPriceUsd: 930000, buyNoPriceUsd: 960000, volume: 26792 },
};

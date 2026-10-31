/** Exact, manually read rule text from Jupiter's live Polymarket events, 2026-10-29.
 * These are review evidence, never a quote or runtime market-data fallback.
 */
export const btcHighCreation = 'This market will resolve to "Yes" if any Binance 1 minute candle for BTC/USDT from the creation of this market through 11:59 PM ET on the last day of the month specified in the title has a final High price equal to or greater than the price specified in the title. Otherwise, this market will resolve to "No". Price action before this market\'s creation will not be considered.\n\nThe resolution source for this market is Binance, specifically the BTC/USDT High prices available at https://www.binance.com/en/trade/BTC_USDT, with the chart settings on "1m" for one-minute candles selected on the top bar.\n\nPlease note that the outcome of this market depends solely on the price data from the Binance BTC/USDT trading pair. Prices from other exchanges, different trading pairs, or spot markets will not be considered for the resolution of this market.';
export const btcHighMonth = 'This market will immediately resolve to "Yes" if any Binance 1 minute candle for BTC/USDT during the month specified in the title (from 00:00 AM ET on the first day to 11:59 PM ET on the last), has a final High price equal to or greater than the price specified in the title. Otherwise, this market will resolve to "No."\n\nThe resolution source for this market is Binance, specifically the BTC/USDT High prices available at https://www.binance.com/en/trade/BTC_USDT, with the chart settings on "1m" for one-minute candles selected on the top bar.\n\nPlease note that the outcome of this market depends solely on the price data from the Binance BTC/USDT trading pair. Prices from other exchanges, different trading pairs, or spot markets will not be considered for the resolution of this market.';
export const btcLowMonth = 'This market will immediately resolve to "Yes" if any Binance 1 minute candle for BTC/USDT during the month specified in the title (from 00:00 AM ET on the first day to 11:59 PM ET on the last), has a final Low price equal to or lower than the price specified in the title. Otherwise, this market will resolve to "No."\n\nThe resolution source for this market is Binance, specifically the BTC/USDT Low prices available at https://www.binance.com/en/trade/BTC_USDT, with the chart settings on "1m" for one-minute candles selected on the top bar.\n\nPlease note that the outcome of this market depends solely on the price data from the Binance BTC/USDT trading pair. Prices from other exchanges, different trading pairs, or spot markets will not be considered for the resolution of this market.';
export const solNoon = 'This market will resolve to "Yes" if the Binance 1 minute candle for SOL/USDT closing at 12:00 in the ET timezone (noon) on the date specified in the title has a final "Close" price higher than the price specified in the title. Otherwise, this market will resolve to "No".\n\nThe resolution source for this market is Binance, specifically the SOL/USDT "Close" prices currently available at https://www.binance.com/en/trade/SOL_USDT with "1m" and "Candles" selected on the top bar.\n\nPlease note that this market is about the price according to Binance SOL/USDT, not according to other exchanges or trading pairs.\n\nPrice precision is determined by the number of decimal places in the source.';

export interface ReviewEvidence {
  eventId: string; eventTitle: string; eventSlug: string;
  marketId: string; title: string; openTime: number; closeTime: number;
  provider: 'polymarket'; rulesPrimary: string; rulesSecondary: string;
  direction: 1 | -1; perpSymbol: string; note: string;
}

const btc: Array<[string, string, 1 | -1, string, number]> = [
  ['POLY-6051332', '\u2191 82,500', 1, btcHighCreation, 1792685828],
  ['POLY-5170739', '\u2193 77,500', -1, btcLowMonth, 1790831233],
  ['POLY-5170740', '\u2193 75,000', -1, btcLowMonth, 1790831233],
  ['POLY-5407561', '\u2191 85,000', 1, btcHighCreation, 1791389826],
  ['POLY-5170735', '\u2191 87,500', 1, btcHighMonth, 1790831233],
  ['POLY-5170741', '\u2193 72,500', -1, btcLowMonth, 1790831232],
  ['POLY-5170742', '\u2193 70,000', -1, btcLowMonth, 1790831233],
  ['POLY-5170734', '\u2191 90,000', 1, btcHighMonth, 1790831231],
  ['POLY-5170732', '\u2191 95,000', 1, btcHighMonth, 1790831233],
  ['POLY-5170733', '\u2191 92,500', 1, btcHighMonth, 1790831233]
];
const sol: Array<[string, string]> = [
  ['POLY-6084540', '80'], ['POLY-6084541', '85'], ['POLY-6084542', '90'],
  ['POLY-6084543', '95'], ['POLY-6084544', '100'], ['POLY-6084546', '105'],
  ['POLY-6084548', '110'], ['POLY-6084550', '115'], ['POLY-6084552', '120'],
  ['POLY-6084555', '125'], ['POLY-6084556', '130']
];
export const reviewedEvidence: ReviewEvidence[] = [
  ...btc.map(([marketId, title, direction, rulesPrimary, openTime]) => ({
    eventId: 'POLY-1112205', eventTitle: 'What price will Bitcoin hit in October?',
    eventSlug: 'what-price-will-bitcoin-hit-in-october-2026',
    marketId, title, direction, rulesPrimary, openTime, rulesSecondary: '',
    closeTime: 1793505600, provider: 'polymarket' as const, perpSymbol: 'BTC-PERP',
    note: `Rules read 2026-10-29: Binance BTC/USDT 1m ${direction === 1 ? 'High >= barrier' : 'Low <= barrier'}; ${rulesPrimary === btcHighCreation ? 'creation to month end, excluding earlier action' : 'full October ET window'}; single Polymarket contract. Velocity is contextual exposure, not the resolution source or a hedge guarantee.`
  })),
  ...sol.map(([marketId, title]) => ({
    eventId: 'POLY-1241190', eventTitle: 'Solana above ___ on October 30?',
    eventSlug: 'solana-above-on-october-30-2026', marketId, title,
    direction: 1 as const, rulesPrimary: solNoon, rulesSecondary: '',
    openTime: 1792771220, closeTime: 1793376000, provider: 'polymarket' as const, perpSymbol: 'SOL-PERP',
    note: 'Rules read 2026-10-29: Binance SOL/USDT 1m Close at noon ET October 30, 2026 must be strictly higher than the named threshold; equality is No; source precision applies. Single Polymarket contract; Velocity is contextual exposure, not the settlement oracle.'
  }))
];

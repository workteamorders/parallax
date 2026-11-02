import { reviewedEvidence } from './data/reviewed';
import { rulesHash } from './analytics';

export interface ReviewedTheme {
  marketId: string; slug: string; title: string; marketTitle: string; closeTime: number;
  rulesHash: string; direction: 1 | -1; perpSymbol: string | null;
  status: 'approved' | 'candidate' | 'rejected'; reason: string;
  openTime?: number;
}
// Individually retrieved /markets/{id} and read on 2026-10-29. These are separate
// contracts, not equivalent strikes, dates, venues, or forecasts of perp price.
export const reviewedAt = '2026-10-29';
export const manifest: ReviewedTheme[] = [
  { marketId: 'POLY-6051332', slug: 'btc-82500-october', title: 'Bitcoin touches $82,500 in October', marketTitle: '\u2191 82,500', closeTime: 1793505600,
    rulesHash: 'e1fcee0b71ebdd9f0c121e6bdd1606b451182269306146fc1e0338baa24821cb', direction: 1, perpSymbol: 'BTC-PERP', status: 'approved',
    reason: 'Binance BTC/USDT 1m High >= 82,500 after creation through October end, ET. Directional BTC research only; Velocity oracle is not the settlement source.' },
  { marketId: 'POLY-6044820', slug: 'btc-72000-oct29', title: 'Bitcoin above $72,000 at October 29 noon ET', marketTitle: '72,000', closeTime: 1793289600,
    rulesHash: '1c27bfa87e1c4896178339e781cc68a24f145471680748e7228d8eb84b533e39', direction: 1, perpSymbol: 'BTC-PERP', status: 'approved',
    reason: 'Strictly higher Binance BTC/USDT 1m Close at noon ET October 29. Not a touch contract; near-certain odds are not guaranteed outcomes.' },
  { marketId: 'POLY-1861376', slug: 'variational-fdv-100m', title: 'Variational FDV above $100M one day after launch', marketTitle: '$100M', closeTime: 1830315600,
    rulesHash: '070cd0f5f73d51e56144985097f0e59f3e8401061317417d3183b24ba9dfc081', direction: 1, perpSymbol: null, status: 'candidate',
    reason: 'FDV uses total supply times most liquid price at 4pm ET next calendar day; no launch by 2027 end means No. No discovered Velocity underlying; price source discretionary.' },
  { marketId: 'POLY-1393316', slug: 'predict-fun-fdv-50m', title: 'Predict.fun FDV above $50M one day after launch', marketTitle: '$50M', closeTime: 1830315600,
    rulesHash: '52f9f3bff9fa915e803689a86e44391166b4fc29cd9c9ee04f2d138e183a477c', direction: 1, perpSymbol: null, status: 'candidate',
    reason: 'Public transferability required; FDV at 4pm ET next calendar day; no launch by December 2027 means No. No direct perp; not mapped to unrelated SOL.' },
  { marketId: 'POLY-1345531', slug: 'btc-90000-2026', title: 'Bitcoin touches $90,000 in 2026', marketTitle: '\u2191 90,000', closeTime: 1798779600,
    rulesHash: '5d3dff03a3dad0c0013fa010afd973c071942757238615596b10fb00b03e05b8', direction: 1, perpSymbol: 'BTC-PERP', status: 'approved',
    reason: 'Binance BTC/USDT 1m High >= 90,000 after creation through December 31 ET. Path-dependent touch, not year-end spot price.' },
  { marketId: 'POLY-6236213', slug: 'btc-82000-oct26-nov1', title: 'Bitcoin touches $82,000 October 26-November 1', marketTitle: '\u2191 82,000', closeTime: 1793595600,
    rulesHash: '8197538ae4c0579db9fdbcede18b0b01ac02430349365c489213bc477d363c6d', direction: 1, perpSymbol: 'BTC-PERP', status: 'approved',
    reason: 'Binance BTC/USDT 1m High >= 82,000 within the named ET date range. Not equivalent to October-only or annual contracts.' },
  { marketId: 'POLY-5786291', slug: '1win-commitments-10m', title: '1win public sale commitments exceed $10M', marketTitle: '$10M', closeTime: 1793681940,
    rulesHash: 'f79c2e65d78a2eb5411f6312f5cbc1c9c27f6a873508bb4d92623ab037408cee', direction: 1, perpSymbol: null, status: 'candidate',
    reason: 'Gross commitments, not allocated funds; strictly exceeds $10M before November 2 ET, refunds do not reverse Yes. Official page then reporting fallback; no matching perp.' },
  { marketId: 'POLY-5611739', slug: 'sol-110-october', title: 'Solana touches $110 in October', marketTitle: '\u2191 110', closeTime: 1793505600,
    rulesHash: '3190345bc29d941fd6d7fbabad3453710c392f64ea23cfcd959e378a560d725f', direction: 1, perpSymbol: 'SOL-PERP', status: 'approved',
    reason: 'Binance SOL/USDT 1m High >= 110 after creation through October end ET; excludes earlier price action. SOL relationship only, no cross-venue equivalence.' },
  { marketId: 'POLY-3866001', slug: 'sol-90-down-2026', title: 'Solana touches $90 or lower in 2026', marketTitle: '\u2193 90', closeTime: 1798779600,
    rulesHash: '43cbd72ab7480e7e32e3703bdfba829013d050581c94b4130790aa54f32f3bc8', direction: -1, perpSymbol: 'SOL-PERP', status: 'approved',
    reason: 'Down-arrow strike uses Binance SOL/USDT 1m Low <= 90 after creation through year-end ET. Direction -1 orients No to bullish SOL; not identical to an upside touch.' },
  { marketId: 'POLY-6044806', slug: 'btc-80k-82k-oct29', title: 'Bitcoin between $80,000 and $82,000 October 29 noon ET', marketTitle: '80,000-82,000', closeTime: 1793289600,
    rulesHash: '32122e270f1741fafae995053b22eeb35c7af5dcc9e64f9ddbfd9265ae33f3e1', direction: 1, perpSymbol: null, status: 'candidate',
    reason: 'Binance noon ET 1m Close, boundary belongs to higher bracket. Bounded interval is non-monotonic in BTC; no defensible single long/short direction.' },
  { marketId: 'POLY-3750519', slug: 'sol-150-2027', title: 'Solana touches $150 by December 31, 2027', marketTitle: 'by December 31, 2027', closeTime: 1830315600,
    rulesHash: '4bc7010e46e92353674b681743095bdd736129491fdd60131d47cf08a4f9757e', direction: 1, perpSymbol: 'SOL-PERP', status: 'approved',
    reason: 'Binance SOL/USDT 1m High >= 150 after creation through 2027 end ET. Long horizon and path-dependence retained; no hedge-ratio claim.' },
  { marketId: 'POLY-6084516', slug: 'btc-72000-oct30', title: 'Bitcoin above $72,000 at October 30 noon ET', marketTitle: '72,000', closeTime: 1793376000,
    rulesHash: '1c27bfa87e1c4896178339e781cc68a24f145471680748e7228d8eb84b533e39', direction: 1, perpSymbol: 'BTC-PERP', status: 'approved',
    reason: 'Strictly higher Binance BTC/USDT 1m Close at noon ET October 30. Same template as October 29 but distinct expiry; never pooled as equivalent.' },
  { marketId: 'POLY-6341812-0', slug: 'btc-up-oct29-0915', title: 'Bitcoin Up October 29 9:15-9:30 AM ET', marketTitle: 'Up', closeTime: 1793280600,
    rulesHash: '485ceb1dabc4aa12fb42c76184563b7378f01e5de9ded73df049c0d191cd5ad1', direction: 1, perpSymbol: null, status: 'rejected',
    reason: 'Single-market endpoint already closed during review despite open discovery listing. Chainlink TWAP >= starting price, not Binance; excluded from live set.' },
  { marketId: 'POLY-6342854-0', slug: 'btc-up-oct29-0925', title: 'Bitcoin Up October 29 9:25-9:30 AM ET', marketTitle: 'Up', closeTime: 1793280600,
    rulesHash: '485ceb1dabc4aa12fb42c76184563b7378f01e5de9ded73df049c0d191cd5ad1', direction: 1, perpSymbol: null, status: 'rejected',
    reason: 'Already closed at detail review. Chainlink BTC/USD TWAP, five-minute range. Stale discovery status is not evidence of an executable market.' },
  { marketId: 'POLY-6342863-0', slug: 'btc-up-oct29-0930', title: 'Bitcoin Up October 29 9:30-9:35 AM ET', marketTitle: 'Up', closeTime: 1793280900,
    rulesHash: '485ceb1dabc4aa12fb42c76184563b7378f01e5de9ded73df049c0d191cd5ad1', direction: 1, perpSymbol: null, status: 'rejected',
    reason: 'Already closed at single-market review; zero/one prices must not appear as live executable quotes. Chainlink TWAP resolution.' },
  { marketId: 'POLY-6139608', slug: 'eth-2400-october', title: 'Ethereum touches $2,400 in October', marketTitle: '\u2191 2,400', closeTime: 1793505600,
    rulesHash: '5c83d7cb71c889a65bfa578375aab79c25986926cef87962efded743c5305a1a', direction: 1, perpSymbol: 'ETH-PERP', status: 'approved',
    reason: 'Binance ETH/USDT 1m High >= 2,400 after creation through October end ET. Research pairing to ETH only; Velocity mark cannot settle this contract.' },
  { marketId: 'POLY-1571986', slug: 'predict-token-march2027', title: 'Predict.fun governance token by March 31, 2027', marketTitle: 'March 31, 2027', closeTime: 1806551940,
    rulesHash: '4a0e92c17e05a0f30310055aef4418ec18809d88943b31818569b31657646a62', direction: 1, perpSymbol: null, status: 'candidate',
    reason: 'Official launch must be publicly transferable and tradable by deadline ET; announcement insufficient. Reporting fallback and no discovered matching perp.' },
  { marketId: 'POLY-1163699', slug: 'clarity-act-2026', title: 'Clarity Act signed into law in 2026', marketTitle: 'Yes', closeTime: 1798779600,
    rulesHash: 'e03ed5793a358e945e740a762479bbb0a7cc1e0e755c76cfa0564191f5788fb2', direction: 1, perpSymbol: null, status: 'candidate',
    reason: 'H.R.3633 passage by both chambers plus presidential signature by year-end ET; Congress.gov primary. Broad crypto narrative is not a verified BTC or SOL mapping.' },
  { marketId: 'POLY-6341819-0', slug: 'hype-up-oct29-0915', title: 'Hyperliquid Up October 29 9:15-9:30 AM ET', marketTitle: 'Up', closeTime: 1793280600,
    rulesHash: '34ad9263772de270ccb0987cd63a9ca17ec5e9192411704d9f834d8aefe360e2', direction: 1, perpSymbol: null, status: 'rejected',
    reason: 'Closed on detail endpoint despite active event listing. Chainlink HYPE/USD TWAP source; rejected rather than representing a current HYPE signal.' },
  { marketId: 'POLY-2325361', slug: 'hylo-token-2027', title: 'Hylo governance token by December 31, 2027', marketTitle: 'December 31, 2027', closeTime: 1830315600,
    rulesHash: 'acf74cb354bcdaef2556df28178f0103e29e9db51a9bb96b8a8dd113f157e5e0', direction: 1, perpSymbol: null, status: 'candidate',
    reason: 'Publicly transferable tradable token required, announcements insufficient; official Hylo then reporting. No discovered matching perp, not proxied to SOL.' },
  { marketId: 'POLY-5170739', slug: 'btc-77500-down-october', title: 'Bitcoin touches $77,500 or lower in October', marketTitle: '\u2193 77,500', closeTime: 1793505600,
    rulesHash: 'cfe2e3a46d1ee67cd31eb13f15bf0a86309f62c0205e120946989fc5681054b7', direction: -1, perpSymbol: 'BTC-PERP', status: 'approved',
    reason: 'Binance BTC/USDT 1m Low <= 77,500 over entire October ET; unlike upside contracts this starts at month start, not creation. No orientation used for bullish BTC.' },
  { marketId: 'POLY-3866002', slug: 'sol-80-down-2026', title: 'Solana touches $80 or lower in 2026', marketTitle: '\u2193 80', closeTime: 1798779600,
    rulesHash: '43cbd72ab7480e7e32e3703bdfba829013d050581c94b4130790aa54f32f3bc8', direction: -1, perpSymbol: 'SOL-PERP', status: 'approved',
    reason: 'Binance SOL/USDT 1m Low <= 80 after creation through year-end ET; distinct strike from $90 even though rules template hash matches. No orients bullish.' },
  { marketId: 'POLY-5170789', slug: 'eth-2200-down-october', title: 'Ethereum touches $2,200 or lower in October', marketTitle: '\u2193 2,200', closeTime: 1793505600,
    rulesHash: 'e01415a66b2707e820e0a9eca726a745d8f0394bb7adfc1cb2e4abb2b086c682', direction: -1, perpSymbol: 'ETH-PERP', status: 'approved',
    reason: 'Binance ETH/USDT 1m Low <= 2,200 during all October ET. Downside touch, not terminal close; No orientation keeps comparison bullish.' },
  { marketId: 'POLY-6236215', slug: 'btc-78000-down-oct26-nov1', title: 'Bitcoin touches $78,000 or lower October 26-November 1', marketTitle: '\u2193 78,000', closeTime: 1793595600,
    rulesHash: 'f49e450fd5cfffc467e6f69127dd9966ab3ef9d77269354aa903bcc34a3a7510', direction: -1, perpSymbol: 'BTC-PERP', status: 'approved',
    reason: 'Binance BTC/USDT 1m Low <= 78,000 within named ET date range. Distinct from monthly $77,500 strike and expiry; No orientation, no equivalence claim.' },
];

// Additional evidence was individually re-fetched and rules read on 2026-10-29.
// Quote data is always fetched live; these strings only attest the review.
for (const e of reviewedEvidence) {
  const existing = manifest.find(m => m.marketId === e.marketId);
  if (existing) { existing.openTime = e.openTime; continue; }
  manifest.push({ marketId: e.marketId, slug: `${e.eventSlug}-${e.marketId.toLowerCase()}`,
    title: `${e.eventTitle}: ${e.title}`, marketTitle: e.title, closeTime: e.closeTime, openTime: e.openTime,
    rulesHash: rulesHash([e.rulesPrimary, e.rulesSecondary].filter(Boolean).join('\n\n')),
    direction: e.direction, perpSymbol: e.perpSymbol, status: 'approved',
    reason: `${e.note} Individually verified again against the single-market endpoint; not pooled with other strikes.` });
}

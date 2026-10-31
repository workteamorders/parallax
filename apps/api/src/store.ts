import type { Perp, PredictionMarket, TerminalData, Theme, ThemeHistory, VenueHealth } from '@parallax/shared';
import { pool, redis } from './db.js';
import { trading } from './config.js';

export function marketKey(m: PredictionMarket): string { return `${m.venue}:${m.venueMarketId}`; }
export async function saveMarket(m: PredictionMarket): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO markets(id,venue,venue_market_id,data,updated_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(id) DO UPDATE SET data=$4,updated_at=$5`, [marketKey(m), m.venue, m.venueMarketId, m, m.capturedAt]);
    await client.query(`INSERT INTO market_snapshots(market_id,captured_at,yes_bid,yes_ask,yes_mid,volume_24h,data)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [marketKey(m), m.capturedAt, m.yesBid, m.yesAsk, m.yesMid, m.volume24h, m]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export async function savePerps(perps: Perp[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of perps) {
      await client.query(`INSERT INTO perp_markets(symbol,data,updated_at) VALUES($1,$2,$3) ON CONFLICT(symbol) DO UPDATE SET data=$2,updated_at=$3`, [p.symbol, p, p.capturedAt]);
      await client.query(`INSERT INTO perp_snapshots(symbol,captured_at,mark,oracle,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [p.symbol, p.capturedAt, p.mark, p.oracle, p]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export async function saveHealth(health: VenueHealth): Promise<void> {
  await pool.query('INSERT INTO venue_health(venue,data) VALUES($1,$2) ON CONFLICT(venue) DO UPDATE SET data=$2', [health.venue, health]);
}
export async function loadThemes(): Promise<Theme[]> {
  const { rows } = await pool.query(`SELECT t.*, COALESCE(jsonb_agg(m.data ORDER BY m.id) FILTER(WHERE m.id IS NOT NULL),'[]') AS markets
    FROM themes t LEFT JOIN theme_markets tm ON tm.theme_id=t.id LEFT JOIN markets m ON m.id=tm.market_id
    GROUP BY t.id ORDER BY CASE t.review_status WHEN 'approved' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END,t.slug`);
  return rows.map(r => ({ id: r.id, slug: r.slug, title: r.title, description: r.description, tags: r.tags,
    direction: r.direction, reviewStatus: r.review_status, markets: r.markets, perpSymbol: r.perp_symbol,
    volume24h: null, confidence: r.confidence, reviewNote: r.review_note }));
}
export function applyTerminalFreshness(data: TerminalData, now = Date.now()): TerminalData {
  const fresh = (timestamp: string) => Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) <= now && now - Date.parse(timestamp) <= 5 * 60000;
  return { ...data, themes: data.themes.map(theme => ({ ...theme, markets: theme.markets.map(m => {
    const open = m.closeTime === null || (Number.isFinite(Date.parse(m.closeTime)) && Date.parse(m.closeTime) > now);
    return fresh(m.capturedAt) && open && theme.reviewStatus !== 'rejected' ? m : { ...m, yesBid: null, yesAsk: null, yesMid: null };
  }) })), health: data.health.map(h => fresh(h.checkedAt) ? h : { ...h, status: 'degraded',
    message: h.message.startsWith('Stale health check: ') ? h.message : `Stale health check: ${h.message}` }) };
}
export async function terminalData(): Promise<TerminalData> {
  const [themes, perps, signals, health, state] = await Promise.all([
    loadThemes(), pool.query('SELECT data FROM perp_markets ORDER BY symbol'),
    pool.query(`SELECT id,theme_id AS "themeId",type,created_at AS "createdAt",payload FROM signals WHERE created_at > now()-interval '24 hours' ORDER BY created_at DESC LIMIT 100`),
    pool.query('SELECT data FROM venue_health ORDER BY venue'), pool.query("SELECT captured_at FROM worker_state WHERE id='ingestion'"),
  ]);
  const checkedAt = new Date().toISOString();
  const venues: VenueHealth[] = health.rows.map(r => r.data);
  for (const venue of ['velocity', 'polymarket', 'kalshi', 'jupiter']) {
    if (!venues.some(h => h.venue === venue)) venues.push({ venue, status: 'unavailable', message: 'No successful ingestion yet; run seed and worker.', checkedAt });
  }
  return applyTerminalFreshness({ themes, perps: perps.rows.map(r => r.data), signals: signals.rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
    health: venues, capturedAt: state.rows[0]?.captured_at.toISOString() ?? checkedAt, trading });
}
export async function history(slug: string): Promise<ThemeHistory | null> {
  const { rows } = await pool.query('SELECT id,direction,perp_symbol FROM themes WHERE slug=$1', [slug]);
  const theme = rows[0];
  if (!theme) return null;
  // Multi-contract history needs reviewed, time-aligned liquidity weights.
  // Suppress it until supported rather than silently inventing equal weights.
  const [probability, perp] = await Promise.all([
    pool.query(`SELECT extract(epoch from s.captured_at)::float8 AS ts, s.yes_mid AS value
      FROM market_snapshots s JOIN theme_markets tm ON tm.market_id=s.market_id
      WHERE tm.theme_id=$1 AND s.yes_mid IS NOT NULL AND s.captured_at >= now()-interval '7 days'
        AND (SELECT count(*) FROM theme_markets WHERE theme_id=$1)=1
      ORDER BY s.captured_at`, [theme.id]),
    pool.query(`SELECT extract(epoch from captured_at)::float8 AS ts,mark AS value FROM perp_snapshots
      WHERE symbol=$1 AND captured_at >= now()-interval '7 days' ORDER BY captured_at`, [theme.perp_symbol]),
  ]);
  return { probability: probability.rows.map(r => ({ ts: r.ts, value: theme.direction === -1 ? 1 - r.value : r.value })), perp: perp.rows };
}
export async function invalidateTerminal(): Promise<void> {
  await redis.del('parallax:terminal');
  await redis.publish('parallax:feed', JSON.stringify({ type: 'update', capturedAt: new Date().toISOString() }));
}

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { pool, redis, migrate, closeConnections } from './db.js';
import { fetchMarket, providerJson, jupiterEventsSchema } from './providers.js';
import { manifest, reviewedAt } from './theme-manifest.js';
import { rulesHash, rulesDiff } from './analytics.js';
import { invalidateTerminal, marketKey, saveMarket } from './store.js';

export async function seedThemes(): Promise<void> {
  const token = randomUUID();
  if (!await redis.set('parallax:ingestion-lock', token, 'PX', 300000, 'NX')) throw new Error('Another seed or ingestion is active; retry after it finishes');
  const renewal = setInterval(() => {
    void redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],300000) else return 0 end", 1, 'parallax:ingestion-lock', token).catch(() => {});
  }, 60000);
  let failures = 0;
  try {
    for (const entry of manifest) {
      try {
        const { raw, market } = await fetchMarket(entry.marketId);
        if (!market) throw new Error('Unverified provider provenance');
        const hash = rulesHash(market.rules);
        const matches = hash === entry.rulesHash && raw.title === entry.marketTitle && raw.closeTime === entry.closeTime && (entry.openTime === undefined || raw.openTime === entry.openTime);
        const active = raw.status === 'open' && raw.closeTime * 1000 > Date.now();
        const status = entry.status === 'rejected' ? 'rejected' : matches && active ? entry.status : 'candidate';
        const note = `${entry.reason} Reviewed ${reviewedAt}. ${!matches ? 'RULES/STRIKE/EXPIRY CHANGED: re-review required. ' : ''}${!active ? 'No longer open; excluded from signals. ' : ''}`;
        if (!active) market.yesAsk = market.yesBid = market.yesMid = null;
        await saveMarket(market);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const inserted = await client.query(`INSERT INTO themes(id,slug,title,description,tags,direction,review_status,perp_symbol,confidence,review_note)
            VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING id`,
          [entry.slug, entry.title, 'Individually reviewed prediction contract. A directional research relationship is not settlement equivalence or a hedge.',
            ['crypto', entry.perpSymbol?.split('-')[0]?.toLowerCase() ?? 'unmapped'], entry.direction, status,
            entry.perpSymbol, status === 'approved' ? 0.8 : 0.15, note]);
          await client.query('INSERT INTO theme_markets(theme_id,market_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [entry.slug, marketKey(market)]);
          if (inserted.rowCount) {
            await client.query(`INSERT INTO theme_reviews(theme_id,reviewer,status,reason,rules_hash) VALUES($1,$2,$3,$4,$5)`,
              [entry.slug, `manifest:${reviewedAt}`, status, note, hash]);
          } else if (!matches || !active) {
            // Seeding is idempotent and must not overwrite an operator's review.
            await client.query(`UPDATE themes SET review_status=CASE WHEN review_status='rejected' THEN 'rejected' ELSE 'candidate' END,
              review_note=$2,confidence=0.15,updated_at=now() WHERE id=$1`, [entry.slug, note]);
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
        console.log(JSON.stringify({ slug: entry.slug, status, provider: raw.provider, rulesHash: hash, active }));
      } catch {
        failures++;
        console.error(JSON.stringify({ marketId: entry.marketId, error: 'Seed failed; no substitute data created' }));
      }
    }
    await invalidateTerminal();
  } finally {
    clearInterval(renewal);
    await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, 'parallax:ingestion-lock', token);
  }
  if (failures) throw new Error(`${failures} markets failed to seed; rerun to retry missing entries`);
}

export async function runReview(): Promise<void> {
  await migrate();
  const [command = 'list', ...args] = process.argv.slice(2);
  if (command === 'seed') return seedThemes();
  if (command === 'discover') {
    const provider = z.enum(['polymarket', 'kalshi']).parse(args[0] ?? 'polymarket');
    const result = jupiterEventsSchema.parse(await providerJson('jupiter', `/events?provider=${provider}&filter=trending&includeMarkets=true&category=crypto&start=0&end=20`));
    console.log(JSON.stringify(result.data.map(e => ({ eventId: e.eventId, title: e.metadata?.title,
      markets: e.markets.map(m => ({ id: m.marketId, title: m.title, provider: m.provider, status: m.status })) })), null, 2));
    return;
  }
  if (command === 'inspect') {
    const id = z.string().min(1).max(200).parse(args[0]);
    const { raw, market } = await fetchMarket(id);
    const previous = await pool.query('SELECT data FROM markets WHERE venue_market_id=$1 AND venue=$2', [id, market?.venue ?? '']);
    console.log(JSON.stringify({ ...raw, normalized: market, rulesHash: market && rulesHash(market.rules),
      rulesDiff: market && previous.rows[0] ? rulesDiff(previous.rows[0].data, market) : null }, null, 2));
    return;
  }
  if (command === 'decide') {
    const slug = z.string().regex(/^[a-z0-9-]{1,120}$/).parse(args[0]);
    const status = z.enum(['approved', 'candidate', 'rejected']).parse(args[1]);
    const reviewer = z.string().min(2).max(100).parse(args[2]);
    const reason = z.string().min(20).max(3000).parse(args.slice(3).join(' '));
    const { rows } = await pool.query(`SELECT t.*,m.data FROM themes t JOIN theme_markets tm ON t.id=tm.theme_id JOIN markets m ON m.id=tm.market_id WHERE t.slug=$1`, [slug]);
    const row = rows[0];
    if (rows.length !== 1 || !row) throw new Error('Review requires exactly one contract; multi-market equivalence needs an explicit manifest change');
    const { raw, market } = await fetchMarket(row.data.venueMarketId);
    if (!market || !market.rules || (status === 'approved' && (!row.perp_symbol || raw.status !== 'open' || raw.closeTime * 1000 <= Date.now()))) throw new Error('Cannot approve without current rules, an open market and a mapped perp');
    if (rulesHash(market.rules) !== rulesHash(row.data.rules) || market.title !== row.data.title || market.closeTime !== row.data.closeTime) throw new Error('Contract changed since inspection; seed and inspect again before deciding');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE themes SET review_status=$2,review_note=$3,confidence=$4,updated_at=now() WHERE id=$1', [row.id, status, reason, status === 'approved' ? 0.8 : 0.15]);
      await client.query('INSERT INTO theme_reviews(theme_id,reviewer,status,reason,rules_hash) VALUES($1,$2,$3,$4,$5)', [row.id, reviewer, status, reason, rulesHash(market.rules)]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    await invalidateTerminal();
    console.log(JSON.stringify({ slug, status, reviewer, reason }));
    return;
  }
  if (command !== 'list') throw new Error('Commands: seed | list | discover [provider] | inspect <id> | decide <slug> <status> <reviewer> <reason>');
  const { rows } = await pool.query('SELECT slug,review_status,review_note FROM themes ORDER BY slug');
  console.log(JSON.stringify(rows, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReview().catch(() => { console.error('Review command failed. Check services, arguments and provider availability.'); process.exitCode = 1; }).finally(closeConnections);
}

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { pool, redis, migrate, closeConnections } from './db.js';
import { config } from './config.js';
import { fetchMarket, fetchPerps, providerJson, jupiterEventsSchema, probeDirectSources } from './providers.js';
import { history, invalidateTerminal, loadThemes, saveHealth, saveMarket, savePerps } from './store.js';
import { divergence, rulesHash } from './analytics.js';
import { manifest } from './theme-manifest.js';

export async function ingest(): Promise<boolean> {
  const token = randomUUID();
  if (!await redis.set('parallax:ingestion-lock', token, 'PX', 300000, 'NX')) return false;
  const renewal = setInterval(() => {
    void redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],300000) else return 0 end", 1, 'parallax:ingestion-lock', token).catch(() => {});
  }, 60000);
  try {
    try {
      const perps = await fetchPerps();
      if (!perps.length) throw new Error('Empty discovery');
      await savePerps(perps);
      await saveHealth({ venue: 'velocity', status: 'healthy', message: `${perps.length} active perps; human-decimal prices; funding units undocumented, no annualization.`, checkedAt: new Date().toISOString() });
    } catch {
      await saveHealth({ venue: 'velocity', status: 'unavailable', message: 'Live discovery unavailable. Last actual samples retained with original timestamps.', checkedAt: new Date().toISOString() });
    }
    let successes = 0, failures = 0;
    const themes = await loadThemes();
    for (const theme of themes) {
      if (theme.reviewStatus === 'rejected') continue;
      for (const old of theme.markets) {
        // Expired contracts are not polled indefinitely, nor represented as live quotes.
        if (old.closeTime && Date.parse(old.closeTime) <= Date.now()) {
          await pool.query(`UPDATE themes SET review_status='candidate',review_note='Expired contract; no live signal. ' || review_note,updated_at=now() WHERE id=$1 AND review_status='approved'`, [theme.id]);
          await pool.query(`UPDATE markets SET data=data || '{"yesBid":null,"yesAsk":null,"yesMid":null}'::jsonb
            WHERE id=$1`, [`${old.venue}:${old.venueMarketId}`]);
          continue;
        }
        try {
          const { raw, market } = await fetchMarket(old.venueMarketId);
          if (!market) throw new Error('Unknown provider');
          const expected = manifest.find(entry => entry.marketId === raw.marketId);
          const changed = rulesHash(old.rules) !== rulesHash(market.rules) || old.title !== market.title || old.closeTime !== market.closeTime || old.venue !== market.venue
            || (expected?.openTime !== undefined && raw.openTime !== expected.openTime);
          if (changed || (raw.status !== 'open' && theme.reviewStatus === 'approved')) {
            await pool.query(`UPDATE themes SET review_status='candidate',confidence=0.15,review_note=$2,updated_at=now() WHERE id=$1`, [theme.id, `${changed ? 'Contract rules, strike, expiry or provider changed; re-review required.' : 'Contract no longer open.'} Previous review: ${theme.reviewNote}`]);
          }
          if (raw.status !== 'open') market.yesAsk = market.yesBid = market.yesMid = null;
          await saveMarket(market);
          successes++;
        } catch { failures++; }
      }
    }
    const checkedAt = new Date().toISOString();
    await saveHealth({ venue: 'jupiter', status: successes ? failures ? 'degraded' : 'healthy' : 'unavailable',
      message: `${successes} detail updates, ${failures} failures; keyless requests spaced >=2.2s. Transport only, not an independent venue.`, checkedAt });
    const direct = await probeDirectSources();
    for (const result of direct) await saveHealth(result);
    await saveHealth({ venue: 'polymarket', status: successes ? failures ? 'degraded' : 'healthy' : 'unavailable',
      message: `${successes} actual detail updates via Jupiter, with Polymarket provenance. Direct connectivity is reported separately under gamma. Execution OFF; no cross-venue equivalence claimed.`, checkedAt });
    // Probe the documented provider filter, without guessing that gx means Kalshi.
    try {
      const result = jupiterEventsSchema.parse(await providerJson('jupiter', '/events?provider=kalshi&filter=trending&includeMarkets=true&category=crypto&start=0&end=2'));
      const kalshi = result.data.flatMap(e => e.markets).filter(m => m.provider === 'kalshi');
      const available = direct.some(h => h.venue.startsWith('kalshi-') && h.status === 'healthy');
      await saveHealth({ venue: 'kalshi', status: kalshi.length || available ? 'degraded' : 'unavailable',
        message: `${available ? 'Direct public API available' : 'Direct public probes unavailable'} (elections: ${direct.find(h => h.venue === 'kalshi-elections')?.status}, external-api: ${direct.find(h => h.venue === 'kalshi-external')?.status}). Jupiter crypto filter returned ${kalshi.length} verified Kalshi market(s); no independently reviewed Kalshi mapping is seeded. Read-only; gx excluded.`, checkedAt: new Date().toISOString() });
    } catch {
      await saveHealth({ venue: 'kalshi', status: 'unavailable', message: 'Read-only provider discovery unavailable; no synthetic or relabelled Kalshi quotes.', checkedAt: new Date().toISOString() });
    }
    for (const theme of await loadThemes()) {
      if (theme.reviewStatus !== 'approved' || !theme.perpSymbol || theme.markets.length !== 1) continue;
      const data = await history(theme.slug);
      if (!data) continue;
      let i = 0;
      const paired = data.probability.flatMap(p => {
        // Backward-only as-of join, never a future price or interpolation.
        while (i + 1 < data.perp.length && data.perp[i + 1]!.ts <= p.ts) i++;
        const r = data.perp[i];
        return r && r.ts <= p.ts && p.ts - r.ts <= 300 ? [{ ts: p.ts * 1000, probability: p.value, perp: r.value }] : [];
      });
      const signal = divergence(theme.id, paired, Date.now(), { windowMinutes: config.SIGNAL_WINDOW_MINUTES,
        zThreshold: config.SIGNAL_Z_THRESHOLD, followThreshold: config.SIGNAL_FOLLOW_THRESHOLD, minCount: config.SIGNAL_MIN_COUNT });
      if (signal) await pool.query('INSERT INTO signals(id,theme_id,type,created_at,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [signal.id, signal.themeId, signal.type, signal.createdAt, signal.payload]);
    }
    // In-app threshold notices, at most once/hour per alert. No Telegram call or
    // token is needed, and stale, rejected or multi-contract themes cannot fire.
    await pool.query(`INSERT INTO alert_deliveries(alert_id,status,reason)
      SELECT a.id,'in-app',json_build_object('probability',CASE WHEN t.direction=-1 THEN 1-(m.data->>'yesMid')::float8 ELSE (m.data->>'yesMid')::float8 END,
        'threshold',a.threshold,'capturedAt',m.data->>'capturedAt','themeId',t.id)::text
      FROM alerts a JOIN themes t ON t.id=a.theme_id JOIN theme_markets tm ON tm.theme_id=t.id JOIN markets m ON m.id=tm.market_id
      WHERE a.enabled AND t.review_status!='rejected' AND m.data->>'yesMid' IS NOT NULL
        AND (m.data->>'capturedAt')::timestamptz > now()-interval '5 minutes'
        AND (m.data->>'closeTime')::timestamptz > now()
        AND (SELECT count(*) FROM theme_markets WHERE theme_id=t.id)=1
        AND CASE WHEN t.direction=-1 THEN 1-(m.data->>'yesMid')::float8 ELSE (m.data->>'yesMid')::float8 END >= a.threshold
        AND NOT EXISTS(SELECT 1 FROM alert_deliveries d WHERE d.alert_id=a.id AND d.created_at>now()-interval '1 hour')`);
    await pool.query("INSERT INTO worker_state(id,captured_at) VALUES('ingestion',now()) ON CONFLICT(id) DO UPDATE SET captured_at=now()");
    await pool.query("DELETE FROM auth_nonces WHERE expires_at < now()-interval '1 day'");
    await pool.query('DELETE FROM sessions WHERE expires_at < now()');
    await invalidateTerminal();
    return true;
  } finally {
    clearInterval(renewal);
    await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, 'parallax:ingestion-lock', token);
  }
}

async function main(): Promise<void> {
  await migrate();
  let stopped = false;
  process.once('SIGTERM', () => { stopped = true; });
  process.once('SIGINT', () => { stopped = true; });
  while (!stopped) {
    try { console.log(JSON.stringify({ event: 'ingestion', acquired: await ingest(), at: new Date().toISOString() })); }
    catch { console.error('Ingestion failed; real samples retained, no placeholder data inserted.'); }
    if (process.argv.includes('--once') || stopped) break;
    for (let elapsed = 0; elapsed < config.WORKER_INTERVAL_MS && !stopped; elapsed += 1000) await new Promise(r => setTimeout(r, 1000));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Worker startup failed. Verify PostgreSQL and Redis availability.'); process.exitCode = 1; }).finally(closeConnections);
}

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { WebSocket } from 'ws';
import { config, trading, geoDecision } from './config.js';
import { pool, redis, closeConnections } from './db.js';
import { terminalData, history, applyTerminalFreshness } from './store.js';
import { parseCandles, providerJson } from './providers.js';
import { authRoutes, requireOrigin, sessionWallet } from './auth.js';
import { runtime } from './runtime.js';

const slugSchema = z.string().regex(/^[a-z0-9-]{1,120}$/);
const themeIdSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9:_-]+$/);
const empty = z.object({}).strict();

export async function buildApp(options: { logger?: boolean; subscribe?: boolean } = {}) {
  const app = Fastify({
    bodyLimit: 16384, trustProxy: false,
    logger: options.logger === false ? false : {
      level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'body', 'signature', 'nonce', 'token'],
      serializers: { req: req => ({ method: req.method, path: req.url?.split('?')[0] }) },
    },
  });
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['content-type'] });
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: req => req.method === 'GET' ? 600 : 120,
    timeWindow: '1 minute', redis,
    keyGenerator: req => `${req.ip}:${req.method === 'GET' ? 'read' : 'write'}`,
    nameSpace: 'parallax:ratelimit:',
  });
  await app.register(websocket, { options: { maxPayload: 1024 } });
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.origin && req.headers.origin !== config.WEB_ORIGIN) return reply.code(403).send({ error: 'Origin not allowed' });
    reply.header('Cache-Control', 'no-store');
  });
  app.addHook('preValidation', async req => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') empty.parse(req.query);
    if (req.method === 'DELETE') empty.parse(req.body ?? {});
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', fields: error.issues.map(i => i.path.join('.')) });
    if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) return reply.code(error.statusCode).send({ error: 'Request rejected' });
    app.log.error({ event: 'request_failed' }, 'Request failed; sensitive upstream or database detail omitted');
    return reply.code(503).send({ error: 'Service temporarily unavailable' });
  });
  app.get('/health', async (req, reply) => {
    empty.parse(req.query);
    const checks = await Promise.allSettled([pool.query('SELECT 1'), redis.ping()]);
    const worker = await pool.query("SELECT captured_at FROM worker_state WHERE id='ingestion'").catch(() => ({ rows: [] }));
    const venueHealth = await pool.query('SELECT data FROM venue_health').catch(() => ({ rows: [] }));
    const capturedAt = worker.rows[0]?.captured_at?.toISOString() ?? null;
    const fresh = capturedAt && Date.now() - Date.parse(capturedAt) < 5 * 60000;
    const infrastructure = checks.every(c => c.status === 'fulfilled');
    const coreData = ['velocity', 'jupiter'].every(venue => venueHealth.rows.some(r => r.data.venue === venue && r.data.status === 'healthy' && Date.now() - Date.parse(r.data.checkedAt) < 5 * 60000));
    if (!infrastructure) reply.code(503);
    return { status: infrastructure && fresh && coreData ? 'healthy' : 'degraded', postgres: checks[0]?.status === 'fulfilled', redis: checks[1]?.status === 'fulfilled',
      worker: { capturedAt, fresh: Boolean(fresh) }, trading, telegram: { enabled: false, reason: 'No Telegram transport configured; in-app alerts only' } };
  });
  app.get('/terminal', async req => {
    empty.parse(req.query);
    const cached = await redis.get('parallax:terminal').catch(() => null);
    if (cached) return applyTerminalFreshness(JSON.parse(cached));
    const data = await terminalData();
    await redis.set('parallax:terminal', JSON.stringify(data), 'EX', 5).catch(() => {});
    return data;
  });
  app.get('/candles', async (req, reply) => {
    const query = z.object({ symbol: z.string().regex(/^[A-Z0-9]+-PERP$/).max(30),
      resolution: z.enum(['1', '5', '15', '60', '240', 'D', 'W', 'M']).default('60'),
      limit: z.coerce.number().int().min(1).max(500).default(48) }).strict().parse(req.query);
    const known = await pool.query('SELECT 1 FROM perp_markets WHERE symbol=$1 AND updated_at>now()-interval \'1 day\'', [query.symbol]);
    if (!known.rowCount) return reply.code(400).send({ error: 'Symbol not present in current Velocity discovery' });
    const key = `parallax:candles:${query.symbol}:${query.resolution}:${query.limit}`;
    const cached = await redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);
    const data = { candles: parseCandles(await providerJson('velocity', `/market/${encodeURIComponent(query.symbol)}/candles/${query.resolution}?limit=${query.limit}`)) };
    await redis.set(key, JSON.stringify(data), 'EX', 30).catch(() => {});
    return data;
  });
  app.get('/themes/:slug/history', async (req, reply) => {
    empty.parse(req.query);
    const { slug } = z.object({ slug: slugSchema }).strict().parse(req.params);
    const data = await history(slug);
    return data ?? reply.code(404).send({ error: 'Theme not found' });
  });
  await authRoutes(app);
  app.get('/watchlist', async (req, reply) => {
    empty.parse(req.query);
    const wallet = await sessionWallet(req);
    if (!wallet) return reply.code(401).send({ error: 'Sign in required' });
    const { rows } = await pool.query('SELECT theme_id AS "themeId" FROM watchlists WHERE wallet=$1 ORDER BY created_at', [wallet]);
    return { themes: rows.map(r => r.themeId) };
  });
  app.post('/watchlist', async (req, reply) => {
    if (!requireOrigin(req, reply)) return;
    const { themeId } = z.object({ themeId: themeIdSchema }).strict().parse(req.body);
    const wallet = await sessionWallet(req);
    if (!wallet) return reply.code(401).send({ error: 'Sign in required' });
    const result = await pool.query('INSERT INTO watchlists(wallet,theme_id) SELECT $1,id FROM themes WHERE id=$2 ON CONFLICT DO NOTHING RETURNING theme_id', [wallet, themeId]);
    if (!result.rowCount && !(await pool.query('SELECT 1 FROM themes WHERE id=$1', [themeId])).rowCount) return reply.code(404).send({ error: 'Theme not found' });
    return { saved: true, themeId };
  });
  app.delete('/watchlist/:id', async (req, reply) => {
    if (!requireOrigin(req, reply)) return;
    empty.parse(req.query);
    const { id } = z.object({ id: themeIdSchema }).strict().parse(req.params);
    const wallet = await sessionWallet(req);
    if (!wallet) return reply.code(401).send({ error: 'Sign in required' });
    await pool.query('DELETE FROM watchlists WHERE wallet=$1 AND theme_id=$2', [wallet, id]);
    return { removed: true };
  });
  app.get('/alerts', async (req, reply) => {
    empty.parse(req.query);
    const wallet = await sessionWallet(req);
    if (!wallet) return reply.code(401).send({ error: 'Sign in required' });
    const { rows } = await pool.query('SELECT id,theme_id AS "themeId",threshold,enabled FROM alerts WHERE wallet=$1 ORDER BY created_at DESC', [wallet]);
    const deliveries = await pool.query('SELECT d.id,d.alert_id AS "alertId",d.status,d.reason,d.created_at AS "createdAt" FROM alert_deliveries d JOIN alerts a ON a.id=d.alert_id WHERE a.wallet=$1 ORDER BY d.created_at DESC LIMIT 100', [wallet]);
    return { alerts: rows, deliveries: deliveries.rows, telegram: { enabled: false } };
  });
  app.post('/alerts', async (req, reply) => {
    if (!requireOrigin(req, reply)) return;
    const { themeId, threshold } = z.object({ themeId: themeIdSchema, threshold: z.number().finite().min(0).max(1) }).strict().parse(req.body);
    const wallet = await sessionWallet(req);
    if (!wallet) return reply.code(401).send({ error: 'Sign in required' });
    const count = await pool.query('SELECT count(*)::int AS n FROM alerts WHERE wallet=$1', [wallet]);
    if (count.rows[0].n >= 50) return reply.code(409).send({ error: 'Alert limit reached' });
    const id = randomUUID();
    const result = await pool.query('INSERT INTO alerts(id,wallet,theme_id,threshold) SELECT $1,$2,id,$4 FROM themes WHERE id=$3 RETURNING id', [id, wallet, themeId, threshold]);
    if (!result.rowCount) return reply.code(404).send({ error: 'Theme not found' });
    return { id, enabled: true, channel: 'in-app', telegram: { enabled: false } };
  });
  app.delete('/alerts/:id', async (req, reply) => {
    if (!requireOrigin(req, reply)) return;
    empty.parse(req.query);
    const { id } = z.object({ id: z.uuid() }).strict().parse(req.params);
    const wallet = await sessionWallet(req);
    if (!wallet) return reply.code(401).send({ error: 'Sign in required' });
    await pool.query('UPDATE alerts SET enabled=false WHERE id=$1 AND wallet=$2', [id, wallet]);
    return { disabled: true };
  });
  app.post('/trade', async (req, reply) => {
    if (!requireOrigin(req, reply)) return;
    empty.parse(req.body ?? {});
    // No client country header is trusted by this local, direct-binding server.
    const location = geoDecision(undefined, false);
    return reply.code(403).send({ error: trading.reason, trading, location, polymarketTradingEnabled: false, kalshiReadOnly: true });
  });
  const clients = new Set<WebSocket>();
  const alive = new Set<WebSocket>();
  app.get('/feed', { websocket: true, preValidation: async (req, reply) => {
    empty.parse(req.query);
    if (req.headers.origin !== config.WEB_ORIGIN) return reply.code(403).send({ error: 'WebSocket origin not allowed' });
    if (clients.size >= 100) return reply.code(503).send({ error: 'Feed capacity reached' });
  } }, socket => {
    clients.add(socket);
    alive.add(socket);
    socket.send(JSON.stringify({ type: 'connected', capturedAt: new Date().toISOString() }));
    socket.on('error', () => { clients.delete(socket); alive.delete(socket); });
    socket.on('close', () => { clients.delete(socket); alive.delete(socket); });
    socket.on('pong', () => alive.add(socket));
    socket.on('message', () => socket.close(1008, 'Read-only feed'));
  });
  const subscriber = options.subscribe === false ? null : redis.duplicate();
  if (subscriber) {
    subscriber.on('error', () => { app.log.warn('Feed subscription unavailable'); });
    await subscriber.subscribe('parallax:feed');
    subscriber.on('message', (_channel, message) => {
      for (const socket of clients) if (socket.readyState === 1) {
        if (socket.bufferedAmount > 65536) socket.close(1013, 'Slow consumer');
        else socket.send(message);
      }
    });
  }
  const ping = setInterval(() => {
    for (const socket of clients) {
      if (!alive.has(socket)) { socket.terminate(); clients.delete(socket); continue; }
      alive.delete(socket);
      if (socket.readyState === 1) socket.ping();
    }
  }, 30000);
  ping.unref();
  app.addHook('onClose', async () => { clearInterval(ping); for (const socket of clients) socket.close(1001, 'Server closing'); subscriber?.disconnect(); });
  return app;
}

export async function startServer(): Promise<void> {
  await runtime();
  const app = await buildApp();
  const stop = async () => { await app.close(); await closeConnections(); };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(async () => { console.error('API startup failed. Check service availability and port configuration.'); await closeConnections(); process.exitCode = 1; });
}

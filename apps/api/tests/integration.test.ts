import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { buildApp } from '../src/server.js';
import { migrate, pool, redis, closeConnections } from '../src/db.js';
import { config } from '../src/config.js';
import { hashToken } from '../src/auth.js';
import { randomUUID } from 'node:crypto';
import { terminalData } from '../src/store.js';

describe.runIf(process.env.RUN_INTEGRATION === '1')('real PostgreSQL / Redis HTTP integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const keys = nacl.sign.keyPair();
  const address = bs58.encode(keys.publicKey);
  const origin = config.WEB_ORIGIN;
  beforeAll(async () => { await migrate(); app = await buildApp({ logger: false }); await app.ready(); });
  afterAll(async () => {
    await app?.close();
    await pool.query('DELETE FROM sessions WHERE wallet=$1', [address]);
    await pool.query('DELETE FROM auth_nonces WHERE wallet=$1', [address]);
    await pool.query('DELETE FROM alert_deliveries WHERE alert_id IN (SELECT id FROM alerts WHERE wallet=$1)', [address]);
    await pool.query('DELETE FROM alerts WHERE wallet=$1', [address]);
    await pool.query('DELETE FROM watchlists WHERE wallet=$1', [address]);
    await pool.query('DELETE FROM users WHERE wallet=$1', [address]);
    await closeConnections();
  });
  it('migrates the real database and checks services', async () => {
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect(await redis.ping()).toBe('PONG');
    expect((await pool.query('SELECT version FROM schema_migrations')).rows).toContainEqual({ version: 1 });
  });
  it('returns the shared terminal contract without placeholders', async () => {
    const response = await app.inject('/terminal');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ themes: expect.any(Array), perps: expect.any(Array), signals: expect.any(Array), health: expect.any(Array), trading: { enabled: false } });
  });
  it('revalidates quote freshness on cached terminal responses without changing their capturedAt', async () => {
    const data = await terminalData();
    const capturedAt = new Date(Date.now() - 301000).toISOString();
    for (const theme of data.themes) for (const market of theme.markets) market.capturedAt = capturedAt;
    const cache = vi.spyOn(redis, 'get').mockResolvedValueOnce(JSON.stringify(data));
    try {
      const response = await app.inject('/terminal');
      expect(response.statusCode).toBe(200);
      for (const theme of response.json().themes) for (const market of theme.markets) {
        expect(market).toMatchObject({ yesBid: null, yesAsk: null, yesMid: null, capturedAt });
      }
    } finally { cache.mockRestore(); }
  });
  it('validates inputs and refuses unknown symbols before upstream requests', async () => {
    expect((await app.inject('/candles?symbol=FAKE-PERP&resolution=60')).statusCode).toBe(400);
    expect((await app.inject('/candles?symbol=SOL-PERP&resolution=2')).statusCode).toBe(400);
    expect((await app.inject('/terminal?debug=true')).statusCode).toBe(400);
    expect((await app.inject('/themes/not-real/history')).statusCode).toBe(404);
  });
  it('enforces CORS, auth origin and no execution regardless of spoofed geography', async () => {
    expect((await app.inject({ url: '/terminal', headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address } })).statusCode).toBe(403);
    const denied = await app.inject({ method: 'POST', url: '/trade', headers: { origin, 'cf-ipcountry': 'GB' }, payload: {} });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().trading.enabled).toBe(false);
    expect(denied.headers['content-security-policy']).toContain("default-src 'none'");
  });
  it('creates a wallet session and prevents challenge replay, then revokes logout', async () => {
    const challenge = (await app.inject({ method: 'POST', url: '/auth/challenge', headers: { origin }, payload: { address } })).json();
    expect(challenge.message).toContain(new URL(origin).host);
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), keys.secretKey));
    const payload = { address, nonce: challenge.nonce, signature };
    const response = await app.inject({ method: 'POST', url: '/auth/verify', headers: { origin }, payload });
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect((await app.inject({ url: '/auth/session', headers: { cookie } })).json()).toEqual({ authenticated: true, address });
    expect((await app.inject({ method: 'POST', url: '/auth/verify', headers: { origin }, payload })).statusCode).toBe(401);
    const headers = { origin, cookie };
    for (const url of ['/watchlist', '/alerts']) {
      const payload = url === '/alerts' ? { themeId: 'polymarket:POLY-not-real', threshold: 0.5 } : { themeId: 'polymarket:POLY-not-real' };
      expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url, headers, payload: { ...payload, themeId: "bad';DROP TABLE themes;" } })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'DELETE', url: '/watchlist/polymarket%3APOLY-not-real', headers })).statusCode).toBe(200);
    const theme = (await pool.query('SELECT id FROM themes ORDER BY id LIMIT 1')).rows[0];
    if (theme) {
      expect((await app.inject({ method: 'POST', url: '/watchlist', headers, payload: { themeId: theme.id } })).statusCode).toBe(200);
      expect((await app.inject({ url: '/watchlist', headers })).json().themes).toContain(theme.id);
      const alert = await app.inject({ method: 'POST', url: '/alerts', headers, payload: { themeId: theme.id, threshold: 1 } });
      expect(alert.statusCode).toBe(200);
      expect((await app.inject({ method: 'DELETE', url: `/alerts/${alert.json().id}`, headers })).statusCode).toBe(200);
    }
    await app.inject({ method: 'POST', url: '/auth/logout', headers: { origin, cookie }, payload: {} });
    expect((await app.inject({ url: '/auth/session', headers: { cookie } })).json().authenticated).toBe(false);
  });
  it('rejects expired nonce even with valid signature', async () => {
    const challenge = (await app.inject({ method: 'POST', url: '/auth/challenge', headers: { origin }, payload: { address } })).json();
    await pool.query("UPDATE auth_nonces SET expires_at=now()-interval '1 second' WHERE nonce_hash=$1", [hashToken(challenge.nonce)]);
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), keys.secretKey));
    expect((await app.inject({ method: 'POST', url: '/auth/verify', headers: { origin }, payload: { address, nonce: challenge.nonce, signature } })).statusCode).toBe(401);
  });
  it('atomically rejects parallel challenge replay', async () => {
    const challenge = (await app.inject({ method: 'POST', url: '/auth/challenge', headers: { origin }, payload: { address } })).json();
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), keys.secretKey));
    const responses = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: '/auth/verify', headers: { origin }, payload: { address, nonce: challenge.nonce, signature } })));
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 401]);
  });
  it('bounds bodies and enforces Redis-backed auth rates per direct IP', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/challenge', headers: { origin }, payload: { address, padding: 'x'.repeat(17000) } })).statusCode).toBe(413);
    const remoteAddress = `198.18.${Math.floor(Math.random() * 254)}.${Math.floor(Math.random() * 254)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await app.inject({ method: 'POST', url: '/auth/challenge', remoteAddress, headers: { origin, 'x-forwarded-for': `203.0.113.${i}` }, payload: { address } })).statusCode);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });
  it('enforces WebSocket origin, carries real Redis invalidation, and rejects client messages', async () => {
    await expect(app.injectWS('/feed', { headers: { origin: 'https://evil.example' } })).rejects.toThrow();
    const socket = await app.injectWS('/feed', { headers: { origin } });
    try {
      const probe = randomUUID();
      const received = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Feed notification timeout')), 3000);
        socket.on('message', data => {
          const event = JSON.parse(String(data));
          if (event.probe === probe) { clearTimeout(timer); resolve(event); }
        });
      });
      await redis.publish('parallax:feed', JSON.stringify({ type: 'update', capturedAt: new Date().toISOString(), probe }));
      expect((await received).type).toBe('update');
      const closed = new Promise<number>(resolve => socket.once('close', resolve));
      socket.send('not allowed');
      expect(await closed).toBe(1008);
    } finally { socket.terminate(); }
  });
});

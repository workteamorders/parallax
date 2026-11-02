import { z } from 'zod';
import type { Perp, VenueHealth } from '@parallax/shared';
import { redis } from './db.js';
import { randomUUID } from 'node:crypto';
import { jupiterMarketSchema, parsePerps, parsePrediction, type JupiterMarket } from './providers-core.js';
import type { PredictionMarket } from '@parallax/shared';

export * from './providers-core.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const roots = { jupiter: 'https://api.jup.ag/prediction/v1', velocity: 'https://data.velocity.exchange' };

async function paceJupiter(): Promise<void> {
  // A Redis slot is shared by API, worker and review CLI, including retries.
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await redis.set('parallax:jupiter:slot', randomUUID(), 'PX', 2200, 'NX')) return;
    await sleep(250);
  }
  throw new Error('Jupiter request queue timeout');
}

export async function providerJson(provider: keyof typeof roots, path: string): Promise<unknown> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid provider path');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (provider === 'jupiter') await paceJupiter();
    let response: Response;
    try {
      response = await fetch(`${roots[provider]}${path}`, { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { accept: 'application/json' } });
    } catch {
      if (attempt === 2) throw new Error(`${provider}: network unavailable`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      await sleep(Math.min(30000, Math.max(1000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)));
      continue;
    }
    if (!response.ok) throw new Error(`${provider}: HTTP ${response.status}`);
    return response.json();
  }
  throw new Error(`${provider}: retry exhausted`);
}

export async function fetchPerps(): Promise<Perp[]> { return parsePerps(await providerJson('velocity', '/stats/markets')); }
export async function fetchMarket(id: string): Promise<{ raw: JupiterMarket; market: PredictionMarket | null }> {
  const raw = jupiterMarketSchema.parse(await providerJson('jupiter', `/markets/${encodeURIComponent(id)}`));
  if (raw.marketId !== id) throw new Error('Provider returned a different market ID');
  return { raw, market: parsePrediction(raw) };
}

export async function probeDirectSources(): Promise<VenueHealth[]> {
  const endpoints = [
    { venue: 'gamma', url: 'https://gamma-api.polymarket.com/markets/keyset?limit=1&active=true&closed=false' },
    { venue: 'kalshi-elections', url: 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=1&status=open' },
    { venue: 'kalshi-external', url: 'https://external-api.kalshi.com/trade-api/v2/markets?limit=1&status=open' },
  ];
  return Promise.all(endpoints.map(async ({ venue, url }): Promise<VenueHealth> => {
    const key = `parallax:probe:${venue}`;
    const cached = await redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached);
    let result: VenueHealth;
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = z.object({ markets: z.array(z.unknown()) }).parse(await response.json());
      result = { venue, status: 'healthy', message: `Verified TLS GET ${url}: HTTP ${response.status}, ${body.markets.length} market record(s). Connectivity only; not a reviewed equivalence or execution authorization.`, checkedAt: new Date().toISOString() };
    } catch {
      result = { venue, status: 'unavailable', message: `Verified TLS GET ${url} failed or returned an invalid response; no insecure retry.`, checkedAt: new Date().toISOString() };
    }
    await redis.set(key, JSON.stringify(result), 'EX', 60).catch(() => {});
    return result;
  }));
}

import pg from 'pg';
import { Redis } from 'ioredis';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
pool.on('error', () => { /* Idle connection loss is retried on the next pool acquisition. */ });
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, retryStrategy: () => null });
redis.on('error', () => { /* Redis outages are surfaced through health, never connection strings. */ });

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(741009)');
    await client.query(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(741009)'); }
    finally { client.release(); }
  }
}
export async function closeConnections(): Promise<void> {
  redis.disconnect();
  await pool.end();
}

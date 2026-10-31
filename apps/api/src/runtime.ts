import { config } from './config.js';
import { pool, redis, migrate, closeConnections } from './db.js';

export const FEED_CHANNEL = 'parallax:feed';
export async function runtime() {
  await migrate();
  await redis.ping();
  return { config, pool, redis, close: closeConnections };
}

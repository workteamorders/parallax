import { z } from 'zod';

const env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1024).max(65535).default(4100),
  API_HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().url().default('postgres://parallax:parallax_local_only@127.0.0.1:55432/parallax'),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:56379'),
  WEB_ORIGIN: z.string().url().default('http://127.0.0.1:3100'),
  SOLANA_NETWORK: z.enum(['devnet', 'mainnet-beta']).default('devnet'),
  BUILDER_FEE_TENTHS_BP: z.coerce.number().finite().default(20),
  BLOCKED_COUNTRIES: z.string().default('US,CU,IR,KP,SY'),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(60000).default(120000),
  SIGNAL_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
  SIGNAL_Z_THRESHOLD: z.coerce.number().positive().default(2),
  SIGNAL_FOLLOW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  SIGNAL_MIN_COUNT: z.coerce.number().int().min(30).default(30),
}).parse(process.env);

export const config = { ...env, WEB_ORIGIN: new URL(env.WEB_ORIGIN).origin };
if (config.NODE_ENV === 'production' && !config.WEB_ORIGIN.startsWith('https://')) throw new Error('Production WEB_ORIGIN requires HTTPS');
export function builderFee(value: number): number {
  return Math.max(0, Math.min(100, 1000, Number.isFinite(value) ? Math.floor(value) : 20));
}
export const trading = {
  enabled: false,
  network: config.SOLANA_NETWORK,
  reason: 'Trading disabled. Read-only research; no signing, deposits, withdrawals or order submission are implemented.',
  builderFeeTenthsBp: builderFee(config.BUILDER_FEE_TENTHS_BP),
};

export function geoDecision(country: string | undefined, trusted: boolean): { allowed: boolean; reason: string } {
  if (!trusted || !country || !/^[A-Z]{2}$/.test(country)) return { allowed: false, reason: 'Country cannot be verified' };
  if (config.BLOCKED_COUNTRIES.split(',').includes(country)) return { allowed: false, reason: 'Restricted jurisdiction' };
  return { allowed: true, reason: 'Read-only; location is not trading authorization' };
}

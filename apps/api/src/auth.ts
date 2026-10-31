import { createHash, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from './db.js';
import { config } from './config.js';

export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const addressSchema = z.string().min(32).max(44).refine(value => {
  try { return bs58.decode(value).length === 32; } catch { return false; }
}, 'Invalid Solana address');
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const cookieName = config.NODE_ENV === 'production' ? '__Host-parallax_session' : 'parallax_session';
const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: config.NODE_ENV === 'production', path: '/' };

export function verifyWalletSignature(address: string, message: string, signature: string): boolean {
  try {
    const publicKey = bs58.decode(address), bytes = bs58.decode(signature);
    return publicKey.length === 32 && bytes.length === 64 && nacl.sign.detached.verify(new TextEncoder().encode(message), bytes, publicKey);
  } catch { return false; }
}
export async function sessionWallet(request: FastifyRequest): Promise<string | null> {
  const token = tokenSchema.safeParse(request.cookies[cookieName]);
  if (!token.success) return null;
  const { rows } = await pool.query('SELECT wallet FROM sessions WHERE token_hash=$1 AND expires_at>now()', [hashToken(token.data)]);
  return rows[0]?.wallet ?? null;
}
export function requireOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.headers.origin !== config.WEB_ORIGIN) { reply.code(403).send({ error: 'Origin not allowed' }); return false; }
  return true;
}
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/challenge', { config: { rateLimit: { max: 10, timeWindow: '1 minute', groupId: 'challenge' } } }, async (req, reply) => {
    if (!requireOrigin(req, reply)) return;
    const { address } = z.object({ address: addressSchema }).strict().parse(req.body);
    const nonce = randomBytes(32).toString('hex');
    const issuedAt = new Date(), expiresAt = new Date(issuedAt.getTime() + 5 * 60000);
    const domain = new URL(config.WEB_ORIGIN).host;
    const chainId = config.SOLANA_NETWORK === 'mainnet-beta' ? 'mainnet' : config.SOLANA_NETWORK;
    const message = `${domain} wants you to sign in with your Solana account:\n${address}\n\nSign in to Parallax research. This does not authorize transactions.\n\nURI: ${config.WEB_ORIGIN}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt.toISOString()}\nExpiration Time: ${expiresAt.toISOString()}`;
    await pool.query('INSERT INTO auth_nonces(nonce_hash,wallet,message,domain,expires_at) VALUES($1,$2,$3,$4,$5)', [hashToken(nonce), address, message, domain, expiresAt]);
    return { nonce, message, expiresAt: expiresAt.toISOString() };
  });
  app.post('/auth/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute', groupId: 'verify' } } }, async (req, reply) => {
    if (!requireOrigin(req, reply)) return;
    const { address, nonce, signature } = z.object({ address: addressSchema, nonce: tokenSchema, signature: z.string().min(64).max(100) }).strict().parse(req.body);
    const { rows } = await pool.query('SELECT message,domain FROM auth_nonces WHERE nonce_hash=$1 AND wallet=$2 AND expires_at>now() AND consumed_at IS NULL', [hashToken(nonce), address]);
    const challenge = rows[0];
    if (!challenge || challenge.domain !== new URL(config.WEB_ORIGIN).host || !verifyWalletSignature(address, challenge.message, signature)) return reply.code(401).send({ error: 'Invalid or expired signature challenge' });
    const token = randomBytes(32).toString('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query('UPDATE auth_nonces SET consumed_at=now() WHERE nonce_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING nonce_hash', [hashToken(nonce)]);
      if (!consumed.rowCount) { await client.query('ROLLBACK'); return reply.code(401).send({ error: 'Challenge already used' }); }
      await client.query('INSERT INTO users(wallet) VALUES($1) ON CONFLICT DO NOTHING', [address]);
      await client.query("INSERT INTO sessions(token_hash,wallet,expires_at) VALUES($1,$2,now()+interval '24 hours')", [hashToken(token), address]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: 86400 });
    return { authenticated: true, address };
  });
  app.get('/auth/session', async req => {
    z.object({}).strict().parse(req.query);
    const address = await sessionWallet(req);
    return { authenticated: Boolean(address), address };
  });
  app.post('/auth/logout', async (req, reply) => {
    if (!requireOrigin(req, reply)) return;
    z.object({}).strict().parse(req.body ?? {});
    const token = tokenSchema.safeParse(req.cookies[cookieName]);
    if (token.success) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token.data)]);
    reply.clearCookie(cookieName, cookieOptions);
    return { authenticated: false };
  });
}

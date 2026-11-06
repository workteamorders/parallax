/** Postgres (Neon, over HTTPS) implementation of the account Store. Plain SQL, parameters only, no string building. */
import { neon } from "@neondatabase/serverless";
import type { AlertRow, Store } from "./account";

export function createNeonStore(connectionString: string): Store {
  const sql = neon(connectionString);
  const ts = (d: Date) => d.toISOString();
  return {
    async purgeExpired(now) {
      await sql`DELETE FROM auth_nonces WHERE expires_at < ${ts(now)}::timestamptz - interval '1 hour'`;
      await sql`DELETE FROM sessions WHERE expires_at < ${ts(now)}::timestamptz`;
    },
    async countLiveNonces(wallet, now) {
      const rows = await sql`SELECT count(*)::int AS n FROM auth_nonces WHERE wallet = ${wallet} AND consumed_at IS NULL AND expires_at > ${ts(now)}::timestamptz`;
      return Number(rows[0]?.n ?? 0);
    },
    async putNonce(n) {
      await sql`INSERT INTO auth_nonces (nonce_hash, wallet, message, domain, expires_at) VALUES (${n.hash}, ${n.wallet}, ${n.message}, ${n.domain}, ${ts(n.expiresAt)}::timestamptz)`;
    },
    async takeNonce(hash, wallet, now) {
      const rows = await sql`UPDATE auth_nonces SET consumed_at = ${ts(now)}::timestamptz WHERE nonce_hash = ${hash} AND wallet = ${wallet} AND consumed_at IS NULL AND expires_at > ${ts(now)}::timestamptz RETURNING message, domain`;
      const row = rows[0];
      return row ? { message: String(row.message), domain: String(row.domain) } : null;
    },
    async createSession(tokenHash, wallet, expiresAt) {
      await sql.transaction([
        sql`INSERT INTO users (wallet) VALUES (${wallet}) ON CONFLICT DO NOTHING`,
        sql`INSERT INTO sessions (token_hash, wallet, expires_at) VALUES (${tokenHash}, ${wallet}, ${ts(expiresAt)}::timestamptz)`,
      ]);
    },
    async sessionWallet(tokenHash, now) {
      const rows = await sql`SELECT wallet FROM sessions WHERE token_hash = ${tokenHash} AND expires_at > ${ts(now)}::timestamptz`;
      return rows[0] ? String(rows[0].wallet) : null;
    },
    async deleteSession(tokenHash) {
      await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
    },
    async listWatchlist(wallet) {
      const rows = await sql`SELECT theme_id FROM watchlists WHERE wallet = ${wallet} ORDER BY created_at`;
      return rows.map((r) => String(r.theme_id));
    },
    async addWatch(wallet, themeId) {
      await sql`INSERT INTO watchlists (wallet, theme_id) VALUES (${wallet}, ${themeId}) ON CONFLICT DO NOTHING`;
    },
    async removeWatch(wallet, themeId) {
      await sql`DELETE FROM watchlists WHERE wallet = ${wallet} AND theme_id = ${themeId}`;
    },
    async listAlerts(wallet): Promise<AlertRow[]> {
      const rows = await sql`SELECT id, theme_id, threshold, enabled FROM alerts WHERE wallet = ${wallet} AND enabled ORDER BY created_at DESC`;
      return rows.map((r) => ({ id: String(r.id), themeId: String(r.theme_id), threshold: Number(r.threshold), enabled: Boolean(r.enabled) }));
    },
    async addAlert(wallet, id, themeId, threshold) {
      await sql`INSERT INTO alerts (id, wallet, theme_id, threshold) VALUES (${id}::uuid, ${wallet}, ${themeId}, ${threshold})`;
    },
    async disableAlert(wallet, id) {
      await sql`UPDATE alerts SET enabled = false WHERE id = ${id}::uuid AND wallet = ${wallet}`;
    },
  };
}

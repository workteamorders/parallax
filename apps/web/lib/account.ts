/**
 * Serverless account features: wallet sign-in, watchlist, in-app alerts.
 *
 * Runs inside the Next route handler (no separate API server). Storage sits behind the `Store` interface, so the
 * logic here is tested against an in-memory store and the real Postgres store (account-store.ts) stays thin.
 *
 * Security notes:
 *  - Sign-in is a signed message only. It never authorizes a transaction (the message says so).
 *  - Nonces are random, stored hashed, single use, and expire after 5 minutes. A nonce is consumed before the
 *    signature is checked, so a captured challenge can never be replayed.
 *  - The challenge is bound to the host the request came from, and verify must arrive on the same host.
 *  - Session tokens are random, stored only as a SHA-256 hash, sent in an HttpOnly, SameSite=Strict cookie.
 *  - Every state-changing request must carry an Origin header equal to the site's own origin.
 */
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import bs58 from "bs58";
import { z } from "zod";

export interface AlertRow {
  id: string;
  themeId: string;
  threshold: number;
  enabled: boolean;
}

export interface Store {
  purgeExpired(now: Date): Promise<void>;
  countLiveNonces(wallet: string, now: Date): Promise<number>;
  putNonce(n: { hash: string; wallet: string; message: string; domain: string; expiresAt: Date }): Promise<void>;
  /** Atomically marks a live nonce as used and returns it; null when missing, expired or already used. */
  takeNonce(hash: string, wallet: string, now: Date): Promise<{ message: string; domain: string } | null>;
  createSession(tokenHash: string, wallet: string, expiresAt: Date): Promise<void>;
  sessionWallet(tokenHash: string, now: Date): Promise<string | null>;
  deleteSession(tokenHash: string): Promise<void>;
  listWatchlist(wallet: string): Promise<string[]>;
  addWatch(wallet: string, themeId: string): Promise<void>;
  removeWatch(wallet: string, themeId: string): Promise<void>;
  listAlerts(wallet: string): Promise<AlertRow[]>;
  addAlert(wallet: string, id: string, themeId: string, threshold: number): Promise<void>;
  disableAlert(wallet: string, id: string): Promise<void>;
}

export interface AccountDeps {
  store: Store;
  now: () => Date;
  /** The origin this deployment is served from, derived per request unless fixed by configuration. */
  allowedOrigin: (req: Request) => string;
  themeExists: (id: string) => Promise<boolean>;
  network: "mainnet" | "devnet";
  production: boolean;
}

export const SESSION_SECONDS = 86_400;
export const NONCE_SECONDS = 300;
export const MAX_LIVE_NONCES_PER_WALLET = 10;
export const MAX_ALERTS = 50;
export const MAX_WATCHED = 100;
const MAX_BODY_BYTES = 16_384;

export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

const addressSchema = z
  .string()
  .min(32)
  .max(44)
  .refine((value) => {
    try {
      return bs58.decode(value).length === 32;
    } catch {
      return false;
    }
  }, "Invalid Solana address");
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const themeIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9:_-]+$/);
const uuidSchema = z.string().regex(/^[a-f0-9-]{36}$/);

// DER prefix that turns a raw 32-byte ed25519 public key into an SPKI structure Node can import.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyWalletSignature(address: string, message: string, signature: string): boolean {
  try {
    const publicKey = bs58.decode(address);
    const bytes = bs58.decode(signature);
    if (publicKey.length !== 32 || bytes.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(bytes));
  } catch {
    return false;
  }
}

export const sessionCookieName = (production: boolean) => (production ? "__Host-parallax_session" : "parallax_session");

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(name: string, token: string, production: boolean, maxAge = SESSION_SECONDS): string {
  return `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${production ? "; Secure" : ""}`;
}

export function buildChallengeMessage(o: {
  origin: string;
  address: string;
  network: "mainnet" | "devnet";
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  const domain = new URL(o.origin).host;
  return `${domain} wants you to sign in with your Solana account:\n${o.address}\n\nSign in to Parallax research. This does not authorize transactions.\n\nURI: ${o.origin}\nVersion: 1\nChain ID: ${o.network}\nNonce: ${o.nonce}\nIssued At: ${o.issuedAt.toISOString()}\nExpiration Time: ${o.expiresAt.toISOString()}`;
}

const noStore = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...noStore, ...extra } });

export function createAccountHandler(deps: AccountDeps) {
  const { store, now } = deps;
  const cookieName = sessionCookieName(deps.production);

  async function walletOf(req: Request): Promise<string | null> {
    const token = tokenSchema.safeParse(readCookie(req.headers.get("cookie"), cookieName));
    if (!token.success) return null;
    return store.sessionWallet(hashToken(token.data), now());
  }

  async function bodyOf(req: Request): Promise<unknown> {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new HttpError(413, "Body too large");
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "Invalid request");
    }
  }

  return async function handle(req: Request, path: string): Promise<Response> {
    try {
      const method = req.method;
      if (method !== "GET") {
        if (req.headers.get("origin") !== deps.allowedOrigin(req)) return json({ error: "Origin not allowed" }, 403);
      }

      // ---- sign-in ----
      if (path === "auth/challenge") {
        if (method !== "POST") return json({ error: "Method not allowed" }, 405);
        const { address } = z.object({ address: addressSchema }).strict().parse(await bodyOf(req));
        const t = now();
        await store.purgeExpired(t);
        if ((await store.countLiveNonces(address, t)) >= MAX_LIVE_NONCES_PER_WALLET)
          return json({ error: "Too many sign-in attempts. Wait a minute and try again." }, 429, { "retry-after": "60" });
        const nonce = randomBytes(32).toString("hex");
        const expiresAt = new Date(t.getTime() + NONCE_SECONDS * 1000);
        const origin = deps.allowedOrigin(req);
        const message = buildChallengeMessage({ origin, address, network: deps.network, nonce, issuedAt: t, expiresAt });
        await store.putNonce({ hash: hashToken(nonce), wallet: address, message, domain: new URL(origin).host, expiresAt });
        return json({ nonce, message, expiresAt: expiresAt.toISOString() });
      }
      if (path === "auth/verify") {
        if (method !== "POST") return json({ error: "Method not allowed" }, 405);
        const { address, nonce, signature } = z
          .object({ address: addressSchema, nonce: tokenSchema, signature: z.string().min(64).max(100) })
          .strict()
          .parse(await bodyOf(req));
        const t = now();
        const challenge = await store.takeNonce(hashToken(nonce), address, t);
        if (!challenge) return json({ error: "Challenge expired or already used" }, 401);
        if (challenge.domain !== new URL(deps.allowedOrigin(req)).host || !verifyWalletSignature(address, challenge.message, signature))
          return json({ error: "Signature rejected" }, 401);
        const token = randomBytes(32).toString("hex");
        await store.createSession(hashToken(token), address, new Date(t.getTime() + SESSION_SECONDS * 1000));
        return json({ authenticated: true, address }, 200, { "set-cookie": sessionCookie(cookieName, token, deps.production) });
      }
      if (path === "auth/session") {
        if (method !== "GET") return json({ error: "Method not allowed" }, 405);
        const address = await walletOf(req);
        return json({ authenticated: Boolean(address), address });
      }
      if (path === "auth/logout") {
        if (method !== "POST") return json({ error: "Method not allowed" }, 405);
        const token = tokenSchema.safeParse(readCookie(req.headers.get("cookie"), cookieName));
        if (token.success) await store.deleteSession(hashToken(token.data));
        return json({ authenticated: false }, 200, { "set-cookie": sessionCookie(cookieName, "", deps.production, 0) });
      }

      // ---- everything below needs a session ----
      const wallet = await walletOf(req);
      if (!wallet) return json({ error: "Sign in required" }, 401);

      if (path === "watchlist") {
        if (method === "GET") return json({ themes: await store.listWatchlist(wallet) });
        if (method === "POST") {
          const { themeId } = z.object({ themeId: themeIdSchema }).strict().parse(await bodyOf(req));
          if (!(await deps.themeExists(themeId))) return json({ error: "Theme not found" }, 404);
          const current = await store.listWatchlist(wallet);
          if (!current.includes(themeId)) {
            if (current.length >= MAX_WATCHED) return json({ error: "Watchlist limit reached" }, 409);
            await store.addWatch(wallet, themeId);
          }
          return json({ saved: true, themeId });
        }
        return json({ error: "Method not allowed" }, 405);
      }
      const watchItem = /^watchlist\/(.+)$/.exec(path);
      if (watchItem) {
        if (method !== "DELETE") return json({ error: "Method not allowed" }, 405);
        const id = themeIdSchema.parse(decodeURIComponent(watchItem[1]!));
        await store.removeWatch(wallet, id);
        return json({ removed: true });
      }

      if (path === "alerts") {
        if (method === "GET") return json({ alerts: await store.listAlerts(wallet), deliveries: [], telegram: { enabled: false } });
        if (method === "POST") {
          const { themeId, threshold } = z
            .object({ themeId: themeIdSchema, threshold: z.number().finite().min(0).max(1) })
            .strict()
            .parse(await bodyOf(req));
          if ((await store.listAlerts(wallet)).length >= MAX_ALERTS) return json({ error: "Alert limit reached" }, 409);
          if (!(await deps.themeExists(themeId))) return json({ error: "Theme not found" }, 404);
          const id = randomUUID();
          await store.addAlert(wallet, id, themeId, threshold);
          return json({ id, enabled: true, channel: "in-app", telegram: { enabled: false } });
        }
        return json({ error: "Method not allowed" }, 405);
      }
      const alertItem = /^alerts\/(.+)$/.exec(path);
      if (alertItem) {
        if (method !== "DELETE") return json({ error: "Method not allowed" }, 405);
        const id = uuidSchema.parse(alertItem[1]);
        await store.disableAlert(wallet, id);
        return json({ disabled: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof z.ZodError) return json({ error: "Invalid request" }, 400);
      return json({ error: "Account service unavailable" }, 503);
    }
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

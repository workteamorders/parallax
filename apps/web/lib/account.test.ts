import { generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import {
  MAX_ALERTS,
  MAX_LIVE_NONCES_PER_WALLET,
  NONCE_SECONDS,
  createAccountHandler,
  hashToken,
  readCookie,
  verifyWalletSignature,
  type AlertRow,
  type Store,
} from "./account";

class MemoryStore implements Store {
  nonces = new Map<string, { wallet: string; message: string; domain: string; expiresAt: Date; consumed: boolean }>();
  sessions = new Map<string, { wallet: string; expiresAt: Date }>();
  watch = new Map<string, string[]>();
  alerts: (AlertRow & { wallet: string })[] = [];
  async purgeExpired() {}
  async countLiveNonces(wallet: string, now: Date) {
    return [...this.nonces.values()].filter((n) => n.wallet === wallet && !n.consumed && n.expiresAt > now).length;
  }
  async putNonce(n: { hash: string; wallet: string; message: string; domain: string; expiresAt: Date }) {
    this.nonces.set(n.hash, { wallet: n.wallet, message: n.message, domain: n.domain, expiresAt: n.expiresAt, consumed: false });
  }
  async takeNonce(hash: string, wallet: string, now: Date) {
    const n = this.nonces.get(hash);
    if (!n || n.wallet !== wallet || n.consumed || n.expiresAt <= now) return null;
    n.consumed = true;
    return { message: n.message, domain: n.domain };
  }
  async createSession(tokenHash: string, wallet: string, expiresAt: Date) {
    this.sessions.set(tokenHash, { wallet, expiresAt });
  }
  async sessionWallet(tokenHash: string, now: Date) {
    const s = this.sessions.get(tokenHash);
    return s && s.expiresAt > now ? s.wallet : null;
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async listWatchlist(wallet: string) {
    return this.watch.get(wallet) ?? [];
  }
  async addWatch(wallet: string, themeId: string) {
    this.watch.set(wallet, [...(this.watch.get(wallet) ?? []), themeId]);
  }
  async removeWatch(wallet: string, themeId: string) {
    this.watch.set(wallet, (this.watch.get(wallet) ?? []).filter((t) => t !== themeId));
  }
  async listAlerts(wallet: string) {
    return this.alerts.filter((a) => a.wallet === wallet && a.enabled).map(({ wallet: _w, ...a }) => a);
  }
  async addAlert(wallet: string, id: string, themeId: string, threshold: number) {
    this.alerts.push({ wallet, id, themeId, threshold, enabled: true });
  }
  async disableAlert(wallet: string, id: string) {
    for (const a of this.alerts) if (a.id === id && a.wallet === wallet) a.enabled = false;
  }
}

const ORIGIN = "https://www.example.test";
function setup(opts: { production?: boolean; clock?: { t: number } } = {}) {
  const store = new MemoryStore();
  const clock = opts.clock ?? { t: Date.parse("2026-11-06T02:00:00Z") };
  const handle = createAccountHandler({
    store,
    now: () => new Date(clock.t),
    allowedOrigin: (r) => new URL(r.url).origin,
    themeExists: async (id) => id === "btc-90000-2026" || id === "eth-5000",
    network: "mainnet",
    production: opts.production ?? false,
  });
  return { store, handle, clock };
}

function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = bs58.encode(Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url"));
  return { address, signMessage: (m: string) => bs58.encode(sign(null, Buffer.from(m), privateKey)) };
}

type Handler = ReturnType<typeof setup>["handle"];
async function call(handle: Handler, method: string, path: string, opts: { body?: unknown; cookie?: string; origin?: string | null; host?: string } = {}) {
  const host = opts.host ?? ORIGIN;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (method !== "GET" && opts.origin !== null) headers.origin = opts.origin ?? host;
  const res = await handle(new Request(`${host}/api/${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), path);
  return { status: res.status, body: (await res.json()) as Record<string, any>, setCookie: res.headers.get("set-cookie") };
}

async function signIn(h: Handler, w = wallet(), host = ORIGIN) {
  const ch = await call(h, "POST", "auth/challenge", { body: { address: w.address }, host });
  expect(ch.status).toBe(200);
  const v = await call(h, "POST", "auth/verify", { body: { address: w.address, nonce: ch.body.nonce, signature: w.signMessage(ch.body.message) }, host });
  return { w, ch, v, cookie: v.setCookie ? v.setCookie.split(";")[0]! : "" };
}

describe("signature check", () => {
  it("accepts a real ed25519 signature and rejects anything else", () => {
    const w = wallet();
    const sig = w.signMessage("hello");
    expect(verifyWalletSignature(w.address, "hello", sig)).toBe(true);
    expect(verifyWalletSignature(w.address, "hellO", sig)).toBe(false);
    expect(verifyWalletSignature(wallet().address, "hello", sig)).toBe(false);
    expect(verifyWalletSignature(w.address, "hello", "not-base58-!!")).toBe(false);
    expect(verifyWalletSignature("short", "hello", sig)).toBe(false);
  });
  it("reads cookies by exact name", () => {
    expect(readCookie("a=1; parallax_session=abc; b=2", "parallax_session")).toBe("abc");
    expect(readCookie("xparallax_session=abc", "parallax_session")).toBeNull();
    expect(readCookie(null, "parallax_session")).toBeNull();
  });
});

describe("sign-in flow", () => {
  it("signs in, reports the session, and signs out", async () => {
    const { handle, store } = setup();
    const { w, ch, v, cookie } = await signIn(handle);
    expect(ch.body.message).toContain("does not authorize transactions");
    expect(ch.body.message).toContain("www.example.test wants you to sign in with your Solana account");
    expect(v.status).toBe(200);
    expect(v.body).toEqual({ authenticated: true, address: w.address });
    expect(v.setCookie).toMatch(/HttpOnly/);
    expect(v.setCookie).toMatch(/SameSite=Strict/);
    expect(v.setCookie).not.toMatch(/Secure/); // not production
    // the raw token is never stored, only its hash
    const token = cookie.split("=")[1]!;
    expect(store.sessions.has(token)).toBe(false);
    expect(store.sessions.has(hashToken(token))).toBe(true);

    const s = await call(handle, "GET", "auth/session", { cookie });
    expect(s.body).toEqual({ authenticated: true, address: w.address });
    const out = await call(handle, "POST", "auth/logout", { cookie, body: {} });
    expect(out.body).toEqual({ authenticated: false });
    expect(out.setCookie).toMatch(/Max-Age=0/);
    expect((await call(handle, "GET", "auth/session", { cookie })).body.authenticated).toBe(false);
  });

  it("uses a __Host- Secure cookie in production", async () => {
    const { handle } = setup({ production: true });
    const { v } = await signIn(handle);
    expect(v.setCookie).toMatch(/^__Host-parallax_session=/);
    expect(v.setCookie).toMatch(/; Secure/);
  });

  it("refuses a wrong signature, and the challenge cannot be reused afterwards", async () => {
    const { handle } = setup();
    const w = wallet();
    const ch = await call(handle, "POST", "auth/challenge", { body: { address: w.address } });
    const bad = await call(handle, "POST", "auth/verify", { body: { address: w.address, nonce: ch.body.nonce, signature: wallet().signMessage(ch.body.message) } });
    expect(bad.status).toBe(401);
    const good = await call(handle, "POST", "auth/verify", { body: { address: w.address, nonce: ch.body.nonce, signature: w.signMessage(ch.body.message) } });
    expect(good.status).toBe(401); // nonce already consumed by the failed attempt
  });

  it("refuses to replay a used challenge", async () => {
    const { handle } = setup();
    const { w, ch } = await signIn(handle);
    const again = await call(handle, "POST", "auth/verify", { body: { address: w.address, nonce: ch.body.nonce, signature: w.signMessage(ch.body.message) } });
    expect(again.status).toBe(401);
  });

  it("refuses an expired challenge", async () => {
    const { handle, clock } = setup();
    const w = wallet();
    const ch = await call(handle, "POST", "auth/challenge", { body: { address: w.address } });
    clock.t += (NONCE_SECONDS + 1) * 1000;
    const v = await call(handle, "POST", "auth/verify", { body: { address: w.address, nonce: ch.body.nonce, signature: w.signMessage(ch.body.message) } });
    expect(v.status).toBe(401);
  });

  it("binds the challenge to the host it was issued on", async () => {
    const { handle } = setup();
    const w = wallet();
    const ch = await call(handle, "POST", "auth/challenge", { body: { address: w.address }, host: "https://www.example.test" });
    const v = await call(handle, "POST", "auth/verify", { body: { address: w.address, nonce: ch.body.nonce, signature: w.signMessage(ch.body.message) }, host: "https://evil.example" });
    expect(v.status).toBe(401);
  });

  it("expires sessions after 24 hours", async () => {
    const { handle, clock } = setup();
    const { cookie } = await signIn(handle);
    clock.t += 24 * 3600 * 1000 + 1000;
    expect((await call(handle, "GET", "auth/session", { cookie })).body.authenticated).toBe(false);
  });

  it("limits open challenges per wallet", async () => {
    const { handle } = setup();
    const w = wallet();
    for (let i = 0; i < MAX_LIVE_NONCES_PER_WALLET; i++) expect((await call(handle, "POST", "auth/challenge", { body: { address: w.address } })).status).toBe(200);
    const over = await call(handle, "POST", "auth/challenge", { body: { address: w.address } });
    expect(over.status).toBe(429);
  });

  it("rejects bad input and cross-origin writes", async () => {
    const { handle } = setup();
    expect((await call(handle, "POST", "auth/challenge", { body: { address: "nope" } })).status).toBe(400);
    expect((await call(handle, "POST", "auth/challenge", { body: { address: wallet().address, extra: 1 } })).status).toBe(400);
    expect((await call(handle, "POST", "auth/challenge", { body: { address: wallet().address }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call(handle, "POST", "auth/challenge", { body: { address: wallet().address }, origin: null })).status).toBe(403);
    expect((await call(handle, "GET", "auth/challenge")).status).toBe(405);
  });
});

describe("watchlist", () => {
  it("requires a session", async () => {
    const { handle } = setup();
    expect((await call(handle, "GET", "watchlist")).status).toBe(401);
    expect((await call(handle, "POST", "watchlist", { body: { themeId: "btc-90000-2026" } })).status).toBe(401);
  });

  it("adds, lists and removes themes, per wallet", async () => {
    const { handle } = setup();
    const a = await signIn(handle);
    const b = await signIn(handle);
    expect((await call(handle, "POST", "watchlist", { cookie: a.cookie, body: { themeId: "btc-90000-2026" } })).body).toEqual({ saved: true, themeId: "btc-90000-2026" });
    await call(handle, "POST", "watchlist", { cookie: a.cookie, body: { themeId: "btc-90000-2026" } }); // duplicate is harmless
    expect((await call(handle, "GET", "watchlist", { cookie: a.cookie })).body.themes).toEqual(["btc-90000-2026"]);
    expect((await call(handle, "GET", "watchlist", { cookie: b.cookie })).body.themes).toEqual([]);
    expect((await call(handle, "DELETE", "watchlist/btc-90000-2026", { cookie: a.cookie })).body).toEqual({ removed: true });
    expect((await call(handle, "GET", "watchlist", { cookie: a.cookie })).body.themes).toEqual([]);
  });

  it("rejects unknown themes and malformed ids", async () => {
    const { handle } = setup();
    const { cookie } = await signIn(handle);
    expect((await call(handle, "POST", "watchlist", { cookie, body: { themeId: "nope" } })).status).toBe(404);
    expect((await call(handle, "POST", "watchlist", { cookie, body: { themeId: "bad id!" } })).status).toBe(400);
    expect((await call(handle, "DELETE", "watchlist/..%2F..%2Fx", { cookie })).status).toBe(400);
  });
});

describe("alerts", () => {
  it("creates, lists and disables an alert", async () => {
    const { handle } = setup();
    const { cookie } = await signIn(handle);
    const created = await call(handle, "POST", "alerts", { cookie, body: { themeId: "btc-90000-2026", threshold: 0.4 } });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ enabled: true, channel: "in-app" });
    const list = await call(handle, "GET", "alerts", { cookie });
    expect(list.body.alerts).toEqual([{ id: created.body.id, themeId: "btc-90000-2026", threshold: 0.4, enabled: true }]);
    expect(list.body.deliveries).toEqual([]);
    expect((await call(handle, "DELETE", `alerts/${created.body.id}`, { cookie })).body).toEqual({ disabled: true });
    expect((await call(handle, "GET", "alerts", { cookie })).body.alerts).toEqual([]);
  });

  it("validates thresholds, themes and ownership", async () => {
    const { handle } = setup();
    const a = await signIn(handle);
    const b = await signIn(handle);
    expect((await call(handle, "POST", "alerts", { cookie: a.cookie, body: { themeId: "btc-90000-2026", threshold: 1.5 } })).status).toBe(400);
    expect((await call(handle, "POST", "alerts", { cookie: a.cookie, body: { themeId: "btc-90000-2026", threshold: -0.1 } })).status).toBe(400);
    expect((await call(handle, "POST", "alerts", { cookie: a.cookie, body: { themeId: "nope", threshold: 0.5 } })).status).toBe(404);
    expect((await call(handle, "POST", "alerts", { cookie: "", body: { themeId: "btc-90000-2026", threshold: 0.5 } })).status).toBe(401);
    const created = await call(handle, "POST", "alerts", { cookie: a.cookie, body: { themeId: "btc-90000-2026", threshold: 0.5 } });
    await call(handle, "DELETE", `alerts/${created.body.id}`, { cookie: b.cookie }); // someone else's alert: no effect
    expect((await call(handle, "GET", "alerts", { cookie: a.cookie })).body.alerts).toHaveLength(1);
    expect((await call(handle, "DELETE", "alerts/not-a-uuid", { cookie: a.cookie })).status).toBe(400);
  });

  it("caps the number of active alerts", async () => {
    const { handle } = setup();
    const { cookie } = await signIn(handle);
    for (let i = 0; i < MAX_ALERTS; i++) expect((await call(handle, "POST", "alerts", { cookie, body: { themeId: "eth-5000", threshold: 0.5 } })).status).toBe(200);
    expect((await call(handle, "POST", "alerts", { cookie, body: { themeId: "eth-5000", threshold: 0.5 } })).status).toBe(409);
  });
});

describe("failure handling", () => {
  it("never leaks internal errors", async () => {
    const { handle, store } = setup();
    store.sessionWallet = async () => {
      throw new Error("connection string postgresql://user:secret@host/db");
    };
    const r = await call(handle, "GET", "auth/session", { cookie: `parallax_session=${"a".repeat(64)}` });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain("secret");
  });
});

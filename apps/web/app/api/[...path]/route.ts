import type { NextRequest } from "next/server";
import { z } from "zod";
import { liveCandles, liveHistory, liveTerminal, liveTrading, type LiveDeps } from "@/lib/live/terminal";

// Live-only mode may fetch a dozen contract checks on a cold start; allow it on serverless hosts.
export const maxDuration = 120;

const origin = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3100";
const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100";
const paths =
  /^(terminal|health|candles|themes\/[a-z0-9-]{1,120}\/history|auth\/(challenge|verify|session|logout)|watchlist(?:\/[A-Za-z0-9:_-]{1,160})?|alerts(?:\/[a-f0-9-]{36})?)$/;

// Live-only mode (devnet stage, no database): the same routes answered straight from the public sources.
const liveMode = process.env.PARALLAX_LIVE_MODE === "1";
const liveDeps: LiveDeps = {
  now: () => new Date(),
  env: process.env,
  fetcher: (url, init) =>
    fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { accept: "application/json" },
      next: { revalidate: init?.ttl ?? 30 },
    }),
};
let liveCache: { at: number; value: Promise<unknown> } | null = null;
function cachedTerminal() {
  // One in-flight build per instance; upstream responses are also cached by the platform data cache.
  if (!liveCache || Date.now() - liveCache.at > 30000) {
    const value = liveTerminal(liveDeps);
    liveCache = { at: Date.now(), value };
    value.catch(() => {
      if (liveCache?.value === value) liveCache = null;
    });
  }
  return liveCache.value;
}
const noStore = { "content-type": "application/json", "cache-control": "no-store" };

// Accounts (wallet sign-in, watchlist, in-app alerts) run serverless when a Postgres URL is configured.
// Without DATABASE_URL the live-only behaviour below is unchanged.
const accountPath = /^(auth\/(challenge|verify|session|logout)|watchlist(\/.+)?|alerts(\/.+)?)$/;
let accountHandler: ((req: Request, path: string) => Promise<Response>) | null = null;
async function account(req: NextRequest, path: string): Promise<Response> {
  if (!accountHandler) {
    const [{ createAccountHandler }, { createNeonStore }] = await Promise.all([import("@/lib/account"), import("@/lib/account-store")]);
    accountHandler = createAccountHandler({
      store: createNeonStore(process.env.DATABASE_URL as string),
      now: () => new Date(),
      allowedOrigin: (r) => process.env.WEB_ORIGIN ?? new URL(r.url).origin,
      themeExists: async (id) => ((await cachedTerminal()) as { themes: { id: string }[] }).themes.some((t) => t.id === id),
      network: process.env.SOLANA_NETWORK === "mainnet-beta" ? "mainnet" : "devnet",
      production: process.env.NODE_ENV === "production",
    });
  }
  return accountHandler(req, path);
}

async function live(req: NextRequest, path: string): Promise<Response> {
  if (process.env.DATABASE_URL && accountPath.test(path)) return account(req, path);
  if (req.method !== "GET")
    return Response.json({ error: "Not available in live-only mode (no database)" }, { status: 501, headers: noStore });
  if (path === "terminal") {
    try {
      return Response.json(await cachedTerminal(), { headers: noStore });
    } catch {
      return Response.json({ error: "Live data unavailable" }, { status: 503, headers: noStore });
    }
  }
  if (path === "health")
    return Response.json(
      { status: "degraded", mode: "live-only", postgres: false, redis: false, worker: { capturedAt: null, fresh: false },
        trading: liveTrading(process.env), telegram: { enabled: false, reason: "Live-only mode" } },
      { headers: noStore },
    );
  if (path === "auth/session") return Response.json({ authenticated: false, address: null }, { headers: noStore });
  if (path === "candles") {
    const result = await liveCandles(liveDeps, req.nextUrl.searchParams);
    return "error" in result
      ? Response.json({ error: result.error }, { status: result.status, headers: noStore })
      : Response.json(result, { headers: noStore });
  }
  const history = /^themes\/([a-z0-9-]{1,120})\/history$/.exec(path);
  if (history) {
    const data = liveHistory(history[1]!);
    return data
      ? Response.json(data, { headers: noStore })
      : Response.json({ error: "Unknown theme" }, { status: 404, headers: noStore });
  }
  return Response.json({ error: "Not available in live-only mode (no database)" }, { status: 501, headers: noStore });
}

async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const parsed = z
    .array(z.string().min(1).max(160))
    .max(4)
    .safeParse((await context.params).path);
  if (!parsed.success)
    return Response.json({ error: "Invalid path" }, { status: 400 });
  const path = parsed.data.join("/");
  if (!paths.test(path))
    return Response.json({ error: "Not found" }, { status: 404 });
  if (liveMode) return live(req, path);
  if (req.method !== "GET" && req.headers.get("origin") !== origin)
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > 16384)
    return Response.json({ error: "Body too large" }, { status: 413 });
  try {
    const body = req.method === "GET" ? undefined : await req.text();
    if (body && new TextEncoder().encode(body).length > 16384)
      return Response.json({ error: "Body too large" }, { status: 413 });
    const response = await fetch(`${api}/${path}${req.nextUrl.search}`, {
      method: req.method,
      body,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      headers: {
        "content-type": "application/json",
        origin,
        cookie: req.headers.get("cookie") ?? "",
      },
    });
    const headers = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    for (const cookie of response.headers.getSetCookie())
      headers.append("set-cookie", cookie);
    const retry = response.headers.get("retry-after");
    if (retry) headers.set("retry-after", retry);
    return new Response(await response.text(), {
      status: response.status,
      headers,
    });
  } catch {
    return Response.json(
      {
        error:
          "Research API unavailable. Check that the API and databases are running.",
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as DELETE };

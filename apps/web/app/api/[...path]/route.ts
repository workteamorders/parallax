import type { NextRequest } from "next/server";
import { z } from "zod";

const origin = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3100";
const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100";
const paths =
  /^(terminal|health|candles|themes\/[a-z0-9-]{1,120}\/history|auth\/(challenge|verify|session|logout)|watchlist(?:\/[A-Za-z0-9:_-]{1,160})?|alerts(?:\/[a-f0-9-]{36})?)$/;

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

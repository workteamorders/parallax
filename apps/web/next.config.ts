import type { NextConfig } from "next";

// Devnet test trading talks to a devnet RPC straight from the browser (https for reads/sends, wss for
// subscriptions). Both origins are derived from one setting so CSP and the client cannot drift apart.
const rpcUrl = new URL(process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com");
const rpcConnect = `${rpcUrl.origin} ${rpcUrl.protocol === "https:" ? "wss:" : "ws:"}//${rpcUrl.host}`;

// "off" disables the browser feed (live-only hosting); keep a valid URL for the CSP either way.
const feedSetting = process.env.NEXT_PUBLIC_FEED_URL;
const feedUrl = !feedSetting || feedSetting === "off" ? "ws://127.0.0.1:4100/feed" : feedSetting;

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ["@parallax/shared"],
  poweredByHeader: false,
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/empty-module.ts" },
      net: { browser: "./lib/empty-module.ts" },
      tls: { browser: "./lib/empty-module.ts" },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'${
              process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
            }; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' ws://127.0.0.1:3100 ${rpcConnect} ${
              new URL(
                feedUrl,
              ).origin
            }; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`,
          },
        ],
      },
    ];
  },
};
export default nextConfig;

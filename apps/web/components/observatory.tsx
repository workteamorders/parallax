"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useId, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Clock3,
  Command,
  ExternalLink,
  Globe2,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Wallet,
  Waves,
  X,
  Zap,
} from "lucide-react";
import type { Candle, Perp, Theme, ThemeHistory } from "@parallax/shared";
import { useObservatory, request } from "./provider";
import { RiftExplorer } from "./rift-explorer";
import { DevnetTicket } from "./devnet-ticket";
import {
  linePath,
  number,
  pct,
  shortDate,
  signed,
  time,
  usd,
} from "@/lib/format";

const navigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard, page: "overview" },
  { href: "/markets", label: "Markets", icon: Layers3, page: "markets" },
  { href: "/signals", label: "Signals", icon: Activity, page: "signals" },
  { href: "/portfolio", label: "Portfolio", icon: Wallet, page: "portfolio" },
  { href: "/alerts", label: "Watchlist & Alerts", icon: Bell, page: "alerts" },
];
const pageTitles: Record<string, string> = {
  overview: "Overview",
  markets: "Market Explorer",
  signals: "Signal Feed",
  portfolio: "Portfolio",
  alerts: "Watchlist & Alerts",
  theme: "Theme Intelligence",
  legal: "Legal & Disclosures",
};

function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? "small" : ""}`}>
      <svg width="30" height="32" viewBox="0 0 30 32" aria-hidden="true">
        <path d="M1 24 10 4h8L9 24zm12 4L23 6h6L19 28z" fill="currentColor" />
      </svg>
      {!small && (
        <span>
          parallax<span className="logo-period">.</span>
        </span>
      )}
    </span>
  );
}
function displayTitle(theme: Theme) {
  const [question, strike] = theme.title.split(": ");
  return question.includes("___") && strike
    ? question.replace("___", `$${strike}`)
    : theme.title;
}
function Asset({
  symbol,
  small = false,
}: {
  symbol: string | null;
  small?: boolean;
}) {
  const asset = symbol?.split("-")[0] ?? "?";
  return (
    <span
      className={`asset-icon asset-${asset.toLowerCase()} ${
        small ? "small" : ""
      }`}
      aria-hidden="true"
    >
      {asset === "SOL" ? (
        <svg viewBox="0 0 24 24">
          <path
            d="m5 5 14 0-3 3H2zm0 6h14l3 3H8zm0 6h14l-3 3H2z"
            fill="currentColor"
          />
        </svg>
      ) : asset === "BTC" ? (
        "₿"
      ) : asset === "ETH" ? (
        "Ξ"
      ) : (
        asset.slice(0, 1)
      )}
    </span>
  );
}
function Stamp({ status = "approved" }: { status?: Theme["reviewStatus"] }) {
  return (
    <span className={`stamp ${status}`}>
      {status === "approved" ? (
        <ShieldCheck size={11} />
      ) : (
        <CircleHelp size={11} />
      )}
      {status === "approved"
        ? "Reviewed"
        : status === "candidate"
        ? "Needs Review"
        : "Archived"}
    </span>
  );
}
function Empty({
  title,
  children,
  icon = <Waves size={30} />,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Observatory({ page, slug }: { page: string; slug?: string }) {
  const {
    data,
    loading,
    error,
    feed,
    refresh,
    openWallet,
    address,
    walletAddress,
  } = useObservatory();
  const shownAddress = address ?? walletAddress;
  const [search, setSearch] = useState("");
  const [help, setHelp] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const theme = data?.themes.find((t) => t.slug === slug);
  const healthy =
    data?.health
      .filter((h) => ["polymarket", "velocity"].includes(h.venue))
      .every((h) => h.status === "healthy") ?? false;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
      if (e.key === "Escape") {
        setHelp(false);
        setHealthOpen(false);
        setMobileNav(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className={`app-shell ${page === "overview" ? "rift-home" : ""}`}>
      <header className="rift-nav">
        <div className="rift-nav-inner">
          <Link className="rift-brand" href="/" aria-label="Parallax home">
            <Logo />
            <span className="rift-brand-sub">THE RIFT</span>
          </Link>
          <nav
            className={`rift-links ${mobileNav ? "open" : ""}`}
            aria-label="Main navigation"
          >
            {navigation.map((item) => (
              <Link
                key={item.page}
                href={item.href}
                onClick={() => setMobileNav(false)}
                className={page === item.page ? "active" : ""}
                aria-current={page === item.page ? "page" : undefined}
              >
                {item.page === "overview"
                  ? "Explore"
                  : item.page === "alerts"
                  ? "Watchlist"
                  : item.label}
                {item.page === "signals" && (
                  <span className="rift-signal-count">
                    {data?.signals.length ?? 0}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <button
            className="rift-connection"
            aria-label="Data connections"
            onClick={() => setHealthOpen((v) => !v)}
          >
            <span className={`status-dot ${healthy ? "" : "amber"}`} />
            <span>Public feeds</span>
          </button>
          <span className="network-badge">
            {data?.trading.network === "mainnet-beta" ? "MAINNET" : "DEVNET"}
          </span>
          <button className="wallet-button" onClick={openWallet}>
            <Wallet size={14} />
            {shownAddress
              ? `${shownAddress.slice(0, 4)}…${shownAddress.slice(-4)}`
              : "Connect Wallet"}
          </button>
          <button
            className="rift-menu"
            aria-label="Toggle navigation"
            aria-expanded={mobileNav}
            onClick={() => setMobileNav((v) => !v)}
          >
            {mobileNav ? <X size={22} /> : <Layers3 size={22} />}
          </button>
        </div>
      </header>
      <div className="workspace">
        <main id="main" className={`main-content page-${page}`}>
          {error && (
            <div className="error-banner" role="alert">
              <Radio size={16} />
              <span>{error}</span>
              <button onClick={() => void refresh()}>
                Reconnect <RefreshCw size={13} />
              </button>
            </div>
          )}
          {page !== "theme" && page !== "legal" && page !== "overview" && (
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  <span className="tiny-cross">+</span>{" "}
                  {page === "overview"
                    ? "A DIFFERENT ANGLE ON THE MARKET"
                    : `PARALLAX / ${pageTitles[page]?.toUpperCase()}`}
                </p>
                <h1>
                  {page === "overview" ? (
                    <>
                      See the <span>disconnect.</span>
                    </>
                  ) : page === "markets" ? (
                    <>
                      Every market.
                      <br className="mobile-only" />{" "}
                      <span>A new perspective.</span>
                    </>
                  ) : page === "signals" ? (
                    <>
                      When markets <span>disagree.</span>
                    </>
                  ) : page === "portfolio" ? (
                    <>
                      Your positions.
                      <br className="mobile-only" />{" "}
                      <span>In perspective.</span>
                    </>
                  ) : (
                    <>
                      Keep an eye <span>on what matters.</span>
                    </>
                  )}
                </h1>
                <p className="page-subtitle">
                  {page === "overview"
                    ? "Prediction markets meet perpetuals. Find the story between the two."
                    : page === "markets"
                    ? "Explore reviewed event contracts and their related perpetual markets."
                    : page === "signals"
                    ? "Statistical divergence, with the context to understand it. Never a trading recommendation."
                    : page === "portfolio"
                    ? "A non-custodial view of your Solana perpetual exposure."
                    : "A personal research desk for the events you follow."}
                </p>
              </div>
              <button
                className="update-button"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  await refresh();
                  setRefreshing(false);
                }}
              >
                <RefreshCw size={13} className={refreshing ? "spin" : ""} />
                {data ? "Refresh data" : "Connect feed"}
              </button>
            </div>
          )}
          {loading && page !== "overview" ? (
            <div
              className="loading-layout"
              aria-busy="true"
              aria-label="Loading live research"
            >
              <div className="skeleton skeleton-strip" />
              <div className="skeleton skeleton-feature" />
              <div className="skeleton skeleton-table" />
            </div>
          ) : (
            <>
              {page === "overview" && (
                <RiftExplorer
                  query={deferredSearch}
                  onQuery={setSearch}
                  onHelp={() => setHelp(true)}
                  renderAnalysis={(selected) => <Featured theme={selected} />}
                  renderTable={() => (
                    <ThemeTable
                      query={deferredSearch}
                      onQuery={setSearch}
                      limit={8}
                    />
                  )}
                  renderSignals={() => <SignalSummary />}
                />
              )}
              {page === "markets" && (
                <>
                  <MarketStrip />
                  <ThemeTable query={deferredSearch} onQuery={setSearch} />
                </>
              )}
              {page === "signals" && <SignalsPage />}
              {page === "theme" &&
                (theme ? (
                  <ThemePage theme={theme} />
                ) : (
                  <section className="panel">
                    <Empty title="Theme not found.">
                      This mapping has not been ingested.{" "}
                      <Link href="/markets">
                        Explore verified markets instead.
                      </Link>
                    </Empty>
                  </section>
                ))}
              {page === "portfolio" && <Portfolio />}
              {page === "alerts" && <Alerts />}
              {page === "legal" && <Legal document={slug ?? "risk"} />}
            </>
          )}
          <footer className="page-footer">
            <span>
              <ShieldCheck size={12} /> Research only. Not financial advice.
            </span>
            <span>
              <Link href="/legal/risk">Risk</Link>
              <Link href="/legal/terms">Terms</Link>
              <Link href="/legal/privacy">Privacy</Link>
              <span className="footer-mark">PARALLAX © 2026</span>
            </span>
          </footer>
        </main>
        <div className="statusbar">
          <button onClick={() => setHealthOpen((v) => !v)}>
            <span
              className={`status-dot ${feed === "connected" ? "" : "amber"}`}
            />
            {process.env.NEXT_PUBLIC_FEED_URL === "off"
              ? "Refreshing every 30s"
              : feed === "connected"
                ? "Feed connected"
                : "Feed reconnecting"}
          </button>
          <span className="statusbar-separator" />
          <span>
            Market data: mainnet
            <span className="statusbar-detail">
              {" "}
              · Execution preference: {data?.trading.network ?? "unavailable"}
            </span>
          </span>
          <span className="statusbar-right">
            {data
              ? `${process.env.NEXT_PUBLIC_FEED_URL === "off" ? "Live fetch" : "Last ingestion"} ${time(data.capturedAt)} UTC`
              : "Awaiting ingestion"}
            <span className="statusbar-separator" />
            READ-ONLY
          </span>
        </div>
      </div>
      {help && (
        <div
          className="info-popover"
          role="region"
          aria-label="Parallax methodology"
        >
          <button
            className="icon-button popover-close"
            onClick={() => setHelp(false)}
            aria-label="Close methodology"
          >
            <X size={18} />
          </button>
          <p className="eyebrow">THE PARALLAX METHOD</p>
          <h2>
            Look at the space
            <br />
            between markets.
          </h2>
          <p>
            We connect a reviewed prediction contract to a related perpetual.
            Each keeps its own price scale and resolution rules.
          </p>
          <ol>
            <li>
              <strong>Read the event.</strong> Inspect the precise outcome,
              source, and expiry.
            </li>
            <li>
              <strong>Compare the movement.</strong> A shared timeline, never a
              shared price scale.
            </li>
            <li>
              <strong>Understand the gap.</strong> Signals require sufficient
              historical data and are not proof of causality.
            </li>
          </ol>
          <Link
            className="text-link"
            href="/legal/risk"
            onClick={() => setHelp(false)}
          >
            Read the risks <ArrowUpRight size={14} />
          </Link>
        </div>
      )}
      {healthOpen && (
        <div
          className="health-popover"
          role="region"
          aria-label="Data connection health"
        >
          <div className="section-heading">
            <h3>Data Connections</h3>
            <button
              className="icon-button"
              aria-label="Close data connections"
              onClick={() => setHealthOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          {data?.health.map((h) => (
            <div className="health-item" key={h.venue}>
              <div>
                <span
                  className={`status-dot ${
                    h.status === "healthy" ? "" : "amber"
                  }`}
                />
                <strong>{h.venue}</strong>
                <span className="mono">{h.status}</span>
              </div>
              <p>{h.message}</p>
            </div>
          )) ?? <p>No health checks available.</p>}
        </div>
      )}
    </div>
  );
}

function MarketStrip() {
  const { data } = useObservatory();
  return (
    <section className="market-strip" aria-label="Discovered perpetual prices">
      <div className="strip-intro">
        <span className="eyebrow">THE OTHER SIDE</span>
        <span>
          Solana perpetuals <ArrowUpRight size={13} />
        </span>
      </div>
      {data?.perps.map((p) => (
        <div className="strip-market" key={p.symbol}>
          <Asset symbol={p.symbol} small />
          <div>
            <span className="strip-symbol">{p.symbol}</span>
            <div>
              <strong>{usd(p.mark)}</strong>
              <span
                className={`change ${
                  (p.change24h ?? 0) >= 0 ? "positive" : "negative"
                }`}
              >
                {signed(p.change24h)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function Featured({ theme }: { theme: Theme }) {
  const { data } = useObservatory();
  const perp = data?.perps.find((p) => p.symbol === theme.perpSymbol);
  return (
    <section className="panel featured-panel">
      <div className="panel-kicker">
        <span>
          <span className="live-bracket">[</span> IN FOCUS{" "}
          <span className="live-bracket">]</span>
        </span>
        <Stamp status={theme.reviewStatus} />
      </div>
      <div className="feature-title">
        <Asset symbol={theme.perpSymbol} />
        <div>
          <span className="eyebrow">EVENT ↔ PERPETUAL</span>
          <Link href={`/t/${theme.slug}`}>
            <h2>{displayTitle(theme)}</h2>
            <ArrowUpRight size={20} />
          </Link>
        </div>
      </div>
      <div className="feature-metrics">
        <div>
          <span className="label">
            EVENT PROBABILITY <span className="micro-pill">YES</span>
          </span>
          <strong className="odds-number">
            {pct(theme.markets[0]?.yesMid)}
          </strong>
          <span className="metric-foot">
            Polymarket <span className="source-dot" /> via Jupiter
          </span>
        </div>
        <div className="metric-link" aria-hidden="true">
          <span />
          <Waves size={23} />
          <span />
        </div>
        <div>
          <span className="label">{perp?.symbol ?? "RELATED PERPETUAL"}</span>
          <strong>
            {usd(perp?.mark)}
            <span
              className={`change ${
                (perp?.change24h ?? 0) >= 0 ? "positive" : "negative"
              }`}
            >
              {signed(perp?.change24h)}
            </span>
          </strong>
          <span className="metric-foot">
            Velocity <span className="source-dot" /> 24h change
          </span>
        </div>
      </div>
      <LinkedChart theme={theme} compact />
      <div className="featured-footer">
        <span>
          <Clock3 size={12} /> Closes{" "}
          {shortDate(theme.markets[0]?.closeTime ?? null)}{" "}
          <span className="muted">· Single venue</span>
        </span>
        <Link href={`/t/${theme.slug}`} className="text-link">
          Explore theme <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}

function SignalSummary() {
  const { data } = useObservatory();
  return (
    <aside className="panel signal-summary">
      <div className="panel-kicker">
        <span>
          <Activity size={14} /> SIGNAL RADAR
        </span>
        <Link href="/signals" aria-label="Open signal feed">
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="radar" aria-hidden="true">
        <div className="radar-ring ring-one" />
        <div className="radar-ring ring-two" />
        <div className="radar-ring ring-three" />
        <span className="radar-axis horizontal" />
        <span className="radar-axis vertical" />
        <div className="radar-sweep" />
        <span className="radar-center" />
        <span className="radar-label">SCANNING FOR DIVERGENCE</span>
      </div>
      <div className="radar-state">
        <span className="status-dot" />
        <span>
          {data?.signals.length
            ? `${data.signals.length} divergence observations`
            : "Building the baseline"}
        </span>
      </div>
      <h3>
        {data?.signals.length
          ? "A different reaction."
          : "Good signals take context."}
      </h3>
      <p>
        {data?.signals.length
          ? "Inspect the probability movement and perp response behind each observation."
          : process.env.NEXT_PUBLIC_FEED_URL === "off"
            ? "Live-only mode stores no odds or price history, so no signals are computed. Run the full backend to collect history."
            : "Collecting actual odds and price history. Signals appear only when the evidence is sufficient."}
      </p>
      <div className="signal-legend">
        <div>
          <span className="legend-marker odds-marker" />
          <span>Odds lead</span>
          <span>EVENT → PERP</span>
        </div>
        <div>
          <span className="legend-marker perp-marker" />
          <span>Perp lead</span>
          <span>PERP → EVENT</span>
        </div>
      </div>
      <Link href="/signals" className="signal-link">
        Understand the signals <ArrowUpRight size={14} />
      </Link>
    </aside>
  );
}

function LinkedChart({
  theme,
  compact = false,
}: {
  theme: Theme;
  compact?: boolean;
}) {
  const [range, setRange] = useState("24H");
  const [result, setResult] = useState<{
    key: string;
    candles: Candle[];
    history: ThemeHistory;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId().replace(/:/g, "");
  const key = `${theme.slug}:${range}`;
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [c, h] = await Promise.all([
          theme.perpSymbol
            ? request<{ candles: Candle[] }>(
                `candles?symbol=${encodeURIComponent(
                  theme.perpSymbol,
                )}&resolution=60&limit=${range === "24H" ? 24 : 168}`,
              )
            : Promise.resolve({ candles: [] }),
          request<ThemeHistory>(`themes/${theme.slug}/history`),
        ]);
        if (active) {
          setResult({ key, candles: c.candles, history: h });
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    }
    void load();
    const interval = setInterval(() => void load(), 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [theme.slug, theme.perpSymbol, range, key]);
  const current = result?.key === key ? result : null;
  const candles = [...(current?.candles ?? [])].sort((a, b) => a.ts - b.ts);
  const rawPerps = candles.map((c) => ({ ts: c.ts, value: c.close }));
  const rawOdds = current?.history.probability ?? [];
  const max = Math.max(
    ...rawPerps.map((p) => p.ts),
    ...rawOdds.map((p) => p.ts),
    0,
  );
  const min = max - (range === "24H" ? 86400 : 7 * 86400);
  const perpPoints = rawPerps.filter((p) => p.ts >= min && p.ts <= max);
  const odds = rawOdds
    .filter((p) => p.ts >= min && p.ts <= max)
    .map((p) => ({
      ...p,
      value: theme.direction === -1 ? 1 - p.value : p.value,
    }));
  const domain: [number, number] = [min, max || 1];
  const oddsPath = linePath(odds, 700, 85, domain, [0, 1]);
  const perpPath = linePath(perpPoints, 700, 130, domain);
  const hoverTime = hover == null ? null : min + (max - min) * hover;
  const point =
    hoverTime == null
      ? null
      : perpPoints.reduce<(typeof perpPoints)[number] | null>(
          (nearest, p) =>
            !nearest ||
            Math.abs(p.ts - hoverTime) < Math.abs(nearest.ts - hoverTime)
              ? p
              : nearest,
          null,
        );
  return (
    <div className={`linked-chart ${compact ? "compact" : ""}`}>
      <div className="chart-toolbar">
        <span>
          <span className="legend-dot lime" /> Event odds{" "}
          <span className="legend-dot grey" /> Perp price
        </span>
        <div className="chart-ranges" aria-label="Chart history window">
          {["24H", "7D"].map((r) => (
            <button
              className={range === r ? "active" : ""}
              key={r}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div
        className="chart-area"
        onPointerMove={(e) => {
          const bounds = e.currentTarget.getBoundingClientRect();
          setHover((e.clientX - bounds.left) / bounds.width);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {!current && !failed ? (
          <div className="chart-loading">
            <RefreshCw size={16} className="spin" /> Loading actual history
          </div>
        ) : failed ? (
          <div className="chart-loading">
            History temporarily unavailable. No sample data substituted.
          </div>
        ) : (
          <>
            <div className="chart-track-label">
              <span>PROBABILITY</span>
              <span>100%</span>
            </div>
            <svg
              viewBox="0 0 700 85"
              preserveAspectRatio="none"
              className="odds-chart"
              role="img"
              aria-label="Actual YES probability history from ingestion, fixed zero to one scale"
            >
              {[16, 42, 69].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="700"
                  y1={y}
                  y2={y}
                  className="chart-grid"
                />
              ))}
              {odds.length > 1 && <path d={oddsPath} className="odds-line" />}
              {odds.length === 1 && (
                <circle
                  cx={16 + ((odds[0].ts - min) / (max - min || 1)) * 668}
                  cy={67 - odds[0].value * 49}
                  r="3"
                  fill="var(--accent)"
                />
              )}
            </svg>
            {odds.length < 2 && (
              <span className="history-label">
                {odds.length
                  ? "First observation captured. History starts here."
                  : "Waiting for verified odds observations."}
              </span>
            )}
            <div className="chart-track-label second">
              <span>PERPETUAL / {theme.perpSymbol ?? "UNMAPPED"}</span>
              <span>{usd(point?.value ?? perpPoints.at(-1)?.value)} CLOSE</span>
            </div>
            <svg
              viewBox="0 0 700 130"
              preserveAspectRatio="none"
              className="perp-chart"
              role="img"
              aria-label="Actual hourly perpetual trade close prices in USD"
            >
              <defs>
                <linearGradient
                  id={`${gradient}perp`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#b8c3b5" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#b8c3b5" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[18, 60, 112].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="700"
                  y1={y}
                  y2={y}
                  className="chart-grid"
                />
              ))}
              {perpPoints.length > 1 && (
                <>
                  <path
                    d={`${perpPath} L${
                      16 + ((perpPoints.at(-1)!.ts - min) / (max - min)) * 668
                    },130 L${
                      16 + ((perpPoints[0].ts - min) / (max - min)) * 668
                    },130 Z`}
                    fill={`url(#${gradient}perp)`}
                  />
                  <path d={perpPath} className="perp-line" />
                </>
              )}
            </svg>
            {!perpPoints.length && (
              <span className="unmapped-label">
                No verified perpetual mapping.
              </span>
            )}
            {hover != null && point && (
              <div
                className="chart-crosshair"
                style={{ left: `${Math.max(1, Math.min(99, hover * 100))}%` }}
              >
                <span>
                  {time(point.ts)} UTC · {usd(point.value)}
                </span>
              </div>
            )}
            <div className="chart-time-axis">
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <span key={t}>
                  {max
                    ? range === "7D"
                      ? shortDate(
                          new Date(
                            (min + (max - min) * t) * 1000,
                          ).toISOString(),
                        )
                      : time(min + (max - min) * t)
                    : "--:--"}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="chart-disclosure">
        <span>SHARED TIME AXIS</span>
        <span>Independent scales · No synthetic history</span>
      </div>
    </div>
  );
}

function ThemeTable({
  query,
  onQuery,
  limit,
}: {
  query: string;
  onQuery: (s: string) => void;
  limit?: number;
}) {
  const { data, watched, toggleWatch } = useObservatory();
  const [tab, setTab] = useState("All Themes");
  const [asset, setAsset] = useState("all");
  const [sort, setSort] = useState("review");
  const [reviewOnly, setReviewOnly] = useState(false);
  const themes = (data?.themes ?? [])
    .filter(
      (t) =>
        t.reviewStatus !== "rejected" &&
        (!reviewOnly || t.reviewStatus === "approved") &&
        (tab !== "Watchlist" || watched.includes(t.id)) &&
        (asset === "all" || t.perpSymbol === asset) &&
        `${t.title} ${t.tags.join(" ")} ${t.perpSymbol}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "probability"
        ? (b.markets[0]?.yesMid ?? -1) - (a.markets[0]?.yesMid ?? -1)
        : sort === "expiry"
        ? (a.markets[0]?.closeTime ?? "").localeCompare(
            b.markets[0]?.closeTime ?? "",
          )
        : sort === "spread"
        ? (b.markets[0]?.yesAsk ?? 0) -
          (b.markets[0]?.yesBid ?? 0) -
          ((a.markets[0]?.yesAsk ?? 0) - (a.markets[0]?.yesBid ?? 0))
        : sort === "volume"
        ? (b.volume24h ?? -1) - (a.volume24h ?? -1)
        : Number(b.reviewStatus === "approved") -
          Number(a.reviewStatus === "approved"),
    );
  const shown = limit ? themes.slice(0, limit) : themes;
  return (
    <section className="panel theme-table-panel">
      <div className="table-toolbar">
        <div className="table-tabs">
          {["All Themes", "Watchlist"].map((t) => (
            <button
              className={tab === t ? "active" : ""}
              key={t}
              onClick={() => setTab(t)}
            >
              {t === "Watchlist" && <Star size={12} />}
              {t}
            </button>
          ))}
        </div>
        <div className="table-tools">
          <label className="search-field">
            <Search size={14} />
            <input
              id="global-search"
              aria-label="Search themes"
              placeholder="Search themes..."
              value={query}
              onChange={(e) => onQuery(e.target.value)}
            />
            <span>
              <Command size={10} /> K
            </span>
          </label>
          <label className="select-wrap">
            <select
              aria-label="Filter by linked asset"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
            >
              <option value="all">All assets</option>
              {data?.perps.map((p) => (
                <option key={p.symbol} value={p.symbol}>
                  {p.baseAsset}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
          <button
            className={`icon-button filter-toggle ${
              reviewOnly ? "selected" : ""
            }`}
            aria-label="Only reviewed themes"
            aria-pressed={reviewOnly}
            onClick={() => setReviewOnly((v) => !v)}
          >
            <SlidersHorizontal size={15} />
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="star-cell">
                <Star size={11} />
              </th>
              <th>THEME / EVENT</th>
              <th>
                <button
                  onClick={() =>
                    setSort(sort === "probability" ? "review" : "probability")
                  }
                >
                  YES ODDS <ArrowDown size={10} />
                </button>
              </th>
              <th>LINKED PERP</th>
              <th>
                <button
                  onClick={() =>
                    setSort(sort === "spread" ? "review" : "spread")
                  }
                >
                  BID / ASK <ArrowDown size={10} />
                </button>
              </th>
              <th>
                <button
                  onClick={() =>
                    setSort(sort === "expiry" ? "review" : "expiry")
                  }
                >
                  CLOSES <ArrowDown size={10} />
                </button>
              </th>
              <th>CONTEXT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const m = t.markets[0];
              return (
                <tr key={t.id}>
                  <td className="star-cell">
                    <button
                      className={`star-button ${
                        watched.includes(t.id) ? "saved" : ""
                      }`}
                      aria-label={`${
                        watched.includes(t.id) ? "Unwatch" : "Watch"
                      } ${displayTitle(t)}`}
                      onClick={() => void toggleWatch(t.id)}
                    >
                      <Star
                        size={14}
                        fill={watched.includes(t.id) ? "currentColor" : "none"}
                      />
                    </button>
                  </td>
                  <td className="theme-cell">
                    <Link href={`/t/${t.slug}`}>
                      <Asset symbol={t.perpSymbol} small />
                      <span>
                        <strong>{displayTitle(t)}</strong>
                        <small>
                          <span className="venue-mark">P</span> Polymarket{" "}
                          <span>·</span> {t.markets.length} venue <span>·</span>{" "}
                          <Stamp status={t.reviewStatus} />
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td className="probability-cell">
                    <span>{pct(m?.yesMid)}</span>
                    <div className="probability-bar">
                      <i style={{ width: `${(m?.yesMid ?? 0) * 100}%` }} />
                    </div>
                  </td>
                  <td>
                    <span
                      className={`perp-tag ${!t.perpSymbol ? "muted" : ""}`}
                    >
                      {t.perpSymbol ?? "Unmapped"}
                    </span>
                  </td>
                  <td className="mono quote-cell">
                    {m?.yesBid == null
                      ? "--"
                      : `${(m.yesBid * 100).toFixed(1)}¢`}{" "}
                    <span>/</span>{" "}
                    {m?.yesAsk == null
                      ? "--"
                      : `${(m.yesAsk * 100).toFixed(1)}¢`}
                  </td>
                  <td className="mono expiry-cell">
                    {shortDate(m?.closeTime ?? null)}
                  </td>
                  <td>
                    <span
                      className={`context-tag ${
                        t.reviewStatus === "approved" ? "" : "candidate"
                      }`}
                    >
                      {t.reviewStatus === "approved" ? (
                        <>
                          <span className="tiny-dot" />{" "}
                          {m?.yesMid == null
                            ? "No fresh quote"
                            : process.env.NEXT_PUBLIC_FEED_URL === "off"
                              ? "Live quote"
                              : "Collecting"}
                        </>
                      ) : (
                        "Unverified"
                      )}
                    </span>
                  </td>
                  <td>
                    <Link
                      href={`/t/${t.slug}`}
                      className="row-arrow"
                      aria-label={`Explore ${displayTitle(t)}`}
                    >
                      <ArrowUpRight size={16} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!shown.length && (
        <Empty title="No themes in this view.">
          Try another search or asset filter. Saved themes appear after wallet
          sign-in.
        </Empty>
      )}
      <div className="table-footer">
        <span>
          Showing {shown.length} of {themes.length} themes{" "}
          <span className="muted">
            · Contract volume unavailable; not inferred from event totals
          </span>
        </span>
        <label>
          Sort by{" "}
          <select
            aria-label="Sort themes"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="review">Review status</option>
            <option value="probability">YES probability</option>
            <option value="spread">Quote width</option>
            <option value="expiry">Expiry</option>
            <option value="volume">24h volume (if available)</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function ThemePage({ theme }: { theme: Theme }) {
  const { data, watched, toggleWatch, notify } = useObservatory();
  const perp = data?.perps.find((p) => p.symbol === theme.perpSymbol);
  const [tab, setTab] = useState("Resolution Rules");
  return (
    <>
      <div className="theme-top">
        <Link href="/markets" className="text-link">
          <ArrowLeft size={14} /> All markets
        </Link>
        <span className="eyebrow">EVENT INTELLIGENCE / SINGLE VENUE</span>
      </div>
      <div className="theme-heading">
        <Asset symbol={theme.perpSymbol} />
        <div>
          <div className="theme-heading-meta">
            <Stamp status={theme.reviewStatus} />
            <span className="mono">
              Closes {shortDate(theme.markets[0]?.closeTime ?? null)} UTC
            </span>
          </div>
          <h1>{displayTitle(theme)}</h1>
        </div>
        <button
          className={`button secondary watch-theme ${
            watched.includes(theme.id) ? "selected" : ""
          }`}
          onClick={() => void toggleWatch(theme.id)}
        >
          <Star
            size={14}
            fill={watched.includes(theme.id) ? "currentColor" : "none"}
          />
          {watched.includes(theme.id) ? "Watching" : "Watch Theme"}
        </button>
      </div>
      <div className="research-notice">
        <ShieldCheck size={14} />
        <span>
          {theme.reviewStatus === "approved"
            ? "Reviewed directional relationship, not settlement equivalence. Not financial advice."
            : "Mapping not approved. No directional signal or equivalent market is claimed. Not financial advice."}
        </span>
        <button
          onClick={() => {
            void navigator.clipboard
              ?.writeText(window.location.href)
              .then(() => notify("Theme link copied."))
              .catch(() => notify("Could not copy the theme link."));
          }}
        >
          Share <ExternalLink size={12} />
        </button>
      </div>
      <div className="theme-workspace">
        <section className="panel event-panel">
          <div className="panel-kicker">
            <span>01 / EVENT PRICING</span>
            <BookOpen size={14} />
          </div>
          {theme.markets.map((m) => (
            <div className="venue-quote" key={m.venueMarketId}>
              <div className="venue-title">
                <span className="venue-mark large">
                  {m.venue === "polymarket" ? "P" : "K"}
                </span>
                <strong>
                  {m.venue === "polymarket" ? "Polymarket" : "Kalshi"}
                </strong>
                <span className="micro-pill">YES</span>
              </div>
              <strong className="large-odds">{pct(m.yesMid)}</strong>
              <div className="odds-rail">
                <span style={{ width: `${(m.yesMid ?? 0) * 100}%` }} />
              </div>
              <dl>
                <div>
                  <dt>Best bid</dt>
                  <dd>{pct(m.yesBid)}</dd>
                </div>
                <div>
                  <dt>Best ask</dt>
                  <dd>{pct(m.yesAsk)}</dd>
                </div>
                <div>
                  <dt>24h volume</dt>
                  <dd>{usd(m.volume24h, true)}</dd>
                </div>
                <div>
                  <dt>Liquidity</dt>
                  <dd>{usd(m.liquidity, true)}</dd>
                </div>
              </dl>
              <span className="quote-provenance">
                via {m.transport.includes("jup") ? "Jupiter" : m.transport} ·{" "}
                {time(m.capturedAt)} UTC
              </span>
            </div>
          ))}
          <div className="venue-unavailable">
            <span className="venue-mark">K</span>
            <div>
              <strong>Kalshi</strong>
              <p>No reviewed equivalent</p>
            </div>
            <LockKeyhole size={14} />
          </div>
          <div className="spread-state">
            <span className="label">CROSS-VENUE SPREAD</span>
            <strong>Not available</strong>
            <p>
              Requires two independently reviewed, equivalent contracts. Venue
              fees are not included in spread calculations.
            </p>
          </div>
        </section>
        <section className="panel timeline-panel">
          <div className="panel-kicker">
            <span>02 / THE RELATIONSHIP</span>
            <span className="mono">
              {theme.reviewStatus !== "approved"
                ? "DIRECTION UNREVIEWED"
                : theme.direction === 1
                ? "YES → BULLISH"
                : "YES → BEARISH"}
            </span>
          </div>
          <div className="timeline-heading">
            <h2>
              Different markets.
              <br />
              <span>One shared timeline.</span>
            </h2>
            <Waves size={26} strokeWidth={1} />
          </div>
          <LinkedChart theme={theme} />
          {perp && (
            <div className="perp-context">
              <div>
                <span className="label">ORACLE PRICE</span>
                <strong>{usd(perp.oracle)}</strong>
                <small>{perp.quoteAsset} quote asset</small>
              </div>
              <div>
                <span className="label">OPEN INTEREST</span>
                <strong>
                  {number(perp.openInterestLong)} /{" "}
                  {number(Math.abs(perp.openInterestShort))}
                </strong>
                <small>Long / short · {perp.baseAsset}</small>
              </div>
              <div>
                <span className="label">FUNDING / RAW SOURCE</span>
                <strong>
                  {perp.fundingLong} / {perp.fundingShort}
                </strong>
                <small>Long / short · units unverified</small>
              </div>
            </div>
          )}
          <div className="timeline-notice">
            <Clock3 size={15} />
            <p>
              <strong>Observation, not prediction.</strong> Signals need a
              60-minute window and at least 30 prior observations. Missing
              history is never backfilled with simulated odds.
            </p>
          </div>
        </section>
        <TradePanel perp={perp} />
      </div>
      {data?.trading.enabled && <DevnetTicket perp={perp} />}
      <section className="panel rules-panel">
        <div className="detail-tabs">
          {["Resolution Rules", "Signal History", "Mapping Review"].map((t) => (
            <button
              key={t}
              className={t === tab ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "Resolution Rules" ? (
          <>
            <div className="rules-intro">
              <div>
                <p className="eyebrow">SAME EVENT?</p>
                <h2>The details decide the outcome.</h2>
              </div>
              <span className="stamp candidate">
                Risk: Not assessed across venues
              </span>
            </div>
            <div className="rules-grid">
              <div>
                <div className="section-heading">
                  <h3>Polymarket</h3>
                  <a
                    href={theme.markets[0]?.source}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link"
                  >
                    View source <ArrowUpRight size={13} />
                  </a>
                </div>
                <p className="rules-text">
                  {theme.markets[0]?.rules || "Resolution rules not available."}
                </p>
              </div>
              <div className="rules-missing">
                <BookOpen size={27} strokeWidth={1} />
                <h3>A second perspective is not yet verified.</h3>
                <p>
                  No Kalshi contract has been approved as equivalent.
                  Close-time, source, and threshold differences cannot be
                  assessed without both rule sets.
                </p>
              </div>
            </div>
          </>
        ) : tab === "Mapping Review" ? (
          <div className="mapping-review">
            <Stamp status={theme.reviewStatus} />
            <h3>Why this contract is mapped this way</h3>
            <p>{theme.reviewNote}</p>
            <dl>
              <div>
                <dt>Direction of YES</dt>
                <dd>
                  {theme.reviewStatus === "approved"
                    ? theme.direction === 1
                      ? "Bullish"
                      : "Bearish"
                    : "Not approved"}
                </dd>
              </div>
              <div>
                <dt>Linked perpetual</dt>
                <dd>{theme.perpSymbol ?? "None approved"}</dd>
              </div>
              <div>
                <dt>Independent prediction venues</dt>
                <dd>{new Set(theme.markets.map((m) => m.venue)).size}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <SignalItems themeId={theme.id} />
        )}
      </section>
    </>
  );
}

function TradePanel({ perp }: { perp?: Perp }) {
  const { data } = useObservatory();
  const [side, setSide] = useState("Long");
  const [mode, setMode] = useState("Market");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [preview, setPreview] = useState(false);
  const amount = Number(size);
  const orderPrice = mode === "Limit" ? Number(price) : perp?.mark ?? 0;
  const notional =
    amount > 0 && Number.isFinite(amount) && orderPrice > 0
      ? amount * orderPrice
      : null;
  const fee = data?.trading.builderFeeTenthsBp ?? 20;
  return (
    <section className="panel trade-panel" id="trade-ticket" data-no-cursor-fx="">
      <div className="panel-kicker">
        <span>03 / EXECUTION</span>
        <LockKeyhole size={13} />
      </div>
      <div className="trade-symbol">
        <Asset symbol={perp?.symbol ?? null} small />
        <div>
          <h3>{perp?.symbol ?? "No linked perp"}</h3>
          <span>Velocity · Mainnet reference</span>
        </div>
      </div>
      <div className="segmented side-selector">
        {["Long", "Short"].map((s) => (
          <button
            key={s}
            className={side === s ? "active" : ""}
            onClick={() => setSide(s)}
          >
            {s === "Long" ? (
              <ArrowUpRight size={13} />
            ) : (
              <ArrowDownRight size={13} />
            )}
            {s}
          </button>
        ))}
      </div>
      <div className="order-types">
        {["Market", "Limit"].map((m) => (
          <button
            className={mode === m ? "active" : ""}
            onClick={() => {
              setMode(m);
              setPreview(false);
            }}
            key={m}
          >
            {m}
          </button>
        ))}
        <span className="micro-pill">PREVIEW ONLY</span>
      </div>
      <label className="trade-input">
        <span>
          Size <span>{perp?.baseAsset ?? "BASE"}</span>
        </span>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="0.00"
          value={size}
          onChange={(e) => {
            setSize(e.target.value);
            setPreview(false);
          }}
        />
      </label>
      {mode === "Limit" && (
        <label className="trade-input">
          <span>
            Limit Price <span>USD</span>
          </span>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setPreview(false);
            }}
          />
        </label>
      )}
      <label className="slippage-label">
        Slippage cap{" "}
        <span>
          <input
            aria-label="Slippage cap percent"
            type="number"
            min="0.01"
            max="5"
            step="0.1"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
          />
          %
        </span>
      </label>
      <dl className="trade-breakdown">
        <div>
          <dt>Reference notional</dt>
          <dd>{usd(notional)}</dd>
        </div>
        <div>
          <dt>
            Quote asset <CircleHelp size={11} />
          </dt>
          <dd>{perp?.quoteAsset ?? "--"}</dd>
        </div>
        <div>
          <dt>Protocol fee</dt>
          <dd>Not quoted</dd>
        </div>
        <div>
          <dt>Builder fee ({fee / 10} bps)</dt>
          <dd>{usd(notional == null ? null : (notional * fee) / 100000)}</dd>
        </div>
        <div>
          <dt>Network fee</dt>
          <dd>Not simulated</dd>
        </div>
      </dl>
      <button
        className="button primary full"
        disabled={
          !perp ||
          notional == null ||
          Number(slippage) <= 0 ||
          Number(slippage) > 5
        }
        onClick={() => setPreview((v) => !v)}
      >
        Inspect Reference <ArrowRight size={14} />
      </button>
      {preview && (
        <div className="reference-preview" role="status">
          <strong>
            {side} {number(amount)} {perp?.baseAsset}
          </strong>
          <p>
            {usd(notional)} reference notional. This is not an executable quote.
            Protocol fees, collateral, slippage, and devnet market support have
            not been validated.
          </p>
        </div>
      )}
      <div className="trade-lock">
        <LockKeyhole size={14} />
        <p>
          <strong>
            {data?.trading.enabled ? "Reference only." : "Execution is locked."}
          </strong>
          {data?.trading.enabled
            ? data.trading.network === "mainnet-beta"
              ? "This panel never signs. MAINNET trading is in its own panel below, with hard limits. Real funds."
              : "This panel never signs. Devnet test trading is in its own panel below, and has not been verified end to end."
            : "No wallet signature or order submission. Devnet signing has not been verified end to end."}
        </p>
      </div>
      <p className="margin-disclosure">
        Velocity uses cross-margin within each subaccount, not isolated per
        position. Devnet collateral differs from this mainnet reference.
      </p>
    </section>
  );
}

function SignalsPage() {
  const { data } = useObservatory();
  return (
    <>
      <div className="signal-stats">
        <div>
          <span className="label">ACTIVE OBSERVATIONS</span>
          <strong>
            {data?.signals.length ?? 0}
            <span className="muted">/ last 24h</span>
          </strong>
        </div>
        <div>
          <span className="label">COMPARISON WINDOW</span>
          <strong>
            60<span>min</span>
          </strong>
        </div>
        <div>
          <span className="label">TRAILING BASELINE</span>
          <strong>
            7<span>days</span>
          </strong>
        </div>
        <div>
          <span className="label">MINIMUM PRIOR SAMPLES</span>
          <strong>
            30<span>comparisons</span>
          </strong>
        </div>
      </div>
      <div className="signals-layout">
        <section className="panel">
          <div className="panel-kicker">
            <span>
              <Radio size={14} /> LIVE SIGNAL FEED
            </span>
            <span className="stamp">REAL OBSERVATIONS ONLY</span>
          </div>
          <SignalItems />
        </section>
        <aside className="panel signal-method">
          <p className="eyebrow">READING THE SIGNAL</p>
          <h2>
            Movement.
            <br />
            Not a mandate.
          </h2>
          <div>
            <span className="signal-type">
              <Zap size={15} /> ODDS_LEAD
            </span>
            <p>
              A significant move in event probability without a corresponding
              directional move in the perpetual.
            </p>
          </div>
          <div>
            <span className="signal-type">
              <Activity size={15} /> PERP_LEAD
            </span>
            <p>
              A significant perpetual move that event probability has not
              followed.
            </p>
          </div>
          <p className="method-fineprint">
            Threshold: |z| ≥ 2. Follow threshold: 0.5. Sparse, stale, or
            zero-variance observations suppress signals. Statistical leadership
            does not establish causation.
          </p>
        </aside>
      </div>
    </>
  );
}
function SignalItems({ themeId }: { themeId?: string }) {
  const { data } = useObservatory();
  const signals =
    data?.signals.filter((s) => !themeId || s.themeId === themeId) ?? [];
  if (!signals.length)
    return (
      <Empty
        title="Nothing forced. Nothing fabricated."
        icon={<Activity size={34} strokeWidth={1} />}
      >
        The worker is collecting real observations. Signals will appear when the
        historical baseline and divergence thresholds are met.
      </Empty>
    );
  return (
    <div className="signal-items">
      {signals.map((s) => {
        const t = data?.themes.find((t) => t.id === s.themeId);
        return (
          <article key={s.id}>
            <div>
              <span className="signal-type">
                <Zap size={13} />
                {s.type}
              </span>
              <time>{time(s.createdAt)} UTC</time>
            </div>
            <h3>
              {t ? (
                <Link href={`/t/${t.slug}`}>
                  {displayTitle(t)} <ArrowUpRight size={15} />
                </Link>
              ) : (
                "Observed divergence"
              )}
            </h3>
            <p>
              Observed standardized divergence. Inspect the event, directional
              mapping, and source timestamps before drawing conclusions.
            </p>
          </article>
        );
      })}
    </div>
  );
}

function Portfolio() {
  const { address, openWallet } = useObservatory();
  return (
    <>
      <section className="portfolio-hero panel">
        <div className="portfolio-illustration" aria-hidden="true">
          <div className="orbital-ring" />
          <div className="orbital-ring second" />
          <span>
            <Wallet size={35} strokeWidth={1} />
          </span>
          <i className="orbit-dot" />
        </div>
        <p className="eyebrow">NON-CUSTODIAL BY DESIGN</p>
        <h2>
          {address
            ? "Connected. Not exposed."
            : "Your wallet is the starting point."}
        </h2>
        <p>
          {address
            ? "Your research session is authenticated. Onchain subaccount discovery and position reconciliation are not enabled in this build. An empty view is not a zero balance."
            : "Connect a Solana wallet to create a research session and save themes. Position reads and execution remain disabled until the onchain integration is verified."}
        </p>
        <button className="button primary" onClick={openWallet}>
          <Wallet size={15} />
          {address ? "Manage Session" : "Connect Wallet"}
        </button>
        <span className="security-note">
          <ShieldCheck size={14} /> Your private keys never leave your wallet.
        </span>
      </section>
      <div className="portfolio-notes">
        <div>
          <Layers3 size={20} />
          <h3>Subaccount-aware</h3>
          <p>
            Each Velocity subaccount has its own margin scope. Positions must be
            reconciled per account, not inferred from wallet token balances.
          </p>
        </div>
        <div>
          <LockKeyhole size={20} />
          <h3>No hidden permissions</h3>
          <p>
            Research sign-in cannot deposit collateral, authorize a builder,
            place an order, or transfer funds.
          </p>
        </div>
        <div>
          <Globe2 size={20} />
          <h3>Network-separated</h3>
          <p>
            Public research quotes are mainnet data. A devnet execution
            preference does not turn those prices into devnet quotes.
          </p>
        </div>
      </div>
    </>
  );
}

type AlertRecord = {
  id: string;
  themeId: string;
  threshold: string | number;
  enabled: boolean;
};
type AlertDelivery = {
  id: string;
  alertId: string;
  reason: string;
  status: string;
  createdAt: string;
};
function Alerts() {
  const { data, address, openWallet, watched, toggleWatch, notify } =
    useObservatory();
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [deliveries, setDeliveries] = useState<AlertDelivery[]>([]);
  const [alertOwner, setAlertOwner] = useState<string | null>(null);
  const [themeId, setThemeId] = useState("");
  const [threshold, setThreshold] = useState("70");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!address) return;
    let active = true;
    void request<{ alerts: AlertRecord[]; deliveries: AlertDelivery[] }>(
      "alerts",
    )
      .then((r) => {
        if (active) {
          setAlerts(r.alerts);
          setDeliveries(r.deliveries);
          setAlertOwner(address);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [address, data?.capturedAt]);
  async function add() {
    if (!address) {
      openWallet();
      return;
    }
    setBusy(true);
    try {
      await request("alerts", {
        method: "POST",
        body: JSON.stringify({ themeId, threshold: Number(threshold) / 100 }),
      });
      setAlerts((await request<{ alerts: AlertRecord[] }>("alerts")).alerts);
      setAlertOwner(address);
      notify("In-app probability alert created. Telegram is not connected.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not create alert.");
    } finally {
      setBusy(false);
    }
  }
  const currentAlerts = address && alertOwner === address ? alerts : [];
  return (
    <div className="alerts-layout">
      <section className="panel">
        <div className="panel-kicker">
          <span>
            <Star size={14} /> YOUR WATCHLIST
          </span>
          <span className="count-pill">{watched.length}</span>
        </div>
        {!address ? (
          <Empty
            title="Make this space yours."
            icon={<Star size={30} strokeWidth={1} />}
          >
            Sign in with your wallet to save research across visits.
            <button className="button primary" onClick={openWallet}>
              Connect Wallet <ArrowUpRight size={14} />
            </button>
          </Empty>
        ) : !watched.length ? (
          <Empty title="Your next perspective is out there.">
            Use the star beside a theme to add it here.{" "}
            <Link href="/markets">Explore markets.</Link>
          </Empty>
        ) : (
          <div className="watchlist-items">
            {data?.themes
              .filter((t) => watched.includes(t.id))
              .map((t) => (
                <div key={t.id}>
                  <Asset symbol={t.perpSymbol} small />
                  <Link href={`/t/${t.slug}`}>
                    {displayTitle(t)}
                    <span>
                      {pct(t.markets[0]?.yesMid)} YES ·{" "}
                      {t.perpSymbol ?? "Unmapped"}
                    </span>
                  </Link>
                  <button
                    className="icon-button"
                    aria-label={`Unwatch ${displayTitle(t)}`}
                    onClick={() => void toggleWatch(t.id)}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
          </div>
        )}
        <div className="alert-list">
          <h3>In-App Alert Rules</h3>
          {loadError ? (
            <p role="alert">
              Alert rules could not be loaded. Your saved rules may still exist.
            </p>
          ) : currentAlerts.filter((a) => a.enabled).length ? (
            currentAlerts
              .filter((a) => a.enabled)
              .map((a) => (
                <div className="alert-rule" key={a.id}>
                  <Bell size={15} />
                  <span>
                    {data?.themes.find((t) => t.id === a.themeId)?.title ??
                      a.themeId}
                    <small>
                      Oriented probability ≥ {pct(Number(a.threshold))} · hourly
                      deduplication
                    </small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Disable alert"
                    onClick={async () => {
                      try {
                        await request(`alerts/${a.id}`, { method: "DELETE" });
                        setAlerts((v) =>
                          v.map((x) =>
                            x.id === a.id ? { ...x, enabled: false } : x,
                          ),
                        );
                      } catch {
                        notify("Could not disable alert.");
                      }
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))
          ) : (
            <p>
              No active rules. Alerts are not automatically created by watching
              a theme.
            </p>
          )}
        </div>
        {address && alertOwner === address && (
          <div className="alert-list">
            <h3>Recent Notices</h3>
            {deliveries.length ? (
              deliveries.map((d) => (
                <article className="alert-rule" key={d.id}>
                  <Bell size={15} />
                  <span>
                    {d.reason}
                    <small>
                      {shortDate(d.createdAt)} · {time(d.createdAt)} UTC ·{" "}
                      {d.status}
                    </small>
                  </span>
                </article>
              ))
            ) : (
              <p>
                No threshold notices recorded. The worker only creates notices
                from fresh observations.
              </p>
            )}
          </div>
        )}
      </section>
      <section className="panel alert-builder">
        <div className="panel-kicker">
          <span>
            <Bell size={14} /> CREATE A RESEARCH ALERT
          </span>
        </div>
        <h2>
          A little more
          <br />
          <span>situational awareness.</span>
        </h2>
        <label>
          Theme
          <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
            <option value="">Select a reviewed theme</option>
            {data?.themes
              .filter((t) => t.reviewStatus === "approved")
              .map((t) => (
                <option value={t.id} key={t.id}>
                  {displayTitle(t)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Oriented probability at or above
          <div className="threshold-input">
            <input
              type="number"
              min="0"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <span>%</span>
          </div>
        </label>
        <p className="form-note">
          For bearish YES mappings, the monitored probability is NO. Notices
          appear in-app; this is a threshold check, not an exact crossing
          guarantee.
        </p>
        <button
          className="button primary full"
          disabled={
            busy ||
            !themeId ||
            !Number.isFinite(Number(threshold)) ||
            Number(threshold) < 0 ||
            Number(threshold) > 100
          }
          onClick={() => void add()}
        >
          {busy
            ? "Saving..."
            : address
            ? "Create In-App Alert"
            : "Sign In to Create Alert"}
          <ArrowRight size={14} />
        </button>
        <div className="telegram-status">
          <span className="status-dot amber" />
          <div>
            <strong>Telegram is not connected</strong>
            <p>
              Bot linking and delivery are not enabled. No messages will be
              sent.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Legal({ document }: { document: string }) {
  const titles: Record<string, string> = {
    terms: "Terms of Use",
    risk: "Risk Disclosure",
    privacy: "Privacy Notice",
  };
  const content: Record<string, [string, string][]> = {
    risk: [
      [
        "Not financial advice",
        "Parallax provides research information, not personalized investment advice, recommendations, or guarantees. You are responsible for your decisions.",
      ],
      [
        "Different contracts, different outcomes",
        "Prediction outcomes and perpetual positions are not economically equivalent. Resolution sources, observation windows, thresholds, collateral, and market prices can differ. A divergence is not arbitrage or proof of causation.",
      ],
      [
        "Leverage and protocol risk",
        "Perpetuals can involve liquidation, losses, oracle failures, smart-contract exploits, liquidity constraints, funding, and collateral depegs. Velocity uses cross-margin within a subaccount.",
      ],
      [
        "Data limitations",
        "Quotes can be delayed, incomplete, or unavailable. Public market data is mainnet research data, not an executable devnet quote. Statistical signals require a sufficient trailing history.",
      ],
      [
        "Execution disabled",
        "This build cannot place, cancel, or close blockchain orders. A wallet sign-in authenticates a research session only. No transaction permissions are granted.",
      ],
    ],
    terms: [
      [
        "Draft status",
        "This document is a working draft pending legal review. It is not a representation that the service is compliant or authorized in your jurisdiction. Trading must remain disabled pending review.",
      ],
      [
        "Research use",
        "Access is provided for informational research. Do not rely on this service as a sole source of prices, resolution rules, or risk information. Review the underlying venue terms and official rules.",
      ],
      [
        "Eligibility and availability",
        "Access may be restricted by location or venue policy. Do not bypass restrictions. Third-party APIs and programs are independent services and can change or become unavailable.",
      ],
      [
        "No custody or execution",
        "Parallax does not receive private keys, hold user funds, or submit orders in this build. All future transaction features require separate verification, user approval, and legal review.",
      ],
      [
        "No warranties",
        "Data and research are provided without promises of completeness, continuous availability, profitability, or fitness for a particular trading strategy. Final enforceable terms require counsel.",
      ],
    ],
    privacy: [
      [
        "Information processed",
        "Research sessions process a public Solana address, a signed authentication challenge, a session token hash, saved themes, and alert rules. Public addresses and blockchain activity may be linkable to other public information.",
      ],
      [
        "Cookies and sessions",
        "An HttpOnly session cookie authenticates account features. Sessions expire; you can sign out to invalidate the current session. The server stores token hashes, not wallet private keys.",
      ],
      [
        "Third-party connections",
        "The server queries venue data providers. The browser opens a data-feed connection to the configured API. A connected wallet is governed by its own privacy policy. No analytics or advertising SDK is installed in this build.",
      ],
      [
        "Retention and account requests",
        "A production retention schedule, deletion/export process, operator identity, and contact details must be supplied before launch. Database backups may require separate retention handling.",
      ],
      [
        "Telegram",
        "Telegram linking and delivery are disabled. This build does not send your alert data to Telegram.",
      ],
    ],
  };
  return (
    <article className="legal-page">
      <Link className="text-link" href="/">
        <ArrowLeft size={14} /> Back to research
      </Link>
      <span className="stamp candidate">DRAFT · PENDING LEGAL REVIEW</span>
      <h1>{titles[document]}</h1>
      <p className="legal-intro">
        Read the context. Understand the limits.
        <br />
        Last drafted October 29, 2026.
      </p>
      {content[document]?.map(([heading, text], i) => (
        <section key={heading}>
          <span className="section-number">
            {String(i + 1).padStart(2, "0")} /
          </span>
          <div>
            <h2>{heading}</h2>
            <p>{text}</p>
          </div>
        </section>
      ))}
      <nav className="legal-nav">
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/risk">Risk Disclosure</Link>
        <Link href="/legal/privacy">Privacy</Link>
      </nav>
    </article>
  );
}

"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  List,
  Maximize2,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Star,
} from "lucide-react";
import type { Theme } from "@parallax/shared";
import { useObservatory } from "./provider";
import { RiftScene } from "./rift-scene";
import { pct, usd, shortDate, signed } from "@/lib/format";

function title(theme: Theme) {
  const [question, strike] = theme.title.split(": ");
  return question.includes("___") && strike
    ? question.replace("___", `$${strike}`)
    : theme.title;
}

export function RiftExplorer({
  query,
  onQuery,
  onHelp,
  renderAnalysis,
  renderTable,
  renderSignals,
}: {
  query: string;
  onQuery: (value: string) => void;
  onHelp: () => void;
  renderAnalysis: (theme: Theme) => React.ReactNode;
  renderTable: () => React.ReactNode;
  renderSignals: () => React.ReactNode;
}) {
  const { data, loading, watched, toggleWatch } = useObservatory();
  const reviewed =
    data?.themes.filter((t) => t.reviewStatus === "approved") ?? [];
  const preferred =
    reviewed.find(
      (t) =>
        t.perpSymbol === "SOL-PERP" &&
        (t.markets[0]?.yesMid ?? 0) > 0.1 &&
        (t.markets[0]?.yesMid ?? 1) < 0.9,
    ) ??
    reviewed.find((t) => t.markets[0]?.yesMid != null) ??
    reviewed[0];
  const [selectedId, setSelectedId] = useState("");
  const [focus, setFocus] = useState<"balanced" | "event" | "market">(
    "balanced",
  );
  const [paused, setPaused] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [filter, setFilter] = useState("all");
  const [asset, setAsset] = useState("all");
  const [view, setView] = useState("explore");
  const worldRef = useRef<HTMLElement>(null);
  const candidates = reviewed.filter(
    (t) => filter !== "watchlist" || watched.includes(t.id),
  );
  const selected =
    candidates.find((t) => t.id === selectedId) ??
    candidates.find((t) => t.id === preferred?.id) ??
    candidates[0];
  const selectedIndex = Math.max(
    0,
    candidates.findIndex((t) => t.id === selected?.id),
  );
  const perp = data?.perps.find((p) => p.symbol === selected?.perpSymbol);
  const perAsset =
    data?.perps.flatMap((p) =>
      reviewed.filter((t) => t.perpSymbol === p.symbol).slice(0, 2),
    ) ?? [];
  const events = [
    ...new Map([...perAsset, ...reviewed].map((t) => [t.id, t])).values(),
  ].filter(
    (t) =>
      (asset === "all" || t.perpSymbol === asset) &&
      (filter !== "watchlist" || watched.includes(t.id)) &&
      `${t.title} ${t.perpSymbol ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  function select(id: string, returnToWorld = false) {
    if (!reviewed.some((t) => t.id === id)) return;
    setSelectedId(id);
    setFocus("balanced");
    if (returnToWorld) {
      worldRef.current?.focus({ preventScroll: true });
      worldRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  }
  function next(offset: number) {
    if (candidates.length)
      select(
        candidates[
          (selectedIndex + offset + candidates.length) % candidates.length
        ].id,
      );
  }

  return (
    <>
      <section
        className="rift-world"
        ref={worldRef}
        tabIndex={0}
        aria-labelledby="rift-title"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            next(event.key === "ArrowRight" ? 1 : -1);
          }
          if (event.key === "Home") {
            event.preventDefault();
            setFocus("balanced");
            setResetToken((v) => v + 1);
          }
        }}
      >
        <div className="rift-world-heading">
          <p className="rift-eyebrow">
            <span /> AN EVENT-DRIVEN WORLD{" "}
            <span className="rift-heading-rule" /> BUILT ON SOLANA
          </p>
          <h1 id="rift-title">
            <span>ONE EVENT.</span>
            <span>
              TWO <em>REALITIES.</em>
            </span>
          </h1>
          <p className="rift-world-intro">
            What the world believes. How the market reacts.
            <br className="rift-mobile-break" /> Explore the space between.
          </p>
        </div>
        <div className="rift-art">
          <RiftScene
            focus={focus}
            selectionKey={selected?.id ?? ""}
            paused={paused}
            resetToken={resetToken}
            agitation={
              perp?.change24h == null
                ? 0.5
                : Math.min(1, 0.35 + Math.abs(perp.change24h) / 9)
            }
          />
        </div>
        <button
          className={`rift-realm rift-realm-event ${
            focus === "event" ? "focused" : ""
          }`}
          aria-label="Focus event perspective"
          aria-pressed={focus === "event"}
          onClick={() => setFocus(focus === "event" ? "balanced" : "event")}
        >
          <span className="rift-realm-index">01 / THE BELIEF</span>
          <strong>{pct(selected?.markets[0]?.yesMid)}</strong>
          <span className="rift-realm-caption">YES probability</span>
          <small>
            {selected
              ? "Polymarket · via Jupiter"
              : loading
              ? "Awaiting verified observations"
              : "No approved contract available"}
          </small>
          <i aria-hidden="true" />
        </button>
        <button
          className={`rift-realm rift-realm-market ${
            focus === "market" ? "focused" : ""
          }`}
          aria-label="Focus perpetual perspective"
          aria-pressed={focus === "market"}
          onClick={() => setFocus(focus === "market" ? "balanced" : "market")}
        >
          <span className="rift-realm-index">02 / THE REACTION</span>
          <strong>{usd(perp?.mark)}</strong>
          <span className="rift-realm-caption">
            {perp?.symbol ?? "No linked perpetual"}
          </span>
          <small>
            Velocity{" "}
            {perp ? (
              <>
                <span
                  className={
                    (perp.change24h ?? 0) >= 0 ? "positive" : "negative"
                  }
                >
                  {signed(perp.change24h)}
                </span>{" "}
                / 24h
              </>
            ) : (
              "· Public market data"
            )}
          </small>
          <i aria-hidden="true" />
        </button>
        <span className="rift-center-caption" aria-hidden="true">
          THE RIFT
        </span>
        <div className="rift-world-actions">
          {selected ? (
            <Link className="rift-primary-link" href={`/t/${selected.slug}`}>
              Inspect this event <ArrowUpRight size={16} />
            </Link>
          ) : (
            <a className="rift-primary-link" href="#rift-events">
              Discover events <ArrowDown size={16} />
            </a>
          )}
          <a className="rift-secondary-link" href="#rift-events">
            Explore the world <ArrowDown size={14} />
          </a>
        </div>
        <div className="rift-world-foot">
          <span className="rift-art-disclosure">
            A VISUAL METAPHOR. NOT A FINANCIAL MODEL.
          </span>
          <div className="rift-view-controls">
            <span>DRAG TO EXPLORE</span>
            <button
              aria-label="Reset world view"
              onClick={() => {
                setFocus("balanced");
                setResetToken((v) => v + 1);
              }}
            >
              <Maximize2 size={14} />
            </button>
            <button
              aria-label={paused ? "Resume world motion" : "Pause world motion"}
              aria-pressed={paused}
              onClick={() => setPaused((v) => !v)}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          </div>
        </div>
      </section>

      <section className="rift-selection" aria-label="Selected event">
        <div className="rift-selection-label">
          <span className="rift-selection-dot" /> IN VIEW{" "}
          <span>
            {candidates.length
              ? String(selectedIndex + 1).padStart(2, "0")
              : "--"}{" "}
            / {String(candidates.length).padStart(2, "0")}
          </span>
        </div>
        <div className="rift-selection-title">
          {selected ? (
            <>
              <h2>{title(selected)}</h2>
              <p>
                Reviewed relationship <span>·</span> Closes{" "}
                {shortDate(selected.markets[0]?.closeTime ?? null)} UTC{" "}
                <span>·</span> Single prediction venue
              </p>
            </>
          ) : (
            <>
              <h2>
                {loading
                  ? "Finding a verified perspective..."
                  : filter === "watchlist"
                  ? "Your watchlist is quiet."
                  : "No verified perspective available."}
              </h2>
              <p>
                {filter === "watchlist"
                  ? "Save an event or switch to all reviewed events."
                  : "No demo quote or invented market will replace missing data."}
              </p>
            </>
          )}
        </div>
        <div className="rift-selection-actions">
          {selected && (
            <button
              className={watched.includes(selected.id) ? "saved" : ""}
              aria-label={`${
                watched.includes(selected.id) ? "Unwatch" : "Watch"
              } selected event`}
              onClick={() => void toggleWatch(selected.id)}
            >
              <Star
                size={16}
                fill={watched.includes(selected.id) ? "currentColor" : "none"}
              />
            </button>
          )}
          <button
            aria-label="Previous event"
            onClick={() => next(-1)}
            disabled={candidates.length < 2}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            aria-label="Next event"
            onClick={() => next(1)}
            disabled={candidates.length < 2}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <span
          className="rift-selection-announcement"
          role="status"
          aria-live="polite"
        >
          {selected ? `Exploring ${title(selected)}` : "No selected event"}
        </span>
      </section>

      <section
        id="rift-events"
        className="rift-event-atlas"
        aria-labelledby="rift-events-title"
      >
        <div className="rift-section-heading">
          <div>
            <p className="rift-eyebrow">THE EVENT ATLAS</p>
            <h2 id="rift-events-title">
              Every event
              <br />
              leaves a <em>trace.</em>
            </h2>
          </div>
          <p>
            Follow the event. Question the reaction.
            <br />
            Each perspective starts with a reviewed contract.
          </p>
          <div className="rift-view-toggle">
            <button
              className={view === "explore" ? "active" : ""}
              aria-pressed={view === "explore"}
              onClick={() => setView("explore")}
            >
              <LayoutDashboard size={13} /> Explore
            </button>
            <button
              className={view === "table" ? "active" : ""}
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              <List size={14} /> Data table
            </button>
          </div>
        </div>
        <div className="rift-atlas-controls">
          <div className="rift-event-filters" aria-label="Event collection">
            <button
              className={filter === "all" ? "active" : ""}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All reviewed <span>{data ? reviewed.length : "--"}</span>
            </button>
            <button
              className={filter === "watchlist" ? "active" : ""}
              aria-pressed={filter === "watchlist"}
              onClick={() => setFilter("watchlist")}
            >
              Watchlist <Star size={11} />
            </button>
            <label>
              <span className="rift-sr">Filter by linked asset</span>
              <select
                aria-label="Filter atlas by linked asset"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
              >
                <option value="all">All assets</option>
                {data?.perps
                  .filter((p) =>
                    reviewed.some((t) => t.perpSymbol === p.symbol),
                  )
                  .map((p) => (
                    <option value={p.symbol} key={p.symbol}>
                      {p.baseAsset}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {view === "explore" && (
            <label className="rift-event-search">
              <Search size={15} />
              <input
                id="global-search"
                type="search"
                aria-label="Search event atlas"
                value={query}
                placeholder="Find a perspective..."
                onChange={(e) => onQuery(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
          )}
        </div>
        {view === "table" ? (
          renderTable()
        ) : (
          <>
            <div className="rift-event-grid">
              {events.slice(0, 6).map((event, index) => {
                const quote = event.markets[0];
                return (
                  <article
                    className={`rift-event ${
                      selected?.id === event.id ? "selected" : ""
                    }`}
                    key={event.id}
                  >
                    <div className="rift-event-top">
                      <span>0{index + 1}</span>
                      <span>
                        {event.perpSymbol?.replace("-PERP", "") ?? "UNMAPPED"}{" "}
                        <span className="rift-event-separator">/</span>{" "}
                        {shortDate(quote?.closeTime ?? null)}
                      </span>
                      <button
                        className={watched.includes(event.id) ? "saved" : ""}
                        aria-label={`${
                          watched.includes(event.id) ? "Unwatch" : "Watch"
                        } ${title(event)}`}
                        onClick={() => void toggleWatch(event.id)}
                      >
                        <Star
                          size={14}
                          fill={
                            watched.includes(event.id) ? "currentColor" : "none"
                          }
                        />
                      </button>
                    </div>
                    <button
                      className="rift-event-select"
                      aria-label={`Explore ${title(event)}`}
                      aria-pressed={selected?.id === event.id}
                      onClick={() => select(event.id, true)}
                    >
                      <h3>{title(event)}</h3>
                      <span className="rift-event-probability">
                        <strong>{pct(quote?.yesMid)}</strong>
                        <span>YES PROBABILITY</span>
                        <ArrowUpRight size={20} />
                      </span>
                    </button>
                    <div className="rift-event-bottom">
                      <span>
                        Polymarket <span>via Jupiter</span>
                      </span>
                      <Link href={`/t/${event.slug}`}>
                        Inspect event <ArrowRight size={13} />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
            {!events.length && (
              <div className="rift-empty">
                <CircleHelp size={24} />
                <h3>
                  {loading
                    ? "Loading real observations."
                    : "No event in this view."}
                </h3>
                <p>
                  {filter === "watchlist"
                    ? "Your saved events appear here after wallet sign-in. Switch to all reviewed events to continue exploring."
                    : "Try another search or asset. The atlas never substitutes demo contracts."}
                </p>
              </div>
            )}
            <div className="rift-atlas-foot">
              <span>
                {data
                  ? `${Math.min(6, events.length)} of ${
                      events.length
                    } reviewed contracts`
                  : "Awaiting source data"}{" "}
                <span>· Distinct strikes can share one event</span>
              </span>
              <Link href="/markets">
                Open market index <ArrowUpRight size={14} />
              </Link>
            </div>
          </>
        )}
      </section>

      <section className="rift-analysis" id="rift-analysis">
        <div className="rift-section-heading">
          <div>
            <p className="rift-eyebrow">BENEATH THE SURFACE</p>
            <h2>
              A different
              <br />
              <em>perspective.</em>
            </h2>
          </div>
          <p>
            One shared timeline. Independent scales.
            <br />
            The story only matters if the sources hold up.
          </p>
        </div>
        {selected ? (
          renderAnalysis(selected)
        ) : (
          <div className="rift-empty">
            <h3>Select a reviewed event to inspect its history.</h3>
            <p>
              No historical probability is generated to fill an empty chart.
            </p>
          </div>
        )}
      </section>
      <section className="rift-context">
        <div className="rift-context-story">
          <span className="rift-eyebrow">
            <ShieldCheck size={14} /> CONTEXT BEFORE CONVICTION
          </span>
          <h2>
            Not every gap
            <br />
            is an <em>opportunity.</em>
          </h2>
          <p>
            Prediction markets price an outcome. Perpetuals price an asset.
            Seeing them together does not make them equivalent, correlated, or a
            guaranteed hedge.
          </p>
          <button className="rift-secondary-link" onClick={onHelp}>
            Understand the methodology <ArrowUpRight size={14} />
          </button>
          <span className="rift-research-note">
            <Activity size={12} /> Research only. Not financial advice.
          </span>
        </div>
        {renderSignals()}
      </section>
    </>
  );
}

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import bs58 from "bs58";
import {
  X,
  ArrowUpRight,
  ShieldCheck,
  Wallet,
  Check,
  LoaderCircle,
} from "lucide-react";
import { z } from "zod";
import type { TerminalData } from "@parallax/shared";

const nullable = z.number().finite().nullable();
const market = z.object({
  venue: z.enum(["polymarket", "kalshi"]),
  venueMarketId: z.string(),
  title: z.string(),
  yesBid: nullable,
  yesAsk: nullable,
  yesMid: nullable,
  volume24h: nullable,
  liquidity: nullable,
  closeTime: z.string().nullable(),
  rules: z.string(),
  source: z.string(),
  transport: z.string(),
  capturedAt: z.string(),
});
const terminalSchema = z.object({
  themes: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      description: z.string(),
      tags: z.array(z.string()),
      direction: z.union([z.literal(1), z.literal(-1)]),
      reviewStatus: z.enum(["candidate", "approved", "rejected"]),
      markets: z.array(market),
      perpSymbol: z.string().nullable(),
      volume24h: nullable,
      confidence: z.number(),
      reviewNote: z.string(),
    }),
  ),
  perps: z.array(
    z.object({
      symbol: z.string(),
      marketIndex: z.number(),
      baseAsset: z.string(),
      quoteAsset: z.string(),
      mark: z.number().finite(),
      oracle: z.number().finite(),
      change24h: nullable,
      volume24h: z.number(),
      openInterestLong: z.number(),
      openInterestShort: z.number(),
      fundingLong: z.string(),
      fundingShort: z.string(),
      capturedAt: z.string(),
    }),
  ),
  signals: z.array(
    z.object({
      id: z.string(),
      themeId: z.string(),
      type: z.enum(["ODDS_LEAD", "PERP_LEAD"]),
      createdAt: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
  health: z.array(
    z.object({
      venue: z.string(),
      status: z.enum(["healthy", "degraded", "unavailable"]),
      message: z.string(),
      checkedAt: z.string(),
    }),
  ),
  capturedAt: z.string(),
  trading: z.object({
    enabled: z.boolean(),
    network: z.enum(["devnet", "mainnet-beta"]),
    reason: z.string(),
    builderFeeTenthsBp: z.number(),
  }),
});

type Context = {
  data: TerminalData | null;
  loading: boolean;
  error: string | null;
  feed: "connected" | "reconnecting";
  refresh: () => Promise<void>;
  openWallet: () => void;
  address: string | null;
  watched: string[];
  toggleWatch: (id: string) => Promise<void>;
  notify: (message: string) => void;
};
const ObservatoryContext = createContext<Context | null>(null);
export function useObservatory() {
  const context = useContext(ObservatoryContext);
  if (!context) throw new Error("Observatory provider missing");
  return context;
}

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request unavailable");
  return body as T;
}

export function ObservatoryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WalletProvider wallets={[]} autoConnect={false}>
      <DataProvider>{children}</DataProvider>
    </WalletProvider>
  );
}

function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<TerminalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<"connected" | "reconnecting">(
    "reconnecting",
  );
  const [walletOpen, setWalletOpen] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [watched, setWatched] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const wallet = useWallet();

  async function refresh() {
    try {
      setData(terminalSchema.parse(await request("terminal")));
      setError(null);
    } catch {
      setError(
        "The data connection is unavailable. Last successful observations are retained.",
      );
    } finally {
      setLoading(false);
    }
  }
  const update = useEffectEvent(refresh);
  useEffect(() => {
    const initial = setTimeout(() => {
      void update();
      connect();
    }, 0);
    const interval = setInterval(() => {
      void update();
    }, 30000);
    let socket: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout> | undefined,
      stopped = false;
    function connect() {
      if (stopped) return;
      socket = new WebSocket(
        process.env.NEXT_PUBLIC_FEED_URL ?? "ws://127.0.0.1:4100/feed",
      );
      socket.onopen = () => {
        setFeed("connected");
        void update();
      };
      socket.onmessage = (event) => {
        try {
          if (JSON.parse(event.data).type === "update") void update();
        } catch {
          /* Invalid messages never update prices. */
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (!stopped) {
          setFeed("reconnecting");
          retry = setTimeout(connect, 5000);
        }
      };
    }
    return () => {
      stopped = true;
      clearTimeout(initial);
      clearInterval(interval);
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
  useEffect(() => {
    void request<{ authenticated: boolean; address: string | null }>(
      "auth/session",
    )
      .then(async (session) => {
        if (session.authenticated) {
          setAddress(session.address);
          setWatched((await request<{ themes: string[] }>("watchlist")).themes);
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function toggleWatch(id: string) {
    if (!address) {
      setWalletOpen(true);
      return;
    }
    try {
      if (watched.includes(id))
        await request(`watchlist/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      else
        await request("watchlist", {
          method: "POST",
          body: JSON.stringify({ themeId: id }),
        });
      setWatched((await request<{ themes: string[] }>("watchlist")).themes);
      setToast(
        watched.includes(id)
          ? "Removed from your watchlist."
          : "Theme added to your watchlist.",
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Watchlist unavailable");
    }
  }
  async function signedIn(newAddress: string) {
    setAddress(newAddress);
    setWatched((await request<{ themes: string[] }>("watchlist")).themes);
    setWalletOpen(false);
    setToast(
      "Research session authenticated. No transaction permissions granted.",
    );
  }
  async function logout() {
    try {
      await request("auth/logout", { method: "POST", body: "{}" });
      await wallet.disconnect();
      setAddress(null);
      setWatched([]);
      setWalletOpen(false);
    } catch {
      setToast("Could not end the session. Please try again.");
    }
  }
  return (
    <ObservatoryContext.Provider
      value={{
        data,
        loading,
        error,
        feed,
        refresh,
        openWallet: () => setWalletOpen(true),
        address,
        watched,
        toggleWatch,
        notify: setToast,
      }}
    >
      {children}
      <WalletDialog
        open={walletOpen}
        close={() => setWalletOpen(false)}
        address={address}
        onSignIn={signedIn}
        logout={logout}
      />
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </ObservatoryContext.Provider>
  );
}

function WalletDialog({
  open,
  close,
  address,
  onSignIn,
  logout,
}: {
  open: boolean;
  close: () => void;
  address: string | null;
  onSignIn: (address: string) => Promise<void>;
  logout: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  async function signIn() {
    if (!wallet.publicKey || !wallet.signMessage) {
      setError("This wallet must support message signing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const address = wallet.publicKey.toBase58();
      const challenge = await request<{ nonce: string; message: string }>(
        "auth/challenge",
        { method: "POST", body: JSON.stringify({ address }) },
      );
      const signature = bs58.encode(
        await wallet.signMessage(new TextEncoder().encode(challenge.message)),
      );
      await request("auth/verify", {
        method: "POST",
        body: JSON.stringify({ address, nonce: challenge.nonce, signature }),
      });
      await onSignIn(address);
    } catch {
      setError(
        "Sign-in was declined or the session could not be verified. No transaction was submitted.",
      );
    } finally {
      setBusy(false);
    }
  }
  const installed = wallet.wallets.filter(
    (w) =>
      w.readyState === WalletReadyState.Installed ||
      w.readyState === WalletReadyState.Loadable,
  );
  return (
    <dialog
      ref={ref}
      className="wallet-dialog"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-labelledby="wallet-title"
    >
      <button
        className="icon-button dialog-close"
        onClick={close}
        aria-label="Close wallet dialog"
      >
        <X size={20} />
      </button>
      <div className="dialog-symbol">
        <Wallet size={26} />
      </div>
      <p className="eyebrow">YOUR KEYS. YOUR PERSPECTIVE.</p>
      <h2 id="wallet-title">
        {address ? "Your research session." : "Connect your wallet."}
      </h2>
      <p>
        Save themes and manage alerts with a Solana wallet. A sign-in signature
        never authorizes a trade.
      </p>
      {address ? (
        <>
          <code className="wallet-address">{address}</code>
          <button
            className="button secondary full"
            onClick={() => void logout()}
          >
            Disconnect &amp; Sign Out
          </button>
        </>
      ) : wallet.connected ? (
        <button
          className="button primary full"
          disabled={busy}
          onClick={() => void signIn()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}{" "}
          Sign In to Research
        </button>
      ) : installed.length ? (
        <div className="wallet-options">
          {installed.map((w) => (
            <button
              className="button secondary full"
              key={w.adapter.name}
              onClick={async () => {
                setError("");
                try {
                  wallet.select(w.adapter.name);
                } catch {
                  setError("Could not select this wallet.");
                }
              }}
            >
              <Wallet size={17} />
              {w.adapter.name}
              {wallet.wallet?.adapter.name === w.adapter.name && (
                <Check size={15} />
              )}
            </button>
          ))}
          {wallet.wallet && (
            <button
              className="button primary full"
              onClick={() => {
                void wallet
                  .connect()
                  .catch(() =>
                    setError("Wallet connection was declined or unavailable."),
                  );
              }}
            >
              Connect {wallet.wallet.adapter.name}
            </button>
          )}
        </div>
      ) : (
        <div className="wallet-empty">
          <p>No compatible wallet detected.</p>
          <a
            className="button secondary full"
            href="https://phantom.app/"
            target="_blank"
            rel="noreferrer"
          >
            Explore Phantom <ArrowUpRight size={16} />
          </a>
          <small>
            Install a Wallet Standard-compatible Solana wallet, then refresh
            this page.
          </small>
        </div>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="security-note">
        <ShieldCheck size={16} /> Non-custodial. Execution is currently
        disabled.
      </div>
    </dialog>
  );
}

/**
 * Session activity: a small log of what the trading panel did in this browser tab (deposit, order, close,
 * withdraw ...). It lives in sessionStorage only, never leaves the browser, and is cleared when the tab closes.
 * Stored data is validated again on read, so a tampered entry can never produce an unsafe explorer link.
 */
export type Network = "devnet" | "mainnet-beta";

export interface Activity {
  id: number;
  /** ISO time the action finished. */
  at: string;
  label: string;
  status: "confirmed" | "not-sent";
  network: Network;
  /** Base58 transaction signature, present only for confirmed transactions. */
  signature?: string;
  /** Short reason, present only when nothing was sent. */
  reason?: string;
}

export const ACTIVITY_KEY = "parallax.session-activity.v1";
export const ACTIVITY_MAX = 30;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

export const isSignature = (value: unknown): value is string => typeof value === "string" && SIGNATURE.test(value);

export function explorerTxUrl(signature: string, network: Network): string | null {
  if (!isSignature(signature)) return null;
  return `https://explorer.solana.com/tx/${signature}${network === "devnet" ? "?cluster=devnet" : ""}`;
}

export function addActivity(list: Activity[], entry: Activity, max = ACTIVITY_MAX): Activity[] {
  return [entry, ...list.filter((a) => a.id !== entry.id)].slice(0, max);
}

export function parseActivity(raw: string | null): Activity[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: Activity[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const network = o.network === "devnet" || o.network === "mainnet-beta" ? o.network : null;
    const status = o.status === "confirmed" || o.status === "not-sent" ? o.status : null;
    if (!network || !status || typeof o.label !== "string" || typeof o.at !== "string" || !Number.isFinite(Date.parse(o.at))) continue;
    if (typeof o.id !== "number" || !Number.isFinite(o.id)) continue;
    const entry: Activity = { id: o.id, at: o.at, label: o.label.slice(0, 80), status, network };
    if (status === "confirmed" && isSignature(o.signature)) entry.signature = o.signature;
    if (status === "not-sent" && typeof o.reason === "string") entry.reason = o.reason.slice(0, 240);
    out.push(entry);
    if (out.length >= ACTIVITY_MAX) break;
  }
  return out;
}

export function loadActivity(): Activity[] {
  try {
    return parseActivity(window.sessionStorage.getItem(ACTIVITY_KEY));
  } catch {
    return [];
  }
}

export function saveActivity(list: Activity[]): void {
  try {
    window.sessionStorage.setItem(ACTIVITY_KEY, JSON.stringify(list));
  } catch {
    /* storage may be blocked; the log then lives in memory only */
  }
}

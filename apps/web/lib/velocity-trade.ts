/**
 * Browser-side Velocity DEVNET trading. Everything here runs in the user's browser: the SDK builds
 * instructions, the transaction is simulated first, and the user's own wallet signs. There is no server
 * key and the API never sees a transaction. The SDK is imported lazily so it only loads when needed.
 *
 * NOT verified end to end: no order has been signed against devnet from this code. Simulation-first
 * means a bad build fails before anything is sent, but treat every flow as unproven until the owner has
 * run it with a funded devnet wallet (see docs/DEVNET-TRADING.md).
 */
import type { Connection, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { APP_MAX_BUILDER_FEE_TENTHS_BP, clampBuilderFee, isDevnetRpc } from "./trade-math";

export const DEVNET_RPC_DEFAULT = "https://api.devnet.solana.com";
export const QUOTE_MARKET_INDEX = 0; // dUSDT on devnet
const ESCROW_ORDER_SLOTS = 16;

export interface SignerWallet {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
}

export class TradeError extends Error {
  constructor(
    message: string,
    readonly code: "config" | "simulation" | "rejected" | "ambiguous" | "failed",
    readonly logs?: string[],
  ) {
    super(message);
  }
}

type Sdk = typeof import("@velocity-exchange/sdk");
export type VelocityClientT = InstanceType<Sdk["VelocityClient"]>;

export interface Session {
  client: VelocityClientT;
  connection: Connection;
  authority: PublicKey;
  sdk: Sdk;
  close: () => Promise<void>;
}

export interface SentResult {
  signature: string;
}

export async function openSession(wallet: SignerWallet, rpcUrl: string = DEVNET_RPC_DEFAULT): Promise<Session> {
  // Hard guard: this ticket never talks to a non-devnet endpoint.
  if (!isDevnetRpc(rpcUrl)) throw new TradeError("Only a devnet RPC endpoint is allowed for test trading.", "config");
  const [sdk, web3] = await Promise.all([import("@velocity-exchange/sdk"), import("@solana/web3.js")]);
  const connection = new web3.Connection(rpcUrl, "confirmed");
  const client = new sdk.VelocityClient({
    connection,
    wallet: wallet as never,
    env: "devnet",
  });
  await client.subscribe();
  return {
    client,
    connection,
    authority: wallet.publicKey,
    sdk,
    close: async () => {
      await client.unsubscribe();
    },
  };
}

/** True when the wallet already has subaccount 0. A missing account is a normal first-use state. */
export async function hasUserAccount(session: Session): Promise<boolean> {
  const address = await session.client.getUserAccountPublicKey(0, session.authority);
  const info = await session.connection.getAccountInfo(address, "confirmed");
  return info !== null;
}

/** dUSDT balance of the wallet's token account in base units (6 decimals), or 0n when it has none. */
export async function walletQuoteBalance(session: Session): Promise<bigint> {
  const ata = await session.client.getAssociatedTokenAccount(QUOTE_MARKET_INDEX);
  try {
    const balance = await session.connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(balance.value.amount);
  } catch {
    return 0n;
  }
}

async function build(session: Session, ixs: TransactionInstruction[]): Promise<VersionedTransaction> {
  return session.client.txSender.getVersionedTransaction(ixs, []);
}

/**
 * Simulate (no signature check), then ask the wallet to sign, send and confirm. Anything wrong in
 * simulation throws before the wallet is ever prompted. A timeout after sending is reported as ambiguous
 * so the caller re-reads state instead of retrying blindly.
 */
export async function simulateSignSend(
  session: Session,
  wallet: SignerWallet,
  ixs: TransactionInstruction[],
): Promise<SentResult> {
  const tx = await build(session, ixs);
  const sim = await session.connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) {
    throw new TradeError(`Simulation failed, nothing was sent: ${JSON.stringify(sim.value.err)}`, "simulation", sim.value.logs ?? undefined);
  }
  let signed: VersionedTransaction;
  try {
    signed = await wallet.signTransaction(tx);
  } catch (error) {
    throw new TradeError(error instanceof Error ? error.message : "Wallet declined to sign", "rejected");
  }
  const raw = signed.serialize();
  let signature: string;
  try {
    signature = await session.connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
  } catch (error) {
    throw new TradeError(error instanceof Error ? error.message : "Send failed", "failed");
  }
  try {
    const latest = await session.connection.getLatestBlockhash("confirmed");
    const result = await session.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (result.value.err) throw new TradeError(`Transaction failed on chain: ${JSON.stringify(result.value.err)}`, "failed");
  } catch (error) {
    if (error instanceof TradeError) throw error;
    throw new TradeError(`Submitted (${signature}) but confirmation did not finish. It may or may not have gone through; check the explorer before retrying.`, "ambiguous");
  }
  return { signature };
}

/** First use: create subaccount 0 and deposit dUSDT in one transaction. `amountUnits` is in 1e6 base units. */
export async function createAccountAndDeposit(session: Session, wallet: SignerWallet, amountUnits: bigint): Promise<SentResult> {
  if (amountUnits <= 0n) throw new TradeError("Deposit must be positive", "config");
  const { client, sdk } = session;
  const [initIxs] = await client.getInitializeUserAccountIxs(0);
  const ata = await client.getAssociatedTokenAccount(QUOTE_MARKET_INDEX);
  const depositIxs = await client.getDepositTxnIx(new sdk.BN(amountUnits.toString()), QUOTE_MARKET_INDEX, ata, 0);
  return simulateSignSend(session, wallet, [...initIxs, ...depositIxs]);
}

export async function depositMore(session: Session, wallet: SignerWallet, amountUnits: bigint): Promise<SentResult> {
  if (amountUnits <= 0n) throw new TradeError("Deposit must be positive", "config");
  const { client, sdk } = session;
  const ata = await client.getAssociatedTokenAccount(QUOTE_MARKET_INDEX);
  const ixs = await client.getDepositTxnIx(new sdk.BN(amountUnits.toString()), QUOTE_MARKET_INDEX, ata, 0);
  return simulateSignSend(session, wallet, ixs);
}

export interface OrderRequest {
  marketIndex: number;
  side: "Long" | "Short";
  baseUnits: bigint; // 1e9
  kind: "market" | "limit";
  /** Limit price, or for market orders the worst acceptable price (1e6). */
  priceUnits: bigint;
  /** Only for limit: reject instead of crossing the book. */
  postOnly: boolean;
  /** Builder to credit, from NEXT_PUBLIC_BUILDER_ADDRESS. Omitted means no builder fee. */
  builder?: { index: number; feeTenthsBp: number };
}

export async function placeOrder(session: Session, wallet: SignerWallet, request: OrderRequest): Promise<SentResult> {
  const { client, sdk } = session;
  if (request.baseUnits <= 0n || request.priceUnits <= 0n) throw new TradeError("Size and price must be positive", "config");
  const builder = request.builder
    ? { builderIdx: request.builder.index, builderFeeTenthBps: clampBuilderFee(request.builder.feeTenthsBp) }
    : {};
  if (request.builder && request.builder.feeTenthsBp > APP_MAX_BUILDER_FEE_TENTHS_BP) {
    // clampBuilderFee already limits what is sent; this keeps the on-screen number honest too.
    throw new TradeError(`Builder fee above the app ceiling of ${APP_MAX_BUILDER_FEE_TENTHS_BP} tenths of a bp`, "config");
  }
  const common = {
    marketIndex: request.marketIndex,
    marketType: sdk.MarketType.PERP,
    direction: request.side === "Long" ? sdk.PositionDirection.LONG : sdk.PositionDirection.SHORT,
    baseAssetAmount: new sdk.BN(request.baseUnits.toString()),
    ...builder,
  };
  const price = new sdk.BN(request.priceUnits.toString());
  const params =
    request.kind === "market"
      ? sdk.getMarketOrderParams({ ...common, auctionEndPrice: price, price })
      : sdk.getOrderParams({
          ...common,
          orderType: sdk.OrderType.LIMIT,
          price,
          postOnly: request.postOnly ? sdk.PostOnlyParams.MUST_POST_ONLY : sdk.PostOnlyParams.NONE,
        });
  const ix = await client.getPlacePerpOrderIx(params, 0);
  return simulateSignSend(session, wallet, [ix]);
}

export async function cancelAllOnMarket(session: Session, wallet: SignerWallet, marketIndex: number): Promise<SentResult> {
  const ix = await session.client.getCancelOrdersIx(session.sdk.MarketType.PERP, marketIndex, null, 0);
  return simulateSignSend(session, wallet, [ix]);
}

/** One-time builder setup: create the user's RevenueShareEscrow and approve the builder up to `maxTenthsBp`. */
export async function approveBuilder(
  session: Session,
  wallet: SignerWallet,
  builder: PublicKey,
  maxTenthsBp: number,
): Promise<SentResult> {
  const max = clampBuilderFee(maxTenthsBp);
  const approve = await session.client.getChangeApprovedBuilderIx(builder, max, true);
  const escrow = await session.client.getInitializeRevenueShareEscrowIx(session.authority, ESCROW_ORDER_SLOTS);
  try {
    return await simulateSignSend(session, wallet, [escrow, approve]);
  } catch (error) {
    // The escrow may already exist from an earlier approval; simulation fails before anything is sent,
    // so it is safe to retry with the approval alone.
    if (error instanceof TradeError && error.code === "simulation") return simulateSignSend(session, wallet, [approve]);
    throw error;
  }
}

/**
 * The market index in the public mainnet-data feed is not guaranteed to match the devnet deployment.
 * Refuse to trade unless the devnet market at that index carries the same symbol name.
 */
export function devnetMarketName(session: Session, marketIndex: number): string | null {
  const account = session.client.getPerpMarketAccount(marketIndex);
  if (!account) return null;
  return session.sdk.decodeName(account.name).trim();
}

export function devnetMarketMatches(session: Session, marketIndex: number, symbol: string): boolean {
  const name = devnetMarketName(session, marketIndex);
  return name !== null && name.toUpperCase() === symbol.toUpperCase();
}

/**
 * Index of `builder` in the user's on-chain `RevenueShareEscrow.approvedBuilders`, or null when the escrow
 * does not exist, the builder is not approved, or its approved ceiling is below `minMaxTenthsBp`.
 * The index is read from chain, never assumed: a wrong index would credit the fee to a different builder.
 */
export async function findApprovedBuilderIndex(
  session: Session,
  builder: PublicKey,
  minMaxTenthsBp: number,
): Promise<number | null> {
  const { client, sdk } = session;
  const address = sdk.getRevenueShareEscrowAccountPublicKey(client.program.programId, session.authority);
  const escrow = (await client.program.account.revenueShareEscrow.fetchNullable(address)) as
    | { approvedBuilders: { authority: PublicKey; maxFeeTenthBps: number }[] }
    | null;
  if (!escrow) return null;
  const index = escrow.approvedBuilders.findIndex((b) => b.authority.equals(builder) && b.maxFeeTenthBps >= minMaxTenthsBp && b.maxFeeTenthBps > 0);
  return index >= 0 ? index : null;
}

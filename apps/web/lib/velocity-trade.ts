/**
 * Browser-side Velocity trading, devnet by default. Mainnet is a separate, opt-in session that always carries
 * hard limits (see trade-network.ts), accepts only the mainnet USDT quote mint, and never offers the test faucet.
 * Everything here runs in the user's browser: instructions are
 * built with the SDK's subscription-free `VelocityCore` (the browser build of the SDK cannot construct
 * `VelocityClient`, `Program` or `AnchorProvider`), the transaction is simulated first, and the user's own
 * wallet signs. There is no server key and the API never sees a transaction. The SDK is imported lazily so
 * it only loads when needed.
 *
 * Verified on devnet by the owner (Phantom, 2026-11-03): faucet mint, account creation plus deposit, market
 * orders and cancel (see docs/DEVNET-TRADING.md). Not verified on chain: reduce-only close, builder codes,
 * limit orders. Simulation-first means a bad build fails before anything is sent.
 */
import type {
  AccountMeta,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { APP_MAX_BUILDER_FEE_TENTHS_BP, clampBuilderFee, isDevnetRpc } from "./trade-math";
import { makeProgram, type ProgramShim } from "./velocity-program";
import {
  MAINNET_QUOTE_MINT,
  depositLimitError,
  isMainnetRpc,
  orderLimitError,
  type TradeLimits,
  type TradeNetwork,
} from "./trade-network";

export const DEVNET_RPC_DEFAULT = "https://api.devnet.solana.com";
export const QUOTE_MARKET_INDEX = 0; // dUSDT on devnet
const ESCROW_ORDER_SLOTS = 16;
const MAX_PERP_MARKETS = 16;
const MAX_SPOT_MARKETS = 8;
const COMPUTE_UNITS = 800_000;
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** The SDK's devnet token faucet. On the Velocity devnet deployment it is the mint authority of dUSDT, so anyone may mint test tokens. */
export const TOKEN_FAUCET_PROGRAM = "V4v1mQiAdLz4qwckEb45WqHYceYizoib39cDBHSWfaB";
const FAUCET_MINT_TO_USER = [75, 194, 44, 77, 10, 65, 232, 85]; // sighash("global:mint_to_user"), from the faucet IDL
export const FAUCET_AMOUNT_UNITS = 100_000_000n; // 100 dUSDT per click

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
type Web3 = typeof import("@solana/web3.js");

interface LoadedMarket {
  pubkey: PublicKey;
  [field: string]: unknown;
}

interface Core {
  programId: PublicKey;
  program: ProgramShim;
  state: PublicKey;
  whitelistMint: PublicKey;
  perpMarkets: Map<number, LoadedMarket>;
  spotMarkets: Map<number, LoadedMarket>;
  quoteMint: PublicKey;
  quoteTokenProgram: PublicKey;
  /** The program's PDA signer from `State.signer`; withdrawals pay out of the vault through it. */
  velocitySigner: PublicKey;
  /** True when the dUSDT mint authority is the token faucet's PDA, so test tokens can be minted from the wallet. */
  faucet: boolean;
}

export interface Session {
  connection: Connection;
  authority: PublicKey;
  sdk: Sdk;
  web3: Web3;
  core: Core;
  network: TradeNetwork;
  /** Always set on mainnet; undefined on devnet. */
  limits?: TradeLimits;
  close: () => Promise<void>;
}

export interface SentResult {
  signature: string;
}

export async function loadCore(sdk: Sdk, web3: Web3, connection: Connection, expectedQuoteMint?: string): Promise<Core> {
  const { VelocityCore } = sdk;
  const program = makeProgram(sdk, web3);
  const programId = program.programId;
  const { pdas } = VelocityCore;
  const { coder } = program;
  const state = await pdas.getVelocityStateAccountPublicKey(programId);
  const perpKeys = Array.from({ length: MAX_PERP_MARKETS }, (_, i) => pdas.getPerpMarketPublicKeySync(programId, i));
  const spotKeys = Array.from({ length: MAX_SPOT_MARKETS }, (_, i) => pdas.getSpotMarketPublicKeySync(programId, i));
  const infos = await connection.getMultipleAccountsInfo([state, ...spotKeys, ...perpKeys], "confirmed");
  const stateInfo = infos[0];
  if (!stateInfo) {
    throw new TradeError("Velocity program state was not found on this RPC. Is it a devnet endpoint?", "config");
  }
  const stateAccount = coder.accounts.decode<{ whitelistMint: PublicKey; signer: PublicKey }>("state", stateInfo.data as never);
  const spotMarkets = new Map<number, LoadedMarket>();
  const perpMarkets = new Map<number, LoadedMarket>();
  spotKeys.forEach((key, i) => {
    const info = infos[1 + i];
    if (info) spotMarkets.set(i, { ...coder.accounts.decode<Record<string, unknown>>("spotMarket", info.data as never), pubkey: key });
  });
  perpKeys.forEach((key, i) => {
    const info = infos[1 + MAX_SPOT_MARKETS + i];
    if (info) perpMarkets.set(i, { ...coder.accounts.decode<Record<string, unknown>>("perpMarket", info.data as never), pubkey: key });
  });
  const quote = spotMarkets.get(QUOTE_MARKET_INDEX);
  if (!quote) throw new TradeError("Spot market 0 (dUSDT) was not found on this devnet deployment", "config");
  const quoteMint = quote.mint as PublicKey;
  if (expectedQuoteMint && quoteMint.toBase58() !== expectedQuoteMint) {
    throw new TradeError(
      `Spot market 0 uses mint ${quoteMint.toBase58()}, not the expected ${expectedQuoteMint}. Refusing to continue.`,
      "config",
    );
  }
  const mintInfo = await connection.getAccountInfo(quoteMint, "confirmed");
  if (!mintInfo) throw new TradeError("The dUSDT mint account was not found on this RPC", "config");
  const owner = mintInfo.owner.toBase58();
  if (owner !== TOKEN_PROGRAM && owner !== TOKEN_2022_PROGRAM) {
    throw new TradeError(`The dUSDT mint is owned by an unexpected program (${owner})`, "config");
  }
  // SPL mint layout: u32 option tag, then the 32-byte mint authority.
  const faucetAuthority = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority"), quoteMint.toBuffer()],
    new web3.PublicKey(TOKEN_FAUCET_PROGRAM),
  )[0];
  const faucet =
    owner === TOKEN_PROGRAM &&
    mintInfo.data.length >= 36 &&
    mintInfo.data.readUInt32LE(0) === 1 &&
    new web3.PublicKey(mintInfo.data.subarray(4, 36)).equals(faucetAuthority);
  return {
    programId,
    program,
    state,
    whitelistMint: stateAccount.whitelistMint,
    perpMarkets,
    spotMarkets,
    quoteMint,
    quoteTokenProgram: mintInfo.owner,
    velocitySigner: stateAccount.signer,
    faucet,
  };
}

export async function openSession(
  wallet: SignerWallet,
  rpcUrl: string = DEVNET_RPC_DEFAULT,
  network: TradeNetwork = "devnet",
  limits?: TradeLimits,
): Promise<Session> {
  // Hard guards: the RPC must match the network, and mainnet never opens without limits.
  if (network === "devnet" && !isDevnetRpc(rpcUrl)) throw new TradeError("Only a devnet RPC endpoint is allowed for test trading.", "config");
  if (network === "mainnet-beta") {
    if (!isMainnetRpc(rpcUrl)) {
      throw new TradeError("Mainnet needs a mainnet RPC endpoint. Set NEXT_PUBLIC_SOLANA_RPC_URL to an https mainnet RPC and redeploy.", "config");
    }
    if (!limits) throw new TradeError("Mainnet trading requires safety limits", "config");
  }
  const [sdk, web3] = await Promise.all([import("@velocity-exchange/sdk"), import("@solana/web3.js")]);
  const connection = new web3.Connection(rpcUrl, "confirmed");
  const core = await loadCore(sdk, web3, connection, network === "mainnet-beta" ? MAINNET_QUOTE_MINT : undefined);
  return {
    connection,
    authority: wallet.publicKey,
    sdk,
    web3,
    core: { ...core, faucet: network === "devnet" && core.faucet },
    network,
    ...(network === "mainnet-beta" ? { limits } : {}),
    close: async () => undefined,
  };
}

const userAddress = (session: Session) =>
  session.sdk.VelocityCore.pdas.getUserAccountPublicKeySync(session.core.programId, session.authority, 0);
const userStatsAddress = (session: Session) =>
  session.sdk.VelocityCore.pdas.getUserStatsAccountPublicKey(session.core.programId, session.authority);
const escrowAddress = (session: Session) =>
  session.sdk.VelocityCore.pdas.getRevenueShareEscrowAccountPublicKey(session.core.programId, session.authority);

function quoteTokenAccount(session: Session, owner: PublicKey = session.authority): PublicKey {
  const { web3, core } = session;
  return web3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), core.quoteTokenProgram.toBuffer(), core.quoteMint.toBuffer()],
    new web3.PublicKey(ASSOCIATED_TOKEN_PROGRAM),
  )[0];
}

async function accountExists(session: Session, address: PublicKey): Promise<boolean> {
  return (await session.connection.getAccountInfo(address, "confirmed")) !== null;
}

/** True when the wallet already has subaccount 0. A missing account is a normal first-use state. */
export async function hasUserAccount(session: Session): Promise<boolean> {
  return accountExists(session, userAddress(session));
}

/** Token amount (in token base units) behind a scaled spot balance: scaled (1e9) * cumulative interest (1e10) / 10^(19 - decimals). */
export function spotTokenUnits(scaledBalance: bigint, cumulativeInterest: bigint, decimals: number): bigint {
  return (scaledBalance * cumulativeInterest) / 10n ** BigInt(19 - decimals);
}

export interface PositionSummary {
  marketIndex: number;
  /** Signed size, 1e9 base units. Positive is long, negative is short. */
  baseUnits: bigint;
  /** Quote the position was entered with (1e6), excluding fees and funding. */
  entryQuoteUnits: bigint;
  openOrders: number;
}

export interface AccountSummary {
  /** Net quote-token collateral in dUSDT base units (6 decimals); negative means a borrow. Uses the interest index read when the session opened. */
  collateralUnits: bigint;
  /** Perp positions that are non-zero or have open orders. */
  positions: PositionSummary[];
}

const big = (value: unknown): bigint => BigInt((value as { toString(): string }).toString());

/** Reads subaccount 0. Returns null when the account does not exist yet. Read-only, no wallet needed. */
export async function readAccountSummary(session: Session): Promise<AccountSummary | null> {
  const user = await session.sdk.VelocityCore.fetchUserAccount(session.connection, userAddress(session));
  if (!user) return null;
  const quote = session.core.spotMarkets.get(QUOTE_MARKET_INDEX);
  let collateralUnits = 0n;
  for (const position of user.spotPositions) {
    if (position.marketIndex !== QUOTE_MARKET_INDEX) continue;
    const scaled = big(position.scaledBalance);
    if (scaled === 0n) continue;
    const isBorrow = "borrow" in (position.balanceType as object);
    const interest = big(isBorrow ? quote?.cumulativeBorrowInterest ?? 10n ** 10n : quote?.cumulativeDepositInterest ?? 10n ** 10n);
    const amount = spotTokenUnits(scaled, interest, 6);
    collateralUnits += isBorrow ? -amount : amount;
  }
  const positions: PositionSummary[] = [];
  for (const position of user.perpPositions) {
    const baseUnits = big(position.baseAssetAmount);
    if (baseUnits === 0n && position.openOrders === 0) continue;
    positions.push({
      marketIndex: position.marketIndex,
      baseUnits,
      entryQuoteUnits: big(position.quoteEntryAmount),
      openOrders: position.openOrders,
    });
  }
  return { collateralUnits, positions };
}

/** dUSDT balance of the wallet's token account in base units (6 decimals), or 0n when it has none. */
export async function walletQuoteBalance(session: Session): Promise<bigint> {
  try {
    const balance = await session.connection.getTokenAccountBalance(quoteTokenAccount(session), "confirmed");
    return BigInt(balance.value.amount);
  } catch {
    return 0n;
  }
}

function marketLookup(map: Map<number, LoadedMarket>, kind: string) {
  return (index: number) => {
    const market = map.get(index);
    if (!market) throw new TradeError(`${kind} market ${index} is not available on this devnet deployment`, "config");
    return market as never;
  };
}

type RemainingParams = Parameters<Sdk["VelocityCore"]["remainingAccounts"]["getRemainingAccounts"]>[1];

function remainingAccounts(session: Session, params: Partial<RemainingParams>): AccountMeta[] {
  const { core, authority } = session;
  return session.sdk.VelocityCore.remainingAccounts.getRemainingAccounts(
    {
      getPerpMarketAccount: marketLookup(core.perpMarkets, "Perp"),
      getSpotMarketAccount: marketLookup(core.spotMarkets, "Spot"),
      getUserAccountAndSlot: () => undefined,
      activeSubAccountId: 0,
      authority,
      perpMarketLastSlotCache: new Map(),
      spotMarketLastSlotCache: new Map(),
      mustIncludePerpMarketIndexes: new Set(),
      mustIncludeSpotMarketIndexes: new Set(),
    },
    { userAccounts: [], ...params } as RemainingParams,
  );
}

async function fetchUser(session: Session) {
  const account = await session.sdk.VelocityCore.fetchUserAccount(session.connection, userAddress(session));
  if (!account) throw new TradeError("Create the Velocity account first", "config");
  return account;
}

/** Deposit instruction for the quote market. `existingUser` is the decoded user, or null when it is being created in the same transaction. */
async function depositInstruction(
  session: Session,
  amountUnits: bigint,
  existingUser: Awaited<ReturnType<typeof fetchUser>> | null,
): Promise<TransactionInstruction> {
  const { sdk, core, authority } = session;
  const spot = core.spotMarkets.get(QUOTE_MARKET_INDEX)!;
  const remaining = remainingAccounts(session, {
    userAccounts: existingUser ? [existingUser] : [],
    writableSpotMarketIndexes: [QUOTE_MARKET_INDEX],
  });
  // Token-2022 mints must be passed so the program can read them. Transfer hooks are not supported here.
  if (core.quoteTokenProgram.toBase58() === TOKEN_2022_PROGRAM) {
    remaining.push({ pubkey: core.quoteMint, isSigner: false, isWritable: false });
  }
  return sdk.VelocityCore.buildDepositInstruction({
    program: core.program as never,
    marketIndex: QUOTE_MARKET_INDEX,
    amount: new sdk.BN(amountUnits.toString()),
    reduceOnly: false,
    state: core.state,
    spotMarket: spot.pubkey,
    spotMarketVault: spot.vault as PublicKey,
    user: userAddress(session),
    userStats: userStatsAddress(session),
    userTokenAccount: quoteTokenAccount(session),
    authority,
    tokenProgram: core.quoteTokenProgram,
    remainingAccounts: remaining,
  });
}

async function initializeInstructions(session: Session): Promise<TransactionInstruction[]> {
  const { sdk, web3, core, authority } = session;
  const out: TransactionInstruction[] = [];
  const common = { rent: web3.SYSVAR_RENT_PUBKEY, systemProgram: web3.SystemProgram.programId, state: core.state };
  if (!(await accountExists(session, userStatsAddress(session)))) {
    out.push(
      core.program.instruction.initializeUserStats({
        accounts: { userStats: userStatsAddress(session), authority, payer: authority, ...common },
      }),
    );
  }
  const remaining: AccountMeta[] = [];
  if (!core.whitelistMint.equals(web3.PublicKey.default)) {
    // Whitelisted deployments expect the payer's token account for the whitelist mint.
    const ata = web3.PublicKey.findProgramAddressSync(
      [authority.toBuffer(), new web3.PublicKey(TOKEN_PROGRAM).toBuffer(), core.whitelistMint.toBuffer()],
      new web3.PublicKey(ASSOCIATED_TOKEN_PROGRAM),
    )[0];
    remaining.push({ pubkey: ata, isSigner: false, isWritable: false });
  }
  out.push(
    core.program.instruction.initializeUser(0, sdk.encodeName(sdk.DEFAULT_USER_NAME), {
      accounts: { user: userAddress(session), userStats: userStatsAddress(session), authority, payer: authority, ...common },
      remainingAccounts: remaining,
    }),
  );
  return out;
}

interface Built {
  tx: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

async function build(session: Session, payer: PublicKey, ixs: TransactionInstruction[]): Promise<Built> {
  const { web3, connection } = session;
  const latest = await connection.getLatestBlockhash("confirmed");
  const message = new web3.TransactionMessage({
    payerKey: payer,
    recentBlockhash: latest.blockhash,
    instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }), ...ixs],
  }).compileToV0Message();
  return { tx: new web3.VersionedTransaction(message), blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight };
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
  const { tx, blockhash, lastValidBlockHeight } = await build(session, wallet.publicKey, ixs);
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
    const result = await session.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (result.value.err) throw new TradeError(`Transaction failed on chain: ${JSON.stringify(result.value.err)}`, "failed");
  } catch (error) {
    if (error instanceof TradeError) throw error;
    throw new TradeError(`Submitted (${signature}) but confirmation did not finish. It may or may not have gone through; check the explorer before retrying.`, "ambiguous");
  }
  return { signature };
}

/** Idempotent create of the wallet's associated token account for the quote mint (no-op when it already exists). */
function createQuoteTokenAccountInstruction(session: Session, tokenProgram: PublicKey): TransactionInstruction {
  const { web3, core, authority } = session;
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(ASSOCIATED_TOKEN_PROGRAM),
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: quoteTokenAccount(session), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: core.quoteMint, isSigner: false, isWritable: false },
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });
}

/** Mint test dUSDT to the wallet from the devnet token faucet, creating the wallet's token account if needed. */
export async function mintTestQuote(session: Session, wallet: SignerWallet, amountUnits: bigint = FAUCET_AMOUNT_UNITS): Promise<SentResult> {
  const { web3, core } = session;
  if (session.network !== "devnet") throw new TradeError("The test faucet only exists on devnet", "config");
  if (!core.faucet) throw new TradeError("The dUSDT mint on this deployment is not controlled by the token faucet", "config");
  if (amountUnits <= 0n || amountUnits > FAUCET_AMOUNT_UNITS * 10n) throw new TradeError("Faucet amount out of range", "config");
  const faucetProgram = new web3.PublicKey(TOKEN_FAUCET_PROGRAM);
  const tokenProgram = new web3.PublicKey(TOKEN_PROGRAM);
  const mint = core.quoteMint;
  const ata = quoteTokenAccount(session);
  const [config] = web3.PublicKey.findProgramAddressSync([Buffer.from("faucet_config"), mint.toBuffer()], faucetProgram);
  const [mintAuthority] = web3.PublicKey.findProgramAddressSync([Buffer.from("mint_authority"), mint.toBuffer()], faucetProgram);
  const createAta = createQuoteTokenAccountInstruction(session, tokenProgram);
  // Plain Uint8Array + DataView: the Buffer polyfill in the browser bundle has no BigInt read/write methods.
  const bytes = new Uint8Array(16);
  bytes.set(FAUCET_MINT_TO_USER);
  new DataView(bytes.buffer).setBigUint64(8, amountUnits, true);
  const data = Buffer.from(bytes);
  const mintTo = new web3.TransactionInstruction({
    programId: faucetProgram,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data,
  });
  return simulateSignSend(session, wallet, [createAta, mintTo]);
}

/** First use: create subaccount 0 and deposit dUSDT in one transaction. `amountUnits` is in 1e6 base units. */
export async function createAccountAndDeposit(session: Session, wallet: SignerWallet, amountUnits: bigint): Promise<SentResult> {
  if (amountUnits <= 0n) throw new TradeError("Deposit must be positive", "config");
  const limitError = depositLimitError(session.limits, amountUnits, (await readAccountSummary(session))?.collateralUnits ?? 0n);
  if (limitError) throw new TradeError(limitError, "config");
  const init = await initializeInstructions(session);
  const deposit = await depositInstruction(session, amountUnits, null);
  return simulateSignSend(session, wallet, [...init, deposit]);
}

export async function depositMore(session: Session, wallet: SignerWallet, amountUnits: bigint): Promise<SentResult> {
  if (amountUnits <= 0n) throw new TradeError("Deposit must be positive", "config");
  const limitError = depositLimitError(session.limits, amountUnits, (await readAccountSummary(session))?.collateralUnits ?? 0n);
  if (limitError) throw new TradeError(limitError, "config");
  const user = await fetchUser(session);
  return simulateSignSend(session, wallet, [await depositInstruction(session, amountUnits, user)]);
}

/**
 * Withdraws dUSDT from subaccount 0 back to the wallet's token account (created if missing). The withdrawal is
 * always reduce-only: it is capped to the current deposit balance and can never open a borrow. The program still
 * enforces margin, so with an open position a large withdrawal fails in simulation before the wallet is asked.
 * `amountUnits` is in 1e6 base units.
 */
export async function withdrawQuote(session: Session, wallet: SignerWallet, amountUnits: bigint): Promise<SentResult> {
  if (amountUnits <= 0n) throw new TradeError("Withdrawal must be positive", "config");
  const { sdk, core, authority } = session;
  const user = await fetchUser(session);
  const spot = core.spotMarkets.get(QUOTE_MARKET_INDEX)!;
  const remaining = remainingAccounts(session, { userAccounts: [user], writableSpotMarketIndexes: [QUOTE_MARKET_INDEX] });
  if (core.quoteTokenProgram.toBase58() === TOKEN_2022_PROGRAM) {
    remaining.push({ pubkey: core.quoteMint, isSigner: false, isWritable: false });
  }
  const withdraw = await sdk.VelocityCore.buildWithdrawInstruction({
    program: core.program as never,
    marketIndex: QUOTE_MARKET_INDEX,
    amount: new sdk.BN(amountUnits.toString()),
    reduceOnly: true,
    state: core.state,
    spotMarket: spot.pubkey,
    spotMarketVault: spot.vault as PublicKey,
    velocitySigner: core.velocitySigner,
    user: userAddress(session),
    userStats: userStatsAddress(session),
    userTokenAccount: quoteTokenAccount(session),
    authority,
    tokenProgram: core.quoteTokenProgram,
    remainingAccounts: remaining,
  });
  return simulateSignSend(session, wallet, [createQuoteTokenAccountInstruction(session, core.quoteTokenProgram), withdraw]);
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
  /** The order may only shrink an existing position (used to close one). */
  reduceOnly?: boolean;
  /** Builder to credit, from NEXT_PUBLIC_BUILDER_ADDRESS. Omitted means no builder fee. */
  builder?: { index: number; feeTenthsBp: number };
}

export async function placeOrder(session: Session, wallet: SignerWallet, request: OrderRequest): Promise<SentResult> {
  const { sdk, core } = session;
  if (request.baseUnits <= 0n || request.priceUnits <= 0n) throw new TradeError("Size and price must be positive", "config");
  const limitError = orderLimitError(session.limits, request.baseUnits, request.priceUnits, request.reduceOnly === true);
  if (limitError) throw new TradeError(limitError, "config");
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
    ...(request.reduceOnly ? { reduceOnly: true } : {}),
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
  const orderParams = sdk.getOrderParams(params, { marketType: sdk.MarketType.PERP });
  const remaining = remainingAccounts(session, {
    userAccounts: [await fetchUser(session)],
    readablePerpMarketIndex: request.marketIndex,
  });
  if (request.builder) remaining.push({ pubkey: escrowAddress(session), isSigner: false, isWritable: true });
  const ix = await sdk.VelocityCore.buildPlacePerpOrderInstruction({
    program: core.program as never,
    orderParams,
    state: core.state,
    user: userAddress(session),
    userStats: userStatsAddress(session),
    authority: session.authority,
    remainingAccounts: remaining,
  });
  return simulateSignSend(session, wallet, [ix]);
}

/**
 * Closes (or shrinks) a perp position with a reduce-only market order in the opposite direction.
 * `closeUnits` is a positive size in 1e9 base units and may not exceed the position.
 */
export async function closePosition(
  session: Session,
  wallet: SignerWallet,
  position: Pick<PositionSummary, "marketIndex" | "baseUnits">,
  closeUnits: bigint,
  worstPriceUnits: bigint,
): Promise<SentResult> {
  const held = position.baseUnits < 0n ? -position.baseUnits : position.baseUnits;
  if (held === 0n) throw new TradeError("There is no open position on this market", "config");
  if (closeUnits <= 0n || closeUnits > held) throw new TradeError("Close size must be positive and at most the position size", "config");
  return placeOrder(session, wallet, {
    marketIndex: position.marketIndex,
    side: position.baseUnits > 0n ? "Short" : "Long",
    baseUnits: closeUnits,
    kind: "market",
    priceUnits: worstPriceUnits,
    postOnly: false,
    reduceOnly: true,
  });
}

export async function cancelAllOnMarket(session: Session, wallet: SignerWallet, marketIndex: number): Promise<SentResult> {
  const { sdk, core } = session;
  const remaining = remainingAccounts(session, {
    userAccounts: [await fetchUser(session)],
    readablePerpMarketIndex: marketIndex,
  });
  const ix = await sdk.VelocityCore.buildCancelOrdersInstruction({
    program: core.program as never,
    marketType: sdk.MarketType.PERP,
    marketIndex,
    direction: null,
    user: userAddress(session),
    state: core.state,
    userStats: userStatsAddress(session),
    authority: session.authority,
    remainingAccounts: remaining,
  });
  return simulateSignSend(session, wallet, [ix]);
}

/** One-time builder setup: create the user's RevenueShareEscrow if missing and approve the builder up to `maxTenthsBp`. */
export async function approveBuilder(
  session: Session,
  wallet: SignerWallet,
  builder: PublicKey,
  maxTenthsBp: number,
): Promise<SentResult> {
  const { web3, core, authority } = session;
  const max = clampBuilderFee(maxTenthsBp);
  const escrow = escrowAddress(session);
  const ixs: TransactionInstruction[] = [];
  if (!(await accountExists(session, escrow))) {
    ixs.push(
      core.program.instruction.initializeRevenueShareEscrow(ESCROW_ORDER_SLOTS, {
        accounts: {
          escrow,
          authority,
          payer: authority,
          userStats: userStatsAddress(session),
          state: core.state,
          rent: web3.SYSVAR_RENT_PUBKEY,
          systemProgram: web3.SystemProgram.programId,
        },
      }),
    );
  }
  ixs.push(
    core.program.instruction.changeApprovedBuilder(builder, max, true, {
      accounts: { escrow, authority, payer: authority, systemProgram: web3.SystemProgram.programId },
    }),
  );
  return simulateSignSend(session, wallet, ixs);
}

/**
 * The market index in the public mainnet-data feed is not guaranteed to match the devnet deployment.
 * Refuse to trade unless the devnet market at that index carries the same symbol name.
 */
export function devnetMarketName(session: Session, marketIndex: number): string | null {
  const account = session.core.perpMarkets.get(marketIndex);
  if (!account) return null;
  return session.sdk.decodeName(account.name as number[]).trim();
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
  const info = await session.connection.getAccountInfo(escrowAddress(session), "confirmed");
  if (!info) return null;
  const escrow = session.core.program.coder.accounts.decode<{
    approvedBuilders: { authority: PublicKey; maxFeeTenthBps: number }[];
  }>("revenueShareEscrow", info.data as never);
  const index = escrow.approvedBuilders.findIndex(
    (b) => b.authority.equals(builder) && b.maxFeeTenthBps >= minMaxTenthsBp && b.maxFeeTenthBps > 0,
  );
  return index >= 0 ? index : null;
}

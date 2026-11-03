import { describe, expect, it } from "vitest";
import * as web3 from "@solana/web3.js";
import {
  cancelAllOnMarket,
  closePosition,
  createAccountAndDeposit,
  depositMore,
  devnetMarketMatches,
  devnetMarketName,
  findApprovedBuilderIndex,
  FAUCET_AMOUNT_UNITS,
  loadCore,
  mintTestQuote,
  placeOrder,
  readAccountSummary,
  spotTokenUnits,
  TOKEN_FAUCET_PROGRAM,
  approveBuilder,
  withdrawQuote,
  TradeError,
  type Session,
  type SignerWallet,
} from "./velocity-trade";

const sdk = await import("@velocity-exchange/sdk");
const { Keypair, PublicKey } = web3;

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const key = () => Keypair.generate().publicKey;
const authority = key();
const mint = key();
const vault = key();
const oracle = key();

/** An account of the given Anchor type, zero-filled except for the fields set. Built through the real coder, so names must be right. */
async function account(program: Awaited<ReturnType<typeof loadCore>>["program"], name: string, fields: Record<string, unknown>) {
  const { coder } = program;
  const blank = coder.accounts.decode<Record<string, unknown>>(name, zeroAccount(program, name) as never);
  return coder.accounts.encode(name, { ...blank, ...fields });
}

function zeroAccount(program: { coder: { accounts: { size(name: string): number } } }, name: string) {
  const idl = sdk.VelocityCore.defaultIdl() as unknown as { accounts: { name: string; discriminator: number[] }[] };
  const camel = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const entry = idl.accounts.find((a) => camel(a.name) === name)!;
  const buffer = Buffer.alloc(program.coder.accounts.size(name));
  Buffer.from(entry.discriminator).copy(buffer);
  return buffer;
}

async function loadCoreWith() {
  // First pass only to get the coder and program id; accounts are then built with it.
  const shell = await import("./velocity-program").then((m) => m.makeProgram(sdk, web3));
  const programId = shell.programId;
  const { pdas } = sdk.VelocityCore;
  const statePk = await pdas.getVelocityStateAccountPublicKey(programId);
  const spot0 = pdas.getSpotMarketPublicKeySync(programId, 0);
  const perp1 = pdas.getPerpMarketPublicKeySync(programId, 1);
  const nameBytes = sdk.encodeName("BTC-PERP");
  const data = new Map<string, Buffer>();
  data.set(statePk.toBase58(), await account(shell, "state", {}));
  data.set(spot0.toBase58(), await account(shell, "spotMarket", { mint, vault, oracle, cumulativeDepositInterest: new sdk.BN("10000000000") }));
  data.set(perp1.toBase58(), await account(shell, "perpMarket", { name: nameBytes, oracle, quoteSpotMarketIndex: 0 }));
  return { shell, programId, data, statePk, spot0, perp1 };
}

function fakeConnection(data: Map<string, Buffer>, extra: Map<string, { data: Buffer; owner: web3.PublicKey }> = new Map()) {
  const info = (pk: web3.PublicKey) => {
    const found = extra.get(pk.toBase58());
    if (found) return { data: found.data, owner: found.owner, lamports: 1, executable: false };
    const bytes = data.get(pk.toBase58());
    return bytes ? { data: bytes, owner: key(), lamports: 1, executable: false } : null;
  };
  const sent: web3.VersionedTransaction[] = [];
  const connection = {
    getMultipleAccountsInfo: async (keys: web3.PublicKey[]) => keys.map(info),
    getAccountInfo: async (pk: web3.PublicKey) => info(pk),
    getLatestBlockhash: async () => ({ blockhash: web3.PublicKey.default.toBase58(), lastValidBlockHeight: 1000 }),
    simulateTransaction: async (tx: web3.VersionedTransaction) => {
      sent.push(tx);
      return { value: { err: null, logs: [] } };
    },
    getTokenAccountBalance: async () => ({ value: { amount: "2500000" } }),
  };
  return { connection: connection as unknown as web3.Connection, sent };
}

const declining: SignerWallet = {
  publicKey: authority,
  signTransaction: async () => {
    throw new Error("test wallet declines after simulation");
  },
  signAllTransactions: async () => {
    throw new Error("unused");
  },
};

/** SPL mint data (82 bytes) whose mint authority is `authorityKey`, or no authority at all. */
function mintData(authorityKey?: web3.PublicKey) {
  const data = Buffer.alloc(82);
  if (authorityKey) {
    data.writeUInt32LE(1, 0);
    authorityKey.toBuffer().copy(data, 4);
  }
  return data;
}

async function session(extra: Map<string, { data: Buffer; owner: web3.PublicKey }> = new Map(), mintAuthority?: web3.PublicKey) {
  const f = await loadCoreWith();
  extra.set(mint.toBase58(), { data: mintData(mintAuthority), owner: TOKEN_PROGRAM });
  const fake = fakeConnection(f.data, extra);
  const core = await loadCore(sdk, web3, fake.connection);
  const s: Session = { connection: fake.connection, authority, sdk, web3, core, close: async () => undefined };
  return { s, sent: fake.sent, f, extra };
}

/** Program ids of the instructions in a compiled v0 transaction, in order. */
const programIds = (tx: web3.VersionedTransaction) =>
  tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex]!.toBase58());

describe("velocity trade session (offline, fake RPC)", () => {
  it("loads state, markets and the quote mint through the camelCase coder", async () => {
    const { s } = await session();
    expect(s.core.perpMarkets.has(1)).toBe(true);
    expect(s.core.perpMarkets.has(0)).toBe(false);
    expect(String(s.core.spotMarkets.get(0)!.mint)).toBe(mint.toBase58());
    expect(String(s.core.spotMarkets.get(0)!.vault)).toBe(vault.toBase58());
    expect(s.core.quoteTokenProgram.toBase58()).toBe(TOKEN_PROGRAM.toBase58());
    expect(devnetMarketName(s, 1)).toBe("BTC-PERP");
    expect(devnetMarketMatches(s, 1, "btc-perp")).toBe(true);
    expect(devnetMarketMatches(s, 1, "SOL-PERP")).toBe(false);
    expect(devnetMarketMatches(s, 0, "SOL-PERP")).toBe(false);
  });

  it("rejects an RPC that has no Velocity state", async () => {
    const fake = fakeConnection(new Map());
    await expect(loadCore(sdk, web3, fake.connection)).rejects.toThrow(/state was not found/);
  });

  it("builds create-account-and-deposit as stats, user, deposit and simulates before the wallet is asked", async () => {
    const { s, sent } = await session();
    await expect(createAccountAndDeposit(s, declining, 1_000_000n)).rejects.toMatchObject({ code: "rejected" });
    expect(sent).toHaveLength(1); // simulated exactly once, then the wallet declined
    const ids = programIds(sent[0]!);
    const velocity = s.core.programId.toBase58();
    expect(ids).toEqual([web3.ComputeBudgetProgram.programId.toBase58(), velocity, velocity, velocity]);
    const keys = sent[0]!.message.staticAccountKeys.map((k) => k.toBase58());
    const pdas = sdk.VelocityCore.pdas;
    expect(keys).toContain(pdas.getUserAccountPublicKeySync(s.core.programId, authority, 0).toBase58());
    expect(keys).toContain(pdas.getUserStatsAccountPublicKey(s.core.programId, authority).toBase58());
    expect(keys).toContain(vault.toBase58());
    expect(keys).toContain(oracle.toBase58());
    // The depositor's own token account is the associated account for the dUSDT mint.
    const ata = PublicKey.findProgramAddressSync(
      [authority.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    )[0];
    expect(keys).toContain(ata.toBase58());
  });

  it("skips creating stats when they already exist", async () => {
    const f = await loadCoreWith();
    const stats = sdk.VelocityCore.pdas.getUserStatsAccountPublicKey(f.programId, authority);
    const extra = new Map([[stats.toBase58(), { data: Buffer.alloc(8), owner: f.programId }]]);
    const { s, sent } = await session(extra);
    await expect(createAccountAndDeposit(s, declining, 1_000_000n)).rejects.toMatchObject({ code: "rejected" });
    expect(programIds(sent[0]!)).toHaveLength(3); // budget, initUser, deposit
  });

  it("refuses a non-positive deposit and a deposit without an account", async () => {
    const { s } = await session();
    await expect(createAccountAndDeposit(s, declining, 0n)).rejects.toBeInstanceOf(TradeError);
    await expect(depositMore(s, declining, 1n)).rejects.toThrow(/Create the Velocity account first/);
  });

  it("places and cancels orders for an existing account, with the builder escrow appended", async () => {
    const f = await loadCoreWith();
    const userPk = sdk.VelocityCore.pdas.getUserAccountPublicKeySync(f.programId, authority, 0);
    const userBytes = zeroAccount(f.shell, "user");
    const extra = new Map([[userPk.toBase58(), { data: userBytes, owner: f.programId }]]);
    const { s, sent } = await session(extra);
    const request = { marketIndex: 1, side: "Long" as const, baseUnits: 10_000_000n, kind: "market" as const, priceUnits: 77_500_000_000n, postOnly: false };
    await expect(placeOrder(s, declining, { ...request, builder: { index: 0, feeTenthsBp: 20 } })).rejects.toMatchObject({ code: "rejected" });
    const escrow = sdk.VelocityCore.pdas.getRevenueShareEscrowAccountPublicKey(f.programId, authority).toBase58();
    expect(sent[0]!.message.staticAccountKeys.map((k) => k.toBase58())).toContain(escrow);
    await expect(placeOrder(s, declining, request)).rejects.toMatchObject({ code: "rejected" });
    expect(sent[1]!.message.staticAccountKeys.map((k) => k.toBase58())).not.toContain(escrow);
    await expect(cancelAllOnMarket(s, declining, 1)).rejects.toMatchObject({ code: "rejected" });
    await expect(placeOrder(s, declining, { ...request, marketIndex: 7 })).rejects.toThrow(/Perp market 7 is not available/);
    await expect(placeOrder(s, declining, { ...request, baseUnits: 0n })).rejects.toBeInstanceOf(TradeError);
  });

  it("approves a builder, creating the escrow only when it is missing", async () => {
    const builder = key();
    const { s, sent } = await session();
    await expect(approveBuilder(s, declining, builder, 20)).rejects.toMatchObject({ code: "rejected" });
    expect(programIds(sent[0]!)).toHaveLength(3); // budget, init escrow, approve
    const f = await loadCoreWith();
    const escrow = sdk.VelocityCore.pdas.getRevenueShareEscrowAccountPublicKey(f.programId, authority);
    const existing = new Map([[escrow.toBase58(), { data: Buffer.alloc(8), owner: f.programId }]]);
    const second = await session(existing);
    await expect(approveBuilder(second.s, declining, builder, 20)).rejects.toMatchObject({ code: "rejected" });
    expect(programIds(second.sent[0]!)).toHaveLength(2); // budget, approve
  });

  it("reads the approved builder index from the escrow account", async () => {
    const f = await loadCoreWith();
    const builder = key();
    const other = key();
    const escrowPk = sdk.VelocityCore.pdas.getRevenueShareEscrowAccountPublicKey(f.programId, authority);
    // Variable-length account, so build the struct by hand instead of decoding a zero buffer.
    const blank = { authority, referrer: PublicKey.default, reservedFixed: new Array(24).fill(0), padding0: 0, padding1: 0 };
    const entry = (authorityKey: web3.PublicKey, max: number) => ({ authority: authorityKey, maxFeeTenthBps: max, padding: [0, 0, 0, 0, 0, 0] });
    const encoded = await f.shell.coder.accounts.encode("revenueShareEscrow", {
      ...blank,
      authority,
      orders: [],
      approvedBuilders: [entry(other, 50), entry(builder, 20)],
    });
    const { s } = await session(new Map([[escrowPk.toBase58(), { data: encoded, owner: f.programId }]]));
    expect(await findApprovedBuilderIndex(s, builder, 20)).toBe(1);
    expect(await findApprovedBuilderIndex(s, builder, 30)).toBeNull(); // approved ceiling too low
    expect(await findApprovedBuilderIndex(s, key(), 1)).toBeNull(); // not approved
    const none = await session();
    expect(await findApprovedBuilderIndex(none.s, builder, 1)).toBeNull(); // no escrow
  });

  it("mints test dUSDT only when the mint is controlled by the token faucet", async () => {
    const faucetProgram = new PublicKey(TOKEN_FAUCET_PROGRAM);
    const [mintAuthority] = PublicKey.findProgramAddressSync([Buffer.from("mint_authority"), mint.toBuffer()], faucetProgram);
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("faucet_config"), mint.toBuffer()], faucetProgram);

    const locked = await session(new Map(), key());
    expect(locked.s.core.faucet).toBe(false);
    await expect(mintTestQuote(locked.s, declining)).rejects.toThrow(/not controlled by the token faucet/);
    expect((await session()).s.core.faucet).toBe(false); // no mint authority at all

    const open = await session(new Map(), mintAuthority);
    expect(open.s.core.faucet).toBe(true);
    await expect(mintTestQuote(open.s, declining)).rejects.toMatchObject({ code: "rejected" });
    const tx = open.sent[0]!;
    const compiled = tx.message.compiledInstructions;
    expect(compiled).toHaveLength(3); // budget, create token account, mint
    const mintIx = compiled[2]!;
    const keys = tx.message.staticAccountKeys;
    expect(keys[mintIx.programIdIndex]!.toBase58()).toBe(TOKEN_FAUCET_PROGRAM);
    expect(mintIx.accountKeyIndexes.map((i) => keys[i]!.toBase58())).toEqual([
      config.toBase58(),
      mint.toBase58(),
      PublicKey.findProgramAddressSync(
        [authority.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      )[0].toBase58(),
      mintAuthority.toBase58(),
      TOKEN_PROGRAM.toBase58(),
    ]);
    // Discriminator comes from the faucet IDL shipped in the SDK; amount is a little-endian u64.
    const idl = (await import("@velocity-exchange/sdk/lib/node/idl/token_faucet.json", { with: { type: "json" } })).default as { instructions: { name: string; discriminator: number[] }[] };
    const expected = Buffer.from(idl.instructions.find((i) => i.name === "mint_to_user")!.discriminator);
    expect(Buffer.from(mintIx.data).subarray(0, 8).equals(expected)).toBe(true);
    expect(Buffer.from(mintIx.data).readBigUInt64LE(8)).toBe(FAUCET_AMOUNT_UNITS);
    await expect(mintTestQuote(open.s, declining, 0n)).rejects.toBeInstanceOf(TradeError);
    await expect(mintTestQuote(open.s, declining, FAUCET_AMOUNT_UNITS * 11n)).rejects.toBeInstanceOf(TradeError);
  });

  it("avoids Buffer BigInt methods, which the browser Buffer polyfill does not have", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["./velocity-trade.ts", "./velocity-program.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/\b(read|write)Big(U)?Int64(LE|BE)\b/i);
    }
  });

  it("converts scaled spot balances to token units", () => {
    // 10 dUSDT: scaled 10e9, interest index 1.0 (1e10) -> 10_000_000 base units (6 decimals).
    expect(spotTokenUnits(10_000_000_000n, 10_000_000_000n, 6)).toBe(10_000_000n);
    // Interest index 1.05 raises the claim by 5 percent.
    expect(spotTokenUnits(10_000_000_000n, 10_500_000_000n, 6)).toBe(10_500_000n);
    expect(spotTokenUnits(0n, 10_000_000_000n, 6)).toBe(0n);
  });

  /** A user account with 10 dUSDT of collateral and a short 0.001 BTC position on market 1. */
  async function userWithPosition(base: bigint) {
    const f = await loadCoreWith();
    const BN = sdk.BN;
    const blank = f.shell.coder.accounts.decode<Record<string, unknown>>("user", zeroAccount(f.shell, "user") as never) as {
      spotPositions: Record<string, unknown>[];
      perpPositions: Record<string, unknown>[];
    };
    const spotPositions = blank.spotPositions.map((p, i) =>
      i === 0 ? { ...p, marketIndex: 0, balanceType: { deposit: {} }, scaledBalance: new BN("10000000000") } : p,
    );
    const perpPositions = blank.perpPositions.map((p, i) =>
      i === 0
        ? { ...p, marketIndex: 1, baseAssetAmount: new BN(base.toString()), quoteEntryAmount: new BN("76000"), openOrders: 0 }
        : p,
    );
    const bytes = await account(f.shell, "user", { spotPositions, perpPositions });
    const userPk = sdk.VelocityCore.pdas.getUserAccountPublicKeySync(f.programId, authority, 0);
    return session(new Map([[userPk.toBase58(), { data: Buffer.from(bytes), owner: f.programId }]]));
  }

  it("reads collateral and perp positions from the user account", async () => {
    const { s } = await userWithPosition(-1_000_000n);
    const summary = await readAccountSummary(s);
    expect(summary).not.toBeNull();
    expect(summary!.collateralUnits).toBe(10_000_000n); // the test spot market has interest index 1.0 (1e10)
    expect(summary!.positions).toEqual([{ marketIndex: 1, baseUnits: -1_000_000n, entryQuoteUnits: 76_000n, openOrders: 0 }]);
  });

  it("returns null when the Velocity account does not exist", async () => {
    const { s } = await session();
    expect(await readAccountSummary(s)).toBeNull();
  });

  it("closes a short with a reduce-only long order and refuses to close more than is held", async () => {
    const { s, sent } = await userWithPosition(-1_000_000n);
    const position = { marketIndex: 1, baseUnits: -1_000_000n };
    await expect(closePosition(s, declining, position, 1_000_000n, 77_500_000_000n)).rejects.toMatchObject({ code: "rejected" });
    expect(sent).toHaveLength(1); // simulated once, then the wallet declined
    const ix = sent[0]!.message.compiledInstructions.at(-1)!;
    const decoded = s.core.program.coder.instruction.decode(Buffer.from(ix.data)) as unknown as {
      name: string;
      data: { params: { direction: object; reduceOnly: boolean; baseAssetAmount: { toString(): string } } };
    };
    expect(decoded.name).toBe("placePerpOrder");
    expect(decoded.data.params.reduceOnly).toBe(true);
    expect("long" in decoded.data.params.direction).toBe(true);
    expect(decoded.data.params.baseAssetAmount.toString()).toBe("1000000");
    await expect(closePosition(s, declining, position, 2_000_000n, 77_500_000_000n)).rejects.toBeInstanceOf(TradeError);
    await expect(closePosition(s, declining, position, 0n, 77_500_000_000n)).rejects.toBeInstanceOf(TradeError);
    await expect(closePosition(s, declining, { marketIndex: 1, baseUnits: 0n }, 1n, 1n)).rejects.toThrow(/no open position/);
  });

  it("withdraws reduce-only after creating the token account idempotently, and simulates before the wallet is asked", async () => {
    const { s, sent } = await userWithPosition(0n);
    await expect(withdrawQuote(s, declining, 5_000_000n)).rejects.toMatchObject({ code: "rejected" });
    expect(sent).toHaveLength(1);
    const tx = sent[0]!;
    const ids = programIds(tx);
    expect(ids.at(-1)).toBe(s.core.programId.toBase58());
    expect(ids.at(-2)).toBe("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    const ix = tx.message.compiledInstructions.at(-1)!;
    const decoded = s.core.program.coder.instruction.decode(Buffer.from(ix.data)) as unknown as {
      name: string;
      data: { marketIndex: number; amount: { toString(): string }; reduceOnly: boolean };
    };
    expect(decoded.name).toBe("withdraw");
    expect(decoded.data.marketIndex).toBe(0);
    expect(decoded.data.amount.toString()).toBe("5000000");
    expect(decoded.data.reduceOnly).toBe(true);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).toContain(vault.toBase58());
    expect(keys).toContain(authority.toBase58());
  });

  it("refuses a non-positive withdrawal and a withdrawal without an account", async () => {
    const { s } = await session();
    await expect(withdrawQuote(s, declining, 0n)).rejects.toBeInstanceOf(TradeError);
    await expect(withdrawQuote(s, declining, 1n)).rejects.toThrow(/Create the Velocity account first/);
  });
});

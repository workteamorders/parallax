import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, type TransactionInstruction } from "@solana/web3.js";
import * as web3 from "@solana/web3.js";
import { makeProgram } from "./velocity-program";

// The Node build of the SDK has a working Anchor Program. The browser build does not, which is why the
// shim exists. Comparing the shim to the real thing proves it encodes identical instructions.
const require = createRequire(import.meta.url);
const sdk = await import("@velocity-exchange/sdk");
const anchor = require("@velocity-exchange/sdk/lib/node/isomorphic/anchor.js") as {
  AnchorProvider: new (...args: unknown[]) => unknown;
  Program: new (idl: unknown, provider: unknown) => { instruction: Record<string, (...args: unknown[]) => Promise<TransactionInstruction> | TransactionInstruction> };
};

const key = () => Keypair.generate().publicKey;
const wallet = { publicKey: key(), signTransaction: async (t: unknown) => t, signAllTransactions: async (t: unknown) => t };
const provider = new anchor.AnchorProvider(new Connection("http://127.0.0.1:1"), wallet, {});
const real = new anchor.Program(sdk.VelocityCore.defaultIdl(), provider);
const shim = makeProgram(sdk, web3);

const shape = (ix: TransactionInstruction) => ({
  programId: ix.programId.toBase58(),
  data: ix.data.toString("hex"),
  keys: ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
});

async function same(name: string, ...args: unknown[]) {
  const expected = await real.instruction[name](...args);
  const actual = shim.instruction[name](...args);
  expect(shape(actual)).toEqual(shape(expected));
}

const state = key();
const user = key();
const userStats = key();
const authority = key();
const remaining = [
  { pubkey: key(), isSigner: false, isWritable: false },
  { pubkey: key(), isSigner: false, isWritable: true },
];

describe("velocity program shim", () => {
  it("matches the real program for deposit", async () => {
    await same("deposit", 0, new sdk.BN(1_500_000), false, {
      accounts: { state, spotMarket: key(), spotMarketVault: key(), user, userStats, userTokenAccount: key(), authority, tokenProgram: key() },
      remainingAccounts: remaining,
    });
  });

  it("matches for user and stats initialisation", async () => {
    const accounts = { user, userStats, authority, payer: authority, rent: SYSVAR_RENT_PUBKEY, systemProgram: SystemProgram.programId, state };
    await same("initializeUser", 0, sdk.encodeName(sdk.DEFAULT_USER_NAME), { accounts, remainingAccounts: [] });
    await same("initializeUserStats", { accounts: { userStats, authority, payer: authority, rent: SYSVAR_RENT_PUBKEY, systemProgram: SystemProgram.programId, state } });
  });

  it("matches for the builder escrow and approval", async () => {
    const escrow = key();
    await same("initializeRevenueShareEscrow", 16, {
      accounts: { escrow, authority, payer: authority, userStats, state, rent: SYSVAR_RENT_PUBKEY, systemProgram: SystemProgram.programId },
    });
    await same("changeApprovedBuilder", key(), 20, true, {
      accounts: { escrow, authority, payer: authority, systemProgram: SystemProgram.programId },
    });
  });

  it("matches for market and limit orders with a builder code, and for cancel", async () => {
    const base = {
      marketIndex: 1,
      marketType: sdk.MarketType.PERP,
      direction: sdk.PositionDirection.LONG,
      baseAssetAmount: new sdk.BN(10_000_000),
      builderIdx: 0,
      builderFeeTenthBps: 20,
    };
    const price = new sdk.BN(77_500_000_000);
    const market = sdk.getOrderParams(sdk.getMarketOrderParams({ ...base, auctionEndPrice: price, price }), { marketType: sdk.MarketType.PERP });
    const limit = sdk.getOrderParams(
      sdk.getOrderParams({ ...base, orderType: sdk.OrderType.LIMIT, price, postOnly: sdk.PostOnlyParams.MUST_POST_ONLY }),
      { marketType: sdk.MarketType.PERP },
    );
    const accounts = { state, user, userStats, authority };
    await same("placePerpOrder", market, { accounts, remainingAccounts: remaining });
    await same("placePerpOrder", limit, { accounts, remainingAccounts: remaining });
    await same("cancelOrders", sdk.MarketType.PERP, 1, null, { accounts, remainingAccounts: remaining });
  });

  it("rejects a call without an accounts context", () => {
    expect(() => shim.instruction.deposit(0, new sdk.BN(1), false)).toThrow(/missing accounts/);
  });

  it("knows the program id", () => {
    expect(shim.programId).toBeInstanceOf(PublicKey);
    expect(shim.programId.toBase58()).toBe(sdk.VelocityCore.defaultIdl().address);
  });
});

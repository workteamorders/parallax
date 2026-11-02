/**
 * Minimal stand-in for Anchor's `Program.instruction` namespace.
 *
 * The Velocity SDK browser build deliberately stubs out `Program` and `AnchorProvider` (constructing
 * either throws), so `VelocityClient` cannot run in a browser. `VelocityCore` instruction builders still
 * call `program.instruction.<name>(...args, { accounts, remainingAccounts })`, which only needs the IDL
 * coder. This builds that namespace from the bundled IDL with no provider and no network.
 */
import { convertIdlToCamelCase } from "@anchor-lang/core";
import type { AccountMeta, PublicKey, TransactionInstruction } from "@solana/web3.js";

type Sdk = typeof import("@velocity-exchange/sdk");
type Web3 = typeof import("@solana/web3.js");

interface IdlAccountItem {
  name: string;
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  accounts?: IdlAccountItem[];
}

interface IdlInstruction {
  name: string;
  args: { name: string }[];
  accounts: IdlAccountItem[];
}

interface InstructionContext {
  accounts: Record<string, PublicKey>;
  remainingAccounts?: AccountMeta[];
}

export interface ProgramShim {
  programId: PublicKey;
  /** Coder built from the camelCased IDL, the same shape Anchor's `Program` uses: camelCase account, field and variant names. */
  coder: ReturnType<Sdk["VelocityCore"]["coder"]>;
  instruction: Record<string, (...args: unknown[]) => TransactionInstruction>;
}

function flattenAccounts(items: IdlAccountItem[]): IdlAccountItem[] {
  return items.flatMap((item) => (item.accounts ? flattenAccounts(item.accounts) : [item]));
}

export function makeProgram(sdk: Pick<Sdk, "VelocityCore">, web3: Web3): ProgramShim {
  // Anchor's Program converts the raw snake_case IDL to camelCase before building its coder, which is why
  // the SDK's camelCase order params, account names and enum variants encode. A coder built from the raw
  // IDL would silently write zeroes for every camelCase field, so build it from the converted IDL.
  const idl = convertIdlToCamelCase(sdk.VelocityCore.defaultIdl());
  const coder = sdk.VelocityCore.coder(idl);
  const programId = new web3.PublicKey(idl.address);
  const instruction: ProgramShim["instruction"] = {};

  for (const raw of idl.instructions as unknown as IdlInstruction[]) {
    const accountItems = flattenAccounts(raw.accounts);
    instruction[raw.name] = (...call: unknown[]) => {
      const context = call[call.length - 1] as InstructionContext | undefined;
      if (!context || typeof context !== "object" || !("accounts" in context)) {
        throw new Error(`${raw.name}: missing accounts context`);
      }
      const values = call.slice(0, raw.args.length);
      const named = Object.fromEntries(raw.args.map((arg, i) => [arg.name, values[i]]));
      const data = coder.instruction.encode(raw.name, named);
      const keys: AccountMeta[] = accountItems.map((item) => {
        const key = context.accounts[item.name] ?? (item.address ? new web3.PublicKey(item.address) : undefined);
        if (!key) {
          if (item.optional) return { pubkey: programId, isSigner: false, isWritable: false };
          throw new Error(`${raw.name}: missing account ${item.name}`);
        }
        return { pubkey: key, isSigner: Boolean(item.signer), isWritable: Boolean(item.writable) };
      });
      return new web3.TransactionInstruction({
        programId,
        keys: [...keys, ...(context.remainingAccounts ?? [])],
        data,
      });
    };
  }
  return { programId, coder, instruction };
}

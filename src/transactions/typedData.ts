// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * EIP-712 typed data for wallet-signed transactions.
 *
 * Payloads that move funds or grant authority are signed over named fields a
 * wallet can render. Everything else - orders, leverage, admin ops - is signed by
 * an agent key with no dialog to render, and keeps the opaque wrapper.
 *
 * Consensus-critical: digests must match the on-chain signing contract and
 * reference signing vectors.
 *
 * Type names use `_`, not `:`. Both `viem` and `@metamask/eth-sig-util` (what
 * MetaMask hashes with) stop parsing a type name at the colon and drop referenced
 * struct types from `encodeType` - invisible for the flat types, but for the batch
 * types it silently yields a non-standard typeHash that the chain then rejects.
 *
 * The field lists below are the single source of truth. `buildTypedData` hands
 * them to a wallet and `typedDataDigest` hashes them; neither restates the other,
 * so the bytes a user is shown cannot drift from the bytes that get signed.
 */

import { keccak_256, sha3_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import { AccountAddress } from "../core/accountAddress";
import { AnyPublicKey, AnySignature, Secp256k1PublicKey, Secp256k1Signature } from "../core/crypto";
import {
    AgentOperationVariant,
    CrossTransferOption,
    DexOrderlessTxVariant,
    DexTransferVariant,
    DexUserConfigTxVariant,
} from "../types/enums";
import {
    AccountTransferItem,
    AgentApprove,
    AgentRevoke,
    CreateSubAccount,
    CrossTransferItem,
    DexAgentTx,
    DexOrderlessTx,
    DexTransferTx,
    DexUserConfigTx,
    InternalTransferItem,
    ModifySubAccount,
    RawOrderlessInner,
    TransactionPayloadDexOrderless,
} from "./dexPayloads";
import { DexMultisigTx, submitOperationName } from "./multisigPayloads";
import { RawTransaction } from "./rawTransaction";
import { AccountAuthenticatorSingleKey, generateSignedTransaction } from "./authenticator";

// --- Shapes ---------------------------------------------------------------

/** One field of an EIP-712 struct. Order is part of the signature. */
export interface TypedDataField {
    name: string;
    type: string;
}

/** Exactly what `viem` / `wagmi`'s `signTypedData` takes. */
export interface TypedData {
    domain: {
        name: string;
        version?: string;
        chainId?: number;
        verifyingContract?: `0x${string}`;
    };
    types: Record<string, TypedDataField[]>;
    primaryType: string;
    message: Record<string, unknown>;
}

// --- Domain ---------------------------------------------------------------

export const DOMAIN_NAME = "Intention";
export const DOMAIN_VERSION = "1";
export const VERIFYING_CONTRACT = "0x0000000000000000000000000000000000000000" as const;

/**
 * The EVM chain whose id goes in the domain - *not* this chain's id.
 *
 * MetaMask refuses to sign typed data whose `domain.chainId` is not the network
 * the wallet is on, and it cannot be on this chain: this is not an EVM chain. The
 * network the user is on when they sign is the bridge's. Hyperliquid does the same.
 */
export function signatureChainId(chainId: number): number {
    // Every network but mainnet bridges to Arbitrum Sepolia, so this is written as one exception rather than a table of every chain id. A missing row in a table would not fail loudly: the domain would carry a chain the wallet is not on, and MetaMask would simply refuse to sign.
    return chainId === 1 ? 42161 /* Arbitrum One */ : 421614 /* Arbitrum Sepolia */;
}

/**
 * What the user reads: which environment this is.
 *
 * Deliberately coarse - testnet and devnet share a value. Telling those apart is
 * the `digest` field's job, which covers this chain's `chain_id`.
 */
export function intentionChainName(chainId: number): string {
    // This label is signed: it is the `intentionChain` field of every typed message, so it must match the chain's label byte for byte, and renaming one breaks every signature made for that network. It is coarse on purpose; what binds a signature to one network is this chain's chain_id, which the digest field covers. Chain ids must therefore be unique per network: a signature made under a given chain_id verifies on any network that uses the same id.
    switch (chainId) {
        case 1: return "Mainnet";
        case 2: return "Testnet";
        case 3: return "Devnet";
        case 4: return "Nightly";
        default: return "Localnet";
    }
}

// --- Type definitions (single source of truth) ----------------------------

const F = (name: string, type: string): TypedDataField => ({ name, type });

/**
 * What the wire calls asset 0, a person calls USDC.
 *
 * Name and scale come from one table because they are one fact about the asset:
 * rendering either without the other puts a number in the signing dialog that
 * does not mean what it says. The table is a pure function of the asset id
 * because it has to be -- the signer, the node and MetaMask each compute this
 * digest on their own and none of them can read chain state while doing it.
 *
 * `null` for an id the table cannot name: the caller falls back to the opaque
 * wrapper rather than guessing. A wrong name or a wrong scale in that dialog is
 * worse than a hash, which at least does not claim to be readable.
 */
export function asset(assetId: number | bigint): { symbol: string; decimals: number } | null {
    // dex_sys_config: "USDC quantums (6 decimals)".
    return BigInt(assetId) === 0n ? { symbol: "USDC", decimals: 6 } : null;
}

/**
 * `10500000` at six decimals renders as `10.5`, `10000000` as `10`.
 *
 * No separators, no trailing zeros, no trailing point. This string is hashed, so
 * all five implementations must produce it byte for byte.
 */
export function formatAmount(quantums: bigint | number, decimals: number): string {
    const q = BigInt(quantums);
    const scale = 10n ** BigInt(decimals);
    const whole = q / scale;
    const frac = q % scale;
    if (frac === 0n) return whole.toString();
    const digits = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole}.${digits}`;
}

const CHAIN = F("intentionChain", "string");
const DIGEST = F("digest", "bytes32");

const CROSS_TRANSFER_ITEM = [
    F("toAccount", "address"),
    F("token", "string"),
    F("amount", "string"),
    F("accountType", "string"),
];
const ACCOUNT_TRANSFER_ITEM = [
    F("toAccount", "address"),
    F("token", "string"),
    F("amount", "string"),
    F("accountType", "string"),
];
const INTERNAL_TRANSFER_ITEM = [
    F("fromSubaccount", "address"),
    F("toSubaccount", "address"),
    F("token", "string"),
    F("amount", "string"),
    F("accountType", "string"),
];

export const TYPES = {
    ApproveAgent: {
        primary: "IntentionTransaction_ApproveAgent",
        fields: [CHAIN, F("agentAddress", "address"), F("name", "string"), F("expiryTimestamp", "uint64"), F("nonce", "uint64"), DIGEST],
        refs: {},
    },
    RevokeAgent: {
        primary: "IntentionTransaction_RevokeAgent",
        fields: [CHAIN, F("name", "string"), F("nonce", "uint64"), DIGEST],
        refs: {},
    },
    /**
     * No `name` field, and its own primary type rather than a `RevokeAgent`
     * carrying an empty one: the operation declares an end state ("this account
     * has no agents"), so a dialog naming one specific grant would name a grant
     * that is not the thing being pulled.
     */
    RevokeAllAgents: {
        primary: "IntentionTransaction_RevokeAllAgents",
        fields: [CHAIN, F("nonce", "uint64"), DIGEST],
        refs: {},
    },
    CrossTransferBurn: {
        primary: "IntentionTransaction_CrossTransferBurn",
        fields: [CHAIN, ...CROSS_TRANSFER_ITEM, F("nonce", "uint64"), DIGEST],
        refs: {},
    },
    CrossTransferBurnBatch: {
        primary: "IntentionTransaction_CrossTransferBurnBatch",
        fields: [CHAIN, F("transfers", "CrossTransferItem[]"), F("nonce", "uint64"), DIGEST],
        refs: { CrossTransferItem: CROSS_TRANSFER_ITEM },
    },
    InternalTransfer: {
        primary: "IntentionTransaction_InternalTransfer",
        fields: [CHAIN, ...INTERNAL_TRANSFER_ITEM, F("nonce", "uint64"), DIGEST],
        refs: {},
    },
    InternalTransferBatch: {
        primary: "IntentionTransaction_InternalTransferBatch",
        fields: [CHAIN, F("transfers", "InternalTransferItem[]"), F("nonce", "uint64"), DIGEST],
        refs: { InternalTransferItem: INTERNAL_TRANSFER_ITEM },
    },
    AccountTransfer: {
        primary: "IntentionTransaction_AccountTransfer",
        fields: [CHAIN, ...ACCOUNT_TRANSFER_ITEM, F("nonce", "uint64"), DIGEST],
        refs: {},
    },
    AccountTransferBatch: {
        primary: "IntentionTransaction_AccountTransferBatch",
        fields: [CHAIN, F("transfers", "AccountTransferItem[]"), F("nonce", "uint64"), DIGEST],
        refs: { AccountTransferItem: ACCOUNT_TRANSFER_ITEM },
    },
    CreateSubAccount: {
        primary: "IntentionTransaction_CreateSubAccount",
        fields: [CHAIN, F("name", "string"), F("nonce", "uint64"), DIGEST],
        refs: {},
    },
    ModifySubAccount: {
        primary: "IntentionTransaction_ModifySubAccount",
        fields: [CHAIN, F("subAddress", "address"), F("name", "string"), F("nonce", "uint64"), DIGEST],
        refs: {},
    },
    /**
     * The envelope a multisig submitter signs.
     *
     * It names the account and the operation and leaves the details to `digest`:
     * the fields that matter were already shown to whoever signed the k-of-n
     * approval, and this signature only says who handed the finished operation in.
     * The approval documents themselves are in `multisigTypedData.ts`.
     */
    MultisigSubmit: {
        primary: "IntentionTransaction_MultisigSubmit",
        fields: [CHAIN, F("account", "address"), F("operation", "string"), F("nonce", "uint64"), DIGEST],
        refs: {},
    },
} as const;

// --- Generic EIP-712 encoding --------------------------------------------
//
// Written against the spec rather than per-type so that a new type is a new
// entry in TYPES and nothing else. The batch cases are the reason it has to be
// generic: their `encodeType` carries the referenced struct's own definition
// appended to the primary one, sorted by name.

/**
 * One EIP-712 primary type: its name, its fields in signing order, and the
 * struct types it references.
 *
 * Exported because the multisig signing scheme is a second set of types over the
 * same domain and the same encoder (`multisigTypedData.ts`). A second encoder is
 * a second chance to show a signer a dialog the chain never recomputes, which is
 * the one failure this module exists to prevent.
 */
export type TypeSpec = { primary: string; fields: readonly TypedDataField[]; refs: Record<string, readonly TypedDataField[]> };

function utf8(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

function hexToBytes(hex: string): Uint8Array {
    const h = hex.startsWith("0x") ? hex.slice(2) : hex;
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
}

function defOf(name: string, fields: readonly TypedDataField[]): string {
    return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
}

/** Primary type first, then referenced struct types sorted by name. */
export function encodeType(spec: TypeSpec): string {
    const tail = Object.keys(spec.refs)
        .sort()
        .map((n) => defOf(n, spec.refs[n]))
        .join("");
    return defOf(spec.primary, spec.fields) + tail;
}

function encodeValue(type: string, value: unknown, refs: TypeSpec["refs"]): Uint8Array {
    if (type === "string") return keccak_256(utf8(value as string));
    if (type === "bytes32") {
        const b = hexToBytes(value as string);
        if (b.length !== 32) throw new Error(`bytes32 field must be 32 bytes, got ${b.length}`);
        return b;
    }
    if (type === "address") {
        const b = hexToBytes(value as string);
        if (b.length !== 20) throw new Error(`address field must be 20 bytes, got ${b.length}`);
        const out = new Uint8Array(32);
        out.set(b, 12);
        return out;
    }
    if (type.startsWith("uint")) {
        let n = BigInt(value as string | number | bigint);
        const out = new Uint8Array(32);
        for (let i = 31; i >= 0 && n > 0n; i--) {
            out[i] = Number(n & 0xffn);
            n >>= 8n;
        }
        return out;
    }
    if (type.endsWith("[]")) {
        // An array hashes the concatenation of its encoded elements, whatever the
        // element type is. A struct element is hashed by its own definition; a
        // primitive element goes back through this function, which is what makes
        // `address[]` (a policy's owner list) work without a second encoder.
        const inner = type.slice(0, -2);
        const fields = refs[inner];
        const items = value as unknown[];
        const encoded = fields
            ? items.map((item) => hashStructOf(inner, fields, item as Record<string, unknown>, refs))
            : items.map((item) => encodeValue(inner, item, refs));
        return keccak_256(concat(encoded));
    }
    throw new Error(`unsupported EIP-712 field type: ${type}`);
}

function hashStructOf(
    name: string,
    fields: readonly TypedDataField[],
    message: Record<string, unknown>,
    refs: TypeSpec["refs"],
    // The struct types `name` references, appended to its own definition before
    // hashing. Empty for a nested item struct, which references nothing; omitting
    // it for a type that *does* reference one silently yields a non-standard
    // typeHash -- the same failure the colon in a type name causes.
    typeRefs: TypeSpec["refs"] = {},
): Uint8Array {
    const tail = Object.keys(typeRefs)
        .sort()
        .map((n) => defOf(n, typeRefs[n]))
        .join("");
    const typeHash = keccak_256(utf8(defOf(name, fields) + tail));
    return keccak_256(concat([typeHash, ...fields.map((f) => encodeValue(f.type, message[f.name], refs))]));
}

const DOMAIN_FIELDS: TypedDataField[] = [
    F("name", "string"),
    F("version", "string"),
    F("chainId", "uint256"),
    F("verifyingContract", "address"),
];

function domainSeparatorOf(domain: TypedData["domain"]): Uint8Array {
    const fields=DOMAIN_FIELDS.filter(field=>domain[field.name as keyof typeof domain]!==undefined);
    return hashStructOf("EIP712Domain", fields, domain as unknown as Record<string, unknown>, {});
}

/** The domain separator for one of our chains. */
export function domainSeparator(chainId: number): Uint8Array {
    return domainSeparatorOf(domainFor(chainId));
}

function domainFor(chainId: number): TypedData["domain"] {
    return {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: signatureChainId(chainId),
        verifyingContract: VERIFYING_CONTRACT,
    };
}

/** `keccak256("\x19\x01" || domainSeparator || hashStruct(message))`. */
export function hashTypedData(td: TypedData, spec: TypeSpec): Uint8Array {
    const sh = hashStructOf(spec.primary, spec.fields, td.message, spec.refs, spec.refs);
    return keccak_256(concat([new Uint8Array([0x19, 0x01]), domainSeparatorOf(td.domain), sh]));
}

/**
 * `hashStruct` for one spec and message, without the domain.
 *
 * The envelope type is hashed this way: the chain folds its struct hash into the
 * transaction digest rather than signing it on its own.
 */
export function hashStructFor(spec: TypeSpec, message: Record<string, unknown>): Uint8Array {
    return hashStructOf(spec.primary, spec.fields, message, spec.refs, spec.refs);
}

/** The document a wallet is handed for one spec and message. */
export function typedDataFor(
    spec: TypeSpec,
    chainId: number,
    message: Record<string, unknown>,
): TypedData {
    const types: Record<string, TypedDataField[]> = { [spec.primary]: [...spec.fields] };
    for (const [name, fields] of Object.entries(spec.refs)) {
        types[name] = [...(fields as TypedDataField[])];
    }
    return { domain: domainFor(chainId), types, primaryType: spec.primary, message };
}

/**
 * The 32 bytes signing that document produces.
 *
 * Derived from {@link typedDataFor}, so what a signer is shown and what is signed
 * cannot drift apart.
 */
export function digestFor(
    spec: TypeSpec,
    chainId: number,
    message: Record<string, unknown>,
): Uint8Array {
    return hashTypedData(typedDataFor(spec, chainId, message), spec);
}

// --- Payload -> typed data ------------------------------------------------

const RAW_TRANSACTION_SALT = "INTENTION::RawTransaction";

function hex(bytes: Uint8Array): `0x${string}` {
    return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

/**
 * Keeps sender, sequence_number, gas, expiry, this chain's chain_id and every
 * unshown payload field under the signature. Lazy: orders are the highest-volume
 * payload and never reach it.
 */
function innerDigest(rawTx: RawTransaction): `0x${string}` {
    return hex(keccak_256(concat([sha3_256(utf8(RAW_TRANSACTION_SALT)), rawTx.bcsToBytes()])));
}

/**
 * EIP-712 `address` is a uint160: the low twenty bytes of our address, which is
 * already that shape. Anything in the top twelve bytes is not an address a wallet
 * could have produced, so it falls back to the opaque wrapper - the chain does the
 * same, and the two must agree on every input.
 */
/** Mirrors `AccountType::wire_name` on the chain, so the wallet and the
 * explorer call the same account the same thing. */
export function accountTypeName(t: number): string {
    return t === 1 ? "spot" : "perp";
}

export function evmAddress(address: AccountAddress): `0x${string}` | null {
    const raw = address.toUint8Array();
    for (let i = 0; i < 12; i++) if (raw[i] !== 0) return null;
    return hex(raw.slice(12));
}

type Built = { spec: (typeof TYPES)[keyof typeof TYPES]; message: Record<string, unknown> };

function buildInner(rawTx: RawTransaction): Built | null {
    const payload = rawTx.payload;
    if (!(payload instanceof TransactionPayloadDexOrderless)) return null;
    const dex: DexOrderlessTx = payload.dexOrderlessTx;

    const chainId = rawTx.chain_id.chainId;
    const chain = intentionChainName(chainId);
    const inner = dex.inner;
    const digest = () => innerDigest(rawTx);
    const str = (v: bigint | number) => v.toString();

    if (dex.variant === DexOrderlessTxVariant.DexAgent && inner instanceof DexAgentTx) {
        const op = inner.operation;
        if (inner.variant === AgentOperationVariant.Approve && op instanceof AgentApprove) {
            const agent = evmAddress(op.agentAddress);
            if (!agent) return null;
            return {
                spec: TYPES.ApproveAgent,
                message: {
                    intentionChain: chain,
                    agentAddress: agent,
                    name: op.name,
                    expiryTimestamp: str(op.expiryTimestamp),
                    nonce: str(inner.nonce),
                    digest: digest(),
                },
            };
        }
        if (inner.variant === AgentOperationVariant.Revoke && op instanceof AgentRevoke) {
            return {
                spec: TYPES.RevokeAgent,
                message: { intentionChain: chain, name: op.name, nonce: str(inner.nonce), digest: digest() },
            };
        }
        if (inner.variant === AgentOperationVariant.RevokeAll) {
            // No operation fields to check: the variant tag is the whole
            // operation, so there is nothing an `instanceof` here would catch.
            return {
                spec: TYPES.RevokeAllAgents,
                message: { intentionChain: chain, nonce: str(inner.nonce), digest: digest() },
            };
        }
        return null;
    }

    if (dex.variant === DexOrderlessTxVariant.Multisig && !(inner instanceof RawOrderlessInner)) {
        // The envelope, not the approval: the owners' k-of-n documents live in
        // `multisigTypedData.ts` and are signed before this transaction exists.
        // This signature says who handed the finished operation in.
        const multisig = inner as DexMultisigTx;
        const account = evmAddress(multisig.account);
        if (!account) return null;
        return {
            spec: TYPES.MultisigSubmit,
            message: {
                intentionChain: chain,
                account,
                operation: submitOperationName(multisig.op),
                nonce: str(multisig.nonce),
                digest: digest(),
            },
        };
    }

    if (dex.variant === DexOrderlessTxVariant.DexTransfer && inner instanceof DexTransferTx) {
        const items = inner.payload;
        if (items.length === 0) return null;
        const nonce = str(inner.nonce);

        if (inner.variant === DexTransferVariant.CrossTransfer) {
            // Only a withdrawal is wallet-signed. A Mint is the bridge relayer
            // crediting a deposit; there is no user at a wallet.
            if (inner.option !== CrossTransferOption.Burn) return null;
            const cross = items as CrossTransferItem[];
            const one = (i: CrossTransferItem) => {
                const to = evmAddress(i.to_account);
                if (!to) return null;
                const meta = asset(i.asset_id);
                if (!meta) return null;
                return {
                    toAccount: to,
                    token: meta.symbol,
                    amount: formatAmount(i.amount, meta.decimals),
                    accountType: accountTypeName(i.account_type),
                };
            };
            if (cross.length === 1) {
                const m = one(cross[0]);
                if (!m) return null;
                return { spec: TYPES.CrossTransferBurn, message: { intentionChain: chain, ...m, nonce, digest: digest() } };
            }
            const transfers: Record<string, unknown>[] = [];
            for (const i of cross) {
                const m = one(i);
                if (!m) return null;
                transfers.push(m);
            }
            return { spec: TYPES.CrossTransferBurnBatch, message: { intentionChain: chain, transfers, nonce, digest: digest() } };
        }

        if (inner.variant === DexTransferVariant.InternalTransfer) {
            const internal = items as InternalTransferItem[];
            const one = (i: InternalTransferItem) => {
                const from = evmAddress(i.from_subaddress);
                const to = evmAddress(i.to_subaddress);
                if (!from || !to) return null;
                const meta = asset(i.asset_id);
                if (!meta) return null;
                return {
                    fromSubaccount: from,
                    toSubaccount: to,
                    token: meta.symbol,
                    amount: formatAmount(i.amount, meta.decimals),
                    accountType: accountTypeName(i.account_type),
                };
            };
            if (internal.length === 1) {
                const m = one(internal[0]);
                if (!m) return null;
                return { spec: TYPES.InternalTransfer, message: { intentionChain: chain, ...m, nonce, digest: digest() } };
            }
            const transfers: Record<string, unknown>[] = [];
            for (const i of internal) {
                const m = one(i);
                if (!m) return null;
                transfers.push(m);
            }
            return { spec: TYPES.InternalTransferBatch, message: { intentionChain: chain, transfers, nonce, digest: digest() } };
        }

        if (inner.variant === DexTransferVariant.AccountTransfer) {
            const account = items as AccountTransferItem[];
            const one = (i: AccountTransferItem) => {
                const to = evmAddress(i.to_account);
                if (!to) return null;
                const meta = asset(i.asset_id);
                if (!meta) return null;
                return {
                    toAccount: to,
                    token: meta.symbol,
                    amount: formatAmount(i.amount, meta.decimals),
                    accountType: accountTypeName(i.account_type),
                };
            };
            if (account.length === 1) {
                const m = one(account[0]);
                if (!m) return null;
                return { spec: TYPES.AccountTransfer, message: { intentionChain: chain, ...m, nonce, digest: digest() } };
            }
            const transfers: Record<string, unknown>[] = [];
            for (const i of account) {
                const m = one(i);
                if (!m) return null;
                transfers.push(m);
            }
            return { spec: TYPES.AccountTransferBatch, message: { intentionChain: chain, transfers, nonce, digest: digest() } };
        }

        // FaucetMint: a test faucet, no wallet involved.
        return null;
    }

    if (dex.variant === DexOrderlessTxVariant.DexUserConfig && inner instanceof DexUserConfigTx) {
        const p = inner.payload;
        if (inner.variant === DexUserConfigTxVariant.CreateSubAccount && p instanceof CreateSubAccount) {
            return {
                spec: TYPES.CreateSubAccount,
                message: { intentionChain: chain, name: p.name, nonce: str(p.nonce), digest: digest() },
            };
        }
        if (inner.variant === DexUserConfigTxVariant.ModifySubAccount && p instanceof ModifySubAccount) {
            const sub = evmAddress(p.subAddress);
            if (!sub) return null;
            return {
                spec: TYPES.ModifySubAccount,
                message: {
                    intentionChain: chain,
                    subAddress: sub,
                    name: p.name,
                    nonce: str(p.nonce),
                    digest: digest(),
                },
            };
        }
        // Trading configuration, not funds or authority.
        return null;
    }

    // Orders and admin config: agent- or admin-signed.
    return null;
}

/**
 * What a wallet is asked to sign, or `null` if no wallet signs this payload.
 *
 * Hand the result straight to `viem` / `wagmi`'s `signTypedData`:
 *
 * ```ts
 * const td = buildTypedData(rawTx);
 * if (td) {
 *     const signature = await walletClient.signTypedData(td);
 *     const bytes = signedTransactionFromWalletSignature(rawTx, signature);
 *     await client.submitTransaction(bytes);
 * }
 * ```
 */
function referralFallbackTypedData(rawTx:RawTransaction):TypedData|null {
    const payload=rawTx.payload;if(!(payload instanceof TransactionPayloadDexOrderless))return null;
    const dex=payload.dexOrderlessTx;
    const supported=(dex.variant===DexOrderlessTxVariant.DexUserConfig && dex.inner instanceof DexUserConfigTx &&
        [DexUserConfigTxVariant.RegisterReferralCode,DexUserConfigTxVariant.BindReferrer].includes(dex.inner.variant)) ||
        (dex.variant===DexOrderlessTxVariant.DexTransfer && dex.inner instanceof DexTransferTx && dex.inner.variant===DexTransferVariant.ClaimReferralRewards);
    if(!supported)return null;
    // Exact existing node fallback domain/hash. It covers the complete raw
    // transaction, including sources and fixed recipient, and works with wallets
    // without changing any consensus signature rule.
    return {domain:{name:"Intention"},types:{IntentionTransaction:[F("digest","bytes32")]},primaryType:"IntentionTransaction",message:{digest:innerDigest(rawTx)}};
}
export function buildTypedData(rawTx: RawTransaction): TypedData | null {
    const built = buildInner(rawTx);
    if (!built) return referralFallbackTypedData(rawTx);
    const types: Record<string, TypedDataField[]> = {
        [built.spec.primary]: [...built.spec.fields],
    };
    for (const [name, fields] of Object.entries(built.spec.refs)) {
        types[name] = [...(fields as TypedDataField[])];
    }
    return {
        domain: {
            name: DOMAIN_NAME,
            version: DOMAIN_VERSION,
            chainId: signatureChainId(rawTx.chain_id.chainId),
            verifyingContract: VERIFYING_CONTRACT,
        },
        types,
        primaryType: built.spec.primary,
        message: built.message,
    };
}

/**
 * The 32 bytes a wallet-signed transaction is signed over, or `null` if no wallet
 * signs this payload. Derived from `buildTypedData`, so what the wallet renders
 * and what gets signed cannot diverge.
 */
export function typedDataDigest(rawTx: RawTransaction): Uint8Array | null {
    const built = buildInner(rawTx);
    if (!built) {
        const fallback=referralFallbackTypedData(rawTx);if(!fallback)return null;
        return hashTypedData(fallback,{primary:"IntentionTransaction",fields:[F("digest","bytes32")],refs:{}} as TypeSpec);
    }
    const td = buildTypedData(rawTx);
    if (!td) return null;
    return hashTypedData(td, built.spec as unknown as TypeSpec);
}

/**
 * Assemble a submittable transaction from a wallet's 65-byte signature.
 *
 * A wallet returns `r || s || v` and no public key, so the key is recovered from
 * the signature over the same digest the wallet signed. Throws if this payload is
 * not one a wallet signs, rather than silently producing something the chain
 * would reject.
 */
export function signedTransactionFromWalletSignature(
    rawTx: RawTransaction,
    walletSignature: string | Uint8Array,
): Uint8Array {
    const digest = typedDataDigest(rawTx);
    if (!digest) {
        throw new Error("this payload is not wallet-signed; sign it with an account key instead");
    }
    const raw = typeof walletSignature === "string" ? hexToBytes(walletSignature) : walletSignature;
    if (raw.length !== 65) {
        throw new Error(`wallet signature must be 65 bytes (r||s||v), got ${raw.length}`);
    }
    const v = raw[64];
    const recovery = v >= 27 ? v - 27 : v;
    if (recovery !== 0 && recovery !== 1) {
        throw new Error(`unexpected recovery id ${v}`);
    }
    const sig = secp256k1.Signature.fromCompact(raw.slice(0, 64)).addRecoveryBit(recovery);
    const publicKey = sig.recoverPublicKey(digest).toRawBytes(false);
    const authenticator = new AccountAuthenticatorSingleKey(
        new AnyPublicKey(new Secp256k1PublicKey(publicKey)),
        new AnySignature(new Secp256k1Signature(raw.slice(0, 64))),
    );
    return generateSignedTransaction({ transaction: rawTx, senderAuthenticator: authenticator });
}

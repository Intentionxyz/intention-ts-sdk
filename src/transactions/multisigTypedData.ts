// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * What a multisig owner signs.
 *
 * An owner approves an operation by signing an `IntentionMultisig_*` document in
 * an ordinary EVM wallet; the chain recovers the owner's address from the
 * signature and counts distinct owners against the threshold. The document is the
 * point of this module: the chain never recomputes a hash into something readable
 * afterwards, so a field the dialog does not name is a field the signer never
 * agreed to.
 *
 * Three documents, and they are signed in this order because the data says so:
 *
 *  1. {@link keyChallengeTypedData} - an incoming control key proves it exists.
 *     Bound to the operation *kind*, not its id: the id covers the whole
 *     operation and the key proof is inside it, so a challenge bound to the id
 *     could never be signed.
 *  2. {@link approvalTypedData} (or {@link createTypedData} for `Create`) - the
 *     owners approve the assembled operation, key proof included.
 *  3. {@link submitTypedDataMessage} - the submitting owner's own envelope,
 *     signed as part of the transaction. It names the account and the operation
 *     and leaves the rest to `digest`, because the details were already shown to
 *     whoever approved.
 *
 * Consensus-critical: digests must match the on-chain multisig signing contract.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import { Serializer } from "../bcs/serializer";
import { AccountAddress } from "../core/accountAddress";
import {
    AgentOperationVariant,
    CrossTransferOption,
    DexTransferVariant,
    GatedPayloadVariant,
    MultisigOpVariant,
} from "../types/enums";
import {
    AccountTransferItem,
    AgentApprove,
    AgentRevoke,
    CreateSubAccount,
    CrossTransferItem,
    DexAgentTx,
    DexTransferTx,
    InternalTransferItem,
} from "./dexPayloads";
import {
    GatedPayload,
    MULTISIG_AUTHORIZATION_VERSION,
    MultisigOp,
    MultisigOpCreate,
    MultisigOpExecute,
    MultisigOpInstall,
    MultisigOpRemove,
    MultisigOpUpdatePolicy,
    ownerBytes,
    submitOperationName,
} from "./multisigPayloads";
import {
    accountTypeName,
    asset,
    digestFor,
    evmAddress,
    formatAmount,
    hashStructFor,
    intentionChainName,
    TypedData,
    TypedDataField,
    typedDataFor,
    TypeSpec,
    TYPES,
} from "./typedData";

const F = (name: string, type: string): TypedDataField => ({ name, type });

const CHAIN = F("intentionChain", "string");
const ACCOUNT = F("account", "address");
const EPOCH = F("authorityEpoch", "uint64");
const EXPIRES = F("expiresAt", "uint64");
const NONCE = F("nonce", "uint64");
const DIGEST = F("digest", "bytes32");

const ACCOUNT_TRANSFER_ITEM = [
    F("toAccount", "address"),
    F("token", "string"),
    F("amount", "string"),
    F("accountType", "string"),
];
const CROSS_TRANSFER_ITEM = ACCOUNT_TRANSFER_ITEM;
const INTERNAL_TRANSFER_ITEM = [
    F("fromSubaccount", "address"),
    F("toSubaccount", "address"),
    F("token", "string"),
    F("amount", "string"),
    F("accountType", "string"),
];

/**
 * Every type an owner can be asked to sign.
 *
 * `intentionChain`, `account` and `authorityEpoch` open each one and `expiresAt`
 * plus `digest` close it; what sits between is the operation. `digest` is the
 * operation id, so it covers every byte of the payload including the ones the
 * dialog does not spell out.
 */
export const MULTISIG_TYPES = {
    CreatePolicy: {
        primary: "IntentionMultisig_CreatePolicy",
        // No epoch: the account does not exist yet. The creator is named instead,
        // because creator and salt are what derive the address.
        fields: [CHAIN, ACCOUNT, F("creator", "address"), F("owners", "address[]"), F("threshold", "uint8"), EXPIRES, DIGEST],
        refs: {},
    },
    InstallPolicy: {
        primary: "IntentionMultisig_InstallPolicy",
        fields: [CHAIN, ACCOUNT, EPOCH, F("owners", "address[]"), F("threshold", "uint8"), EXPIRES, DIGEST],
        refs: {},
    },
    UpdatePolicy: {
        primary: "IntentionMultisig_UpdatePolicy",
        fields: [CHAIN, ACCOUNT, EPOCH, F("owners", "address[]"), F("threshold", "uint8"), EXPIRES, DIGEST],
        refs: {},
    },
    RemovePolicy: {
        primary: "IntentionMultisig_RemovePolicy",
        fields: [CHAIN, ACCOUNT, EPOCH, F("newAuthKey", "bytes32"), EXPIRES, DIGEST],
        refs: {},
    },
    KeyChallenge: {
        primary: "IntentionMultisig_KeyChallenge",
        fields: [CHAIN, ACCOUNT, EPOCH, F("newAuthKey", "bytes32"), F("operation", "uint8")],
        refs: {},
    },
    AccountTransfer: {
        primary: "IntentionMultisig_AccountTransfer",
        fields: [CHAIN, ACCOUNT, EPOCH, ...ACCOUNT_TRANSFER_ITEM, NONCE, EXPIRES, DIGEST],
        refs: {},
    },
    AccountTransferBatch: {
        primary: "IntentionMultisig_AccountTransferBatch",
        fields: [CHAIN, ACCOUNT, EPOCH, F("transfers", "AccountTransferItem[]"), NONCE, EXPIRES, DIGEST],
        refs: { AccountTransferItem: ACCOUNT_TRANSFER_ITEM },
    },
    CrossTransferBurn: {
        primary: "IntentionMultisig_CrossTransferBurn",
        fields: [CHAIN, ACCOUNT, EPOCH, ...CROSS_TRANSFER_ITEM, NONCE, EXPIRES, DIGEST],
        refs: {},
    },
    CrossTransferBurnBatch: {
        primary: "IntentionMultisig_CrossTransferBurnBatch",
        fields: [CHAIN, ACCOUNT, EPOCH, F("transfers", "CrossTransferItem[]"), NONCE, EXPIRES, DIGEST],
        refs: { CrossTransferItem: CROSS_TRANSFER_ITEM },
    },
    InternalTransfer: {
        primary: "IntentionMultisig_InternalTransfer",
        fields: [CHAIN, ACCOUNT, EPOCH, ...INTERNAL_TRANSFER_ITEM, NONCE, EXPIRES, DIGEST],
        refs: {},
    },
    InternalTransferBatch: {
        primary: "IntentionMultisig_InternalTransferBatch",
        fields: [CHAIN, ACCOUNT, EPOCH, F("transfers", "InternalTransferItem[]"), NONCE, EXPIRES, DIGEST],
        refs: { InternalTransferItem: INTERNAL_TRANSFER_ITEM },
    },
    ApproveAgent: {
        primary: "IntentionMultisig_ApproveAgent",
        fields: [CHAIN, ACCOUNT, EPOCH, F("agentAddress", "address"), F("name", "string"), F("expiryTimestamp", "uint64"), NONCE, EXPIRES, DIGEST],
        refs: {},
    },
    RevokeAgent: {
        primary: "IntentionMultisig_RevokeAgent",
        fields: [CHAIN, ACCOUNT, EPOCH, F("name", "string"), NONCE, EXPIRES, DIGEST],
        refs: {},
    },
    /** No `name`: see the single-key form in `typedData.ts`. */
    RevokeAllAgents: {
        primary: "IntentionMultisig_RevokeAllAgents",
        fields: [CHAIN, ACCOUNT, EPOCH, NONCE, EXPIRES, DIGEST],
        refs: {},
    },
    CreateSubAccount: {
        primary: "IntentionMultisig_CreateSubAccount",
        fields: [CHAIN, ACCOUNT, EPOCH, F("name", "string"), NONCE, EXPIRES, DIGEST],
        refs: {},
    },
    /**
     * The submitting owner's envelope, signed as part of the transaction.
     *
     * Defined with the other `IntentionTransaction_*` types rather than here,
     * because `buildTypedData` reaches for it on a `Multisig` payload the same way
     * it reaches for a transfer's: one list of what a wallet signs per
     * transaction, whoever assembled the payload.
     */
    MultisigSubmit: TYPES.MultisigSubmit,
} as const;

export type MultisigTypeSpec = (typeof MULTISIG_TYPES)[keyof typeof MULTISIG_TYPES];

/** A document and the digest signing it produces. */
export interface MultisigTypedData {
    typedData: TypedData;
    digest: Uint8Array;
}

function hex(bytes: Uint8Array): `0x${string}` {
    return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

function str(value: bigint | number): string {
    return value.toString();
}

type Built = { spec: TypeSpec; message: Record<string, unknown> };

interface Head {
    intentionChain: string;
    account: `0x${string}`;
    authorityEpoch: string;
}

/**
 * One transfer item as a wallet shows it, or `null` when it cannot be shown.
 *
 * `null` is a refusal, not a fallback: an asset the table cannot name or an
 * address outside the low twenty bytes means the dialog would have to guess, and
 * the chain refuses the same inputs. A partner must never sign a dialog that does
 * not say what the money is doing.
 */
function transferItemFields(
    to: AccountAddress,
    assetId: number,
    amount: bigint,
    accountType: number,
): Record<string, unknown> | null {
    const toAccount = evmAddress(to);
    if (!toAccount) return null;
    const meta = asset(assetId);
    if (!meta) return null;
    return {
        toAccount,
        token: meta.symbol,
        amount: formatAmount(amount, meta.decimals),
        accountType: accountTypeName(accountType),
    };
}

/**
 * Picks the single or the batch type, so a one-item transfer shows its fields
 * inline rather than as a one-element array.
 */
function transferBuilt(
    single: TypeSpec,
    batch: TypeSpec,
    items: (Record<string, unknown> | null)[],
    head: Head,
    nonce: bigint,
    tail: Record<string, unknown>,
): Built | null {
    if (items.length === 0 || items.some((item) => item === null)) return null;
    if (items.length === 1) {
        return { spec: single, message: { ...head, ...items[0], nonce: str(nonce), ...tail } };
    }
    return {
        spec: batch,
        message: { ...head, transfers: items as Record<string, unknown>[], nonce: str(nonce), ...tail },
    };
}

function executeBuilt(
    payload: GatedPayload,
    head: Head,
    tail: Record<string, unknown>,
): Built | null {
    if (payload.variant === GatedPayloadVariant.DexTransfer) {
        const tx = payload.inner as DexTransferTx;
        const nonce = tx.nonce;
        switch (tx.variant) {
            case DexTransferVariant.AccountTransfer: {
                const items = (tx.payload as AccountTransferItem[]).map((item) =>
                    transferItemFields(item.to_account, item.asset_id, item.amount, item.account_type),
                );
                return transferBuilt(
                    MULTISIG_TYPES.AccountTransfer,
                    MULTISIG_TYPES.AccountTransferBatch,
                    items,
                    head,
                    nonce,
                    tail,
                );
            }
            case DexTransferVariant.CrossTransfer: {
                // Only a withdrawal is owner-approved. A mint credits a bridge
                // deposit and is authorized by the bridge committee.
                if (tx.option !== CrossTransferOption.Burn) return null;
                const items = (tx.payload as CrossTransferItem[]).map((item) =>
                    transferItemFields(item.to_account, item.asset_id, item.amount, item.account_type),
                );
                return transferBuilt(
                    MULTISIG_TYPES.CrossTransferBurn,
                    MULTISIG_TYPES.CrossTransferBurnBatch,
                    items,
                    head,
                    nonce,
                    tail,
                );
            }
            case DexTransferVariant.InternalTransfer: {
                const items = (tx.payload as InternalTransferItem[]).map((item) => {
                    const from = evmAddress(item.from_subaddress);
                    const to = evmAddress(item.to_subaddress);
                    const meta = asset(item.asset_id);
                    if (!from || !to || !meta) return null;
                    return {
                        fromSubaccount: from,
                        toSubaccount: to,
                        token: meta.symbol,
                        amount: formatAmount(item.amount, meta.decimals),
                        accountType: accountTypeName(item.account_type),
                    };
                });
                return transferBuilt(
                    MULTISIG_TYPES.InternalTransfer,
                    MULTISIG_TYPES.InternalTransferBatch,
                    items,
                    head,
                    nonce,
                    tail,
                );
            }
            // A faucet mint has no owner-visible meaning on a policy account.
            default:
                return null;
        }
    }

    if (payload.variant === GatedPayloadVariant.DexAgent) {
        const tx = payload.inner as DexAgentTx;
        const nonce = str(tx.nonce);
        if (tx.variant === AgentOperationVariant.Approve) {
            const op = tx.operation as AgentApprove;
            const agent = evmAddress(op.agentAddress);
            if (!agent) return null;
            return {
                spec: MULTISIG_TYPES.ApproveAgent,
                message: {
                    ...head,
                    agentAddress: agent,
                    name: op.name,
                    expiryTimestamp: str(op.expiryTimestamp),
                    nonce,
                    ...tail,
                },
            };
        }
        if (tx.variant === AgentOperationVariant.Revoke) {
            const op = tx.operation as AgentRevoke;
            return {
                spec: MULTISIG_TYPES.RevokeAgent,
                message: { ...head, name: op.name, nonce, ...tail },
            };
        }
        if (tx.variant === AgentOperationVariant.RevokeAll) {
            return { spec: MULTISIG_TYPES.RevokeAllAgents, message: { ...head, nonce, ...tail } };
        }
        return null;
    }

    if (payload.variant === GatedPayloadVariant.CreateSubAccount) {
        const tx = payload.inner as CreateSubAccount;
        return {
            spec: MULTISIG_TYPES.CreateSubAccount,
            message: { ...head, name: tx.name, nonce: str(tx.nonce), ...tail },
        };
    }

    return null;
}

/**
 * The primary type and message an owner signs to approve `op`, or `null` when the
 * operation has no owner-signed document.
 *
 * Two operations return `null` by design rather than by omission: `Create`'s
 * document names the creator, which is the transaction's sender and not a field
 * of the operation (use {@link createTypedData}), and `RotateKey` is authorized
 * by the account's own key plus the incoming key's challenge, so no owner ever
 * signs one. Producing bytes for either would be producing bytes nobody should
 * sign.
 */
function buildApproval(
    chainId: number,
    account: AccountAddress,
    authorityEpoch: bigint | number,
    op: MultisigOp,
    expiresAtSecs: bigint | number,
    opId: Uint8Array,
): Built | null {
    const accountHex = evmAddress(account);
    if (!accountHex) return null;
    const head: Head = {
        intentionChain: intentionChainName(chainId),
        account: accountHex,
        authorityEpoch: str(BigInt(authorityEpoch)),
    };
    const tail = { expiresAt: str(BigInt(expiresAtSecs)), digest: hex(opId) };

    if (op instanceof MultisigOpInstall) {
        return {
            spec: MULTISIG_TYPES.InstallPolicy,
            message: { ...head, owners: op.owners.map(hex), threshold: str(op.threshold), ...tail },
        };
    }
    if (op instanceof MultisigOpUpdatePolicy) {
        return {
            spec: MULTISIG_TYPES.UpdatePolicy,
            message: { ...head, owners: op.owners.map(hex), threshold: str(op.threshold), ...tail },
        };
    }
    if (op instanceof MultisigOpRemove) {
        return {
            spec: MULTISIG_TYPES.RemovePolicy,
            message: { ...head, newAuthKey: hex(op.newAuthKey), ...tail },
        };
    }
    if (op instanceof MultisigOpExecute) {
        return executeBuilt(op.payload, head, tail);
    }
    return null;
}

/**
 * The document and digest an owner signs to approve `op`, or `null` when the
 * operation carries no owner-signed document.
 */
export function approvalTypedData(
    chainId: number,
    account: AccountAddress,
    authorityEpoch: bigint | number,
    op: MultisigOp,
    expiresAtSecs: bigint | number,
    opId: Uint8Array,
): MultisigTypedData | null {
    const built = buildApproval(chainId, account, authorityEpoch, op, expiresAtSecs, opId);
    if (!built) return null;
    return {
        typedData: typedDataFor(built.spec, chainId, built.message),
        digest: digestFor(built.spec, chainId, built.message),
    };
}

/** The 32 bytes an owner signs to approve `op`. */
export function approvalDigest(
    chainId: number,
    account: AccountAddress,
    authorityEpoch: bigint | number,
    op: MultisigOp,
    expiresAtSecs: bigint | number,
    opId: Uint8Array,
): Uint8Array | null {
    return approvalTypedData(chainId, account, authorityEpoch, op, expiresAtSecs, opId)?.digest ?? null;
}

/**
 * The creator-aware form for `Create`, whose document names the creator instead
 * of an epoch: the account does not exist yet, and creator plus salt are what
 * derive its address.
 */
export function createTypedData(
    chainId: number,
    account: AccountAddress,
    creator: AccountAddress,
    op: MultisigOpCreate,
    expiresAtSecs: bigint | number,
    opId: Uint8Array,
): MultisigTypedData | null {
    const accountHex = evmAddress(account);
    const creatorHex = evmAddress(creator);
    if (!accountHex || !creatorHex) return null;
    const message = {
        intentionChain: intentionChainName(chainId),
        account: accountHex,
        creator: creatorHex,
        owners: op.owners.map(hex),
        threshold: str(op.threshold),
        expiresAt: str(BigInt(expiresAtSecs)),
        digest: hex(opId),
    };
    const spec = MULTISIG_TYPES.CreatePolicy;
    return { typedData: typedDataFor(spec, chainId, message), digest: digestFor(spec, chainId, message) };
}

/** The 32 bytes an owner signs to approve a `Create`. */
export function createApprovalDigest(
    chainId: number,
    account: AccountAddress,
    creator: AccountAddress,
    op: MultisigOpCreate,
    expiresAtSecs: bigint | number,
    opId: Uint8Array,
): Uint8Array | null {
    return createTypedData(chainId, account, creator, op, expiresAtSecs, opId)?.digest ?? null;
}

/**
 * What an incoming control key signs to prove it exists.
 *
 * `opKind` is {@link MultisigOpVariant}: 3 for a `Remove`, 4 for a `RotateKey`.
 * The challenge is bound to the kind rather than to the operation id because the
 * id hashes the whole operation and this proof sits inside it - a challenge bound
 * to the id could never be signed, since producing the signature would change the
 * digest it was signed over. Account plus epoch plus kind is enough: a challenge
 * cannot move to another account, survive an authority change, or be presented
 * for a different kind of handover.
 */
export function keyChallengeTypedData(
    chainId: number,
    account: AccountAddress,
    authorityEpoch: bigint | number,
    newAuthKey: Uint8Array,
    opKind: MultisigOpVariant | number,
): MultisigTypedData | null {
    const accountHex = evmAddress(account);
    if (!accountHex) return null;
    if (newAuthKey.length !== 32) {
        throw new Error(`a new auth key must be 32 bytes, got ${newAuthKey.length}`);
    }
    const message = {
        intentionChain: intentionChainName(chainId),
        account: accountHex,
        authorityEpoch: str(BigInt(authorityEpoch)),
        newAuthKey: hex(newAuthKey),
        operation: str(opKind),
    };
    const spec = MULTISIG_TYPES.KeyChallenge;
    return { typedData: typedDataFor(spec, chainId, message), digest: digestFor(spec, chainId, message) };
}

/** The 32 bytes a secp256k1 control key signs as its challenge. */
export function keyChallengeDigest(
    chainId: number,
    account: AccountAddress,
    authorityEpoch: bigint | number,
    newAuthKey: Uint8Array,
    opKind: MultisigOpVariant | number,
): Uint8Array | null {
    return keyChallengeTypedData(chainId, account, authorityEpoch, newAuthKey, opKind)?.digest ?? null;
}

/**
 * The BCS bytes an Ed25519 control key signs, for a key that cannot produce
 * EIP-712. Same fields as {@link keyChallengeDigest}, so both schemes authorize
 * exactly the same thing.
 */
export function keyChallengeBytes(
    chainId: number,
    account: AccountAddress,
    authorityEpoch: bigint | number,
    newAuthKey: Uint8Array,
    opKind: MultisigOpVariant | number,
): Uint8Array {
    if (newAuthKey.length !== 32) {
        throw new Error(`a new auth key must be 32 bytes, got ${newAuthKey.length}`);
    }
    const serializer = new Serializer();
    serializer.serializeU8(chainId);
    serializer.serializeU8(MULTISIG_AUTHORIZATION_VERSION);
    account.serialize(serializer);
    serializer.serializeU64(BigInt(authorityEpoch));
    serializer.serializeFixedBytes(newAuthKey);
    serializer.serializeU8(Number(opKind));
    return serializer.toUint8Array();
}

/**
 * The envelope message the submitting owner's wallet shows, given the transaction
 * digest the raw transaction hashes to.
 *
 * Built here rather than in `typedData.ts` only so the multisig types stay in one
 * file; `buildTypedData` on a `Multisig` payload returns exactly this.
 */
export function submitTypedDataMessage(
    chainId: number,
    account: AccountAddress,
    op: MultisigOp,
    nonce: bigint,
    txnDigest: Uint8Array,
): Record<string, unknown> | null {
    const accountHex = evmAddress(account);
    if (!accountHex) return null;
    return {
        intentionChain: intentionChainName(chainId),
        account: accountHex,
        operation: submitOperationName(op),
        nonce: str(nonce),
        digest: hex(txnDigest),
    };
}

/**
 * The struct hash of the submitting owner's envelope.
 *
 * The struct hash rather than a full digest: this is the piece the transaction's
 * own EIP-712 digest folds in, and it is what the cross-language vectors pin.
 */
export function submitStructHash(
    chainId: number,
    account: AccountAddress,
    op: MultisigOp,
    nonce: bigint,
    txnDigest: Uint8Array,
): Uint8Array | null {
    const message = submitTypedDataMessage(chainId, account, op, nonce, txnDigest);
    if (!message) return null;
    return hashStructFor(MULTISIG_TYPES.MultisigSubmit, message);
}

/**
 * Whether a signature recovers to one of `owners`, and to which.
 *
 * The chain counts *distinct recovered addresses*, so a single key signing three
 * times is one approval; a caller collecting signatures should deduplicate the
 * same way before paying for a transaction that cannot meet its threshold.
 */
export function recoveredOwner(
    digest: Uint8Array,
    signature: { r: Uint8Array; s: Uint8Array; v: number },
    owners: readonly (string | Uint8Array | AccountAddress)[],
): `0x${string}` | undefined {
    const address = recoverEvmAddress(digest, signature);
    const wanted = owners.map((owner) => hex(ownerBytes(owner)));
    return wanted.includes(address) ? address : undefined;
}

/**
 * The EVM address that produced a signature over `digest`.
 *
 * Written here rather than imported from the wallet path because an owner's
 * signature is verified against an owner set, not against a transaction sender.
 */
export function recoverEvmAddress(
    digest: Uint8Array,
    signature: { r: Uint8Array; s: Uint8Array; v: number },
): `0x${string}` {
    const compact = new Uint8Array(64);
    compact.set(signature.r, 0);
    compact.set(signature.s, 32);
    const recovery = signature.v >= 27 ? signature.v - 27 : signature.v;
    if (recovery !== 0 && recovery !== 1) {
        throw new Error(`unexpected recovery id ${signature.v}`);
    }
    const publicKey = secp256k1.Signature.fromCompact(compact)
        .addRecoveryBit(recovery)
        .recoverPublicKey(digest)
        .toRawBytes(false);
    return hex(keccak_256(publicKey.slice(1)).slice(12));
}

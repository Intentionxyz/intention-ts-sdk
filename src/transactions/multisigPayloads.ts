// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Native multisig accounts: the wire types, the operation id, and the derived
 * address.
 *
 * An account's authority is one optional on-chain record. Absent, the account is
 * controlled by the key its address derives from - every account that has never
 * run a multisig operation. Present, it names either one control key or a k-of-n
 * owner set, and the operations that move funds or hand out authority then travel
 * as {@link DexMultisigTx} carrying the owners' EIP-712 approvals in the payload
 * rather than in the transaction authenticator: an orderless transaction lives 65
 * seconds, which is not long enough for a committee to sign an envelope, while a
 * proof can be collected over days and submitted by any owner.
 *
 * Consensus-critical: bytes must match the on-chain signing contract.
 * `tests/fixtures/multisig_signing_vectors.json` records the reference values,
 * and `tests/multisigVectors.test.ts` reproduces each case. Changes to the
 * signing contract invalidate previously collected approvals.
 */

import { keccak_256, sha3_256 } from "@noble/hashes/sha3";
import { Serializable, Serializer } from "../bcs/serializer";
import { AccountAddress } from "../core/accountAddress";
import {
    AuthorityKindVariant,
    GatedPayloadVariant,
    KeyProofVariant,
    MultisigOpVariant,
} from "../types/enums";
import { BridgeSignature, CreateSubAccount, DexAgentTx, DexTransferTx } from "./dexPayloads";
import { VaultTx } from "./vaultPayloads";

// --- Constants ------------------------------------------------------------

/** Signing-payload version, bound into every operation id. */
export const MULTISIG_AUTHORIZATION_VERSION = 1;
/** Layout version of a stored authority record. */
export const AUTHORITY_VERSION = 1;
/** Largest owner set a policy may name. */
export const MAX_POLICY_OWNERS = 10;
/** Longest a threshold proof stays submittable: thirty days. */
export const MAX_PROOF_VALIDITY_SECS = 30 * 24 * 60 * 60;

/** State-key prefix of the per-account authority record. */
export const DEX_AUTHORITY_PREFIX = "dex.authority.v1";
/** State-key prefix of one consumed operation id. */
export const DEX_MULTISIG_OP_USED_PREFIX = "dex.multisig.op.used.v1";
/** Domain string hashed into a derived multisig address. */
export const MULTISIG_ADDRESS_DOMAIN = "dex.multisig.v1";

function utf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

function fixed(name: string, bytes: Uint8Array, length: number): Uint8Array {
    if (bytes.length !== length) {
        throw new Error(`${name} must be exactly ${length} bytes, got ${bytes.length}`);
    }
    return bytes;
}

// --- Owner addresses ------------------------------------------------------

/**
 * An owner is twenty bytes.
 *
 * Owners sign EIP-712 typed data with ordinary EVM wallets and the chain recovers
 * them from the signature, so an owner entry is an EVM address and never this
 * chain's 32-byte form. Accepts either spelling and keeps the twenty bytes, which
 * is what BCS carries.
 */
export function ownerBytes(owner: string | Uint8Array | AccountAddress): Uint8Array {
    if (owner instanceof AccountAddress) {
        const raw = owner.toUint8Array();
        for (let i = 0; i < 12; i++) {
            if (raw[i] !== 0) {
                throw new Error(`owner ${owner.toStringLong()} is not an EVM address`);
            }
        }
        return raw.slice(12);
    }
    const bytes = typeof owner === "string" ? hexToBytes(owner) : owner;
    return fixed("an owner address", bytes, 20);
}

function hexToBytes(value: string): Uint8Array {
    const body = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
    if (body.length % 2 !== 0) throw new Error(`hex string of odd length: ${value}`);
    const out = new Uint8Array(body.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/** Lowercase hex, no prefix. */
function hex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function serializeOwners(serializer: Serializer, owners: readonly Uint8Array[]): void {
    serializer.serializeU32AsUleb128(owners.length);
    for (const owner of owners) serializer.serializeFixedBytes(fixed("an owner address", owner, 20));
}

// --- Proofs ---------------------------------------------------------------

/**
 * One owner's signature over an approval digest.
 *
 * The chain's `EvmSignature` has the same layout as {@link BridgeSignature}
 * (r[32] || s[32] || v), so that type is reused rather than duplicated.
 */
export type EvmSignature = BridgeSignature;

/**
 * Split a wallet's 65-byte `r || s || v` into the shape the proof carries.
 *
 * `v` is passed through as the wallet gave it: the chain subtracts 27 when it is
 * 27 or above, so both spellings of a recovery id verify.
 */
export function evmSignatureFromCompact(signature: string | Uint8Array): EvmSignature {
    const raw = typeof signature === "string" ? hexToBytes(signature) : signature;
    if (raw.length !== 65) {
        throw new Error(`a wallet signature must be 65 bytes (r||s||v), got ${raw.length}`);
    }
    return new BridgeSignature(raw.slice(0, 32), raw.slice(32, 64), raw[64]);
}

/**
 * The k-of-n approvals for one operation, collected off chain.
 *
 * `opId` is recomputed on chain; it travels so that a mismatch reports itself as
 * a proof-id error rather than as a bare threshold failure.
 */
export class MultisigProof extends Serializable {
    public readonly opId: Uint8Array;
    public readonly authorityEpoch: bigint;
    public readonly expiresAtSecs: bigint;
    public readonly signatures: EvmSignature[];

    constructor(
        opId: Uint8Array,
        authorityEpoch: bigint,
        expiresAtSecs: bigint,
        signatures: EvmSignature[],
    ) {
        super();
        this.opId = fixed("MultisigProof opId", opId, 32);
        this.authorityEpoch = authorityEpoch;
        this.expiresAtSecs = expiresAtSecs;
        this.signatures = signatures;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeFixedBytes(this.opId);
        serializer.serializeU64(this.authorityEpoch);
        serializer.serializeU64(this.expiresAtSecs);
        serializer.serializeVector(this.signatures);
    }
}

/**
 * A new control key proving it can sign, when authority is handed to it.
 *
 * Without it an owner set could hand an account to an address nobody holds a key
 * for, which is indistinguishable from destroying it.
 */
export abstract class KeyProof extends Serializable {
    abstract readonly variant: KeyProofVariant;
}

/**
 * secp256k1: an EIP-712 signature over `IntentionMultisig_KeyChallenge`.
 *
 * No public key travels: recovery yields the signer's address directly, and for
 * this scheme the address *is* the authentication key.
 */
export class KeyProofSecp256k1 extends KeyProof {
    public readonly variant = KeyProofVariant.Secp256k1;
    public readonly signature: EvmSignature;

    constructor(signature: EvmSignature) {
        super();
        this.signature = signature;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        this.signature.serialize(serializer);
    }
}

/**
 * Ed25519: a plain signature over the BCS-encoded challenge.
 *
 * The public key travels because an Ed25519 authentication key is a hash of it
 * and cannot be recovered from the signature.
 */
export class KeyProofEd25519 extends KeyProof {
    public readonly variant = KeyProofVariant.Ed25519;
    public readonly publicKey: Uint8Array;
    public readonly signature: Uint8Array;

    constructor(publicKey: Uint8Array, signature: Uint8Array) {
        super();
        this.publicKey = fixed("an Ed25519 public key", publicKey, 32);
        this.signature = signature;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        serializer.serializeFixedBytes(this.publicKey);
        // A `Vec<u8>`, so length-prefixed -- unlike the public key, which is a
        // fixed-size array on the chain.
        serializer.serializeBytes(this.signature);
    }
}

// --- Gated payloads -------------------------------------------------------

/** The inner transaction types a policy account can be made to execute. */
export type GatedPayloadInner = DexTransferTx | VaultTx | DexAgentTx | CreateSubAccount;

/**
 * One payload executed as the account, with the owners' approval.
 *
 * Exactly the operations an agent key cannot be delegated: they move funds out of
 * the account or hand out authority. Each variant is the unchanged transaction
 * type, so the chain reuses the existing handler with the policy account
 * substituted for the sender.
 */
export class GatedPayload extends Serializable {
    public readonly variant: GatedPayloadVariant;
    public readonly inner: GatedPayloadInner;

    constructor(variant: GatedPayloadVariant, inner: GatedPayloadInner) {
        super();
        this.variant = variant;
        this.inner = inner;
    }

    static transfer(inner: DexTransferTx): GatedPayload {
        return new GatedPayload(GatedPayloadVariant.DexTransfer, inner);
    }

    static vault(inner: VaultTx): GatedPayload {
        return new GatedPayload(GatedPayloadVariant.Vault, inner);
    }

    static agent(inner: DexAgentTx): GatedPayload {
        return new GatedPayload(GatedPayloadVariant.DexAgent, inner);
    }

    static createSubAccount(inner: CreateSubAccount): GatedPayload {
        return new GatedPayload(GatedPayloadVariant.CreateSubAccount, inner);
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        this.inner.serialize(serializer);
    }

    /** The inner payload's replay nonce, which the signed digest covers. */
    public get nonce(): bigint {
        return this.inner.nonce;
    }

    /**
     * Whether any single owner may submit this with no threshold proof.
     *
     * Always false, and deliberately so: every gated payload needs k-of-n. The
     * class is kept as a reserved shape on the chain, so this is one predicate
     * rather than an authorization model to re-litigate if an operation is ever
     * admitted back into it.
     */
    public get isAnyOwner(): boolean {
        return false;
    }
}

// --- Operations -----------------------------------------------------------

/** What a {@link DexMultisigTx} asks for. */
export abstract class MultisigOp extends Serializable {
    abstract readonly variant: MultisigOpVariant;

    /**
     * Whether this operation is authorized by a threshold proof, which is also
     * exactly when {@link DexMultisigTx} must carry one.
     *
     * `RotateKey` is the lone resident of the other class: it is authorized by
     * the account's own key plus the incoming key's challenge, so no owner signs
     * it. The chain refuses a surplus proof as well as a missing one, and both
     * verdicts are taken in the mempool.
     */
    public get requiresThresholdProof(): boolean {
        return this.variant !== MultisigOpVariant.RotateKey;
    }
}

/**
 * Install a policy on a fresh derived address.
 *
 * The proof is signed by the *new* owner set: nothing is being taken from anyone,
 * so it is a liveness check rather than an approval - evidence that at least
 * `threshold` of the listed addresses are keys someone holds, before funds are
 * sent to an address only they can move.
 */
export class MultisigOpCreate extends MultisigOp {
    public readonly variant = MultisigOpVariant.Create;
    public readonly owners: Uint8Array[];
    public readonly threshold: number;
    public readonly salt: Uint8Array;

    constructor(
        owners: readonly (string | Uint8Array | AccountAddress)[],
        threshold: number,
        salt: Uint8Array,
    ) {
        super();
        this.owners = owners.map(ownerBytes);
        this.threshold = threshold;
        this.salt = fixed("a Create salt", salt, 32);
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        serializeOwners(serializer, this.owners);
        serializer.serializeU8(this.threshold);
        serializer.serializeFixedBytes(this.salt);
    }
}

/**
 * Put an existing key-controlled account under a policy, keeping its address and
 * its history. Sent by the account itself, co-signed by the new owner set.
 */
export class MultisigOpInstall extends MultisigOp {
    public readonly variant = MultisigOpVariant.Install;
    public readonly owners: Uint8Array[];
    public readonly threshold: number;

    constructor(owners: readonly (string | Uint8Array | AccountAddress)[], threshold: number) {
        super();
        this.owners = owners.map(ownerBytes);
        this.threshold = threshold;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        serializeOwners(serializer, this.owners);
        serializer.serializeU8(this.threshold);
    }
}

/**
 * Change the owner set or the threshold.
 *
 * Approved by the current set *and* the proposed one: the first is the
 * authorization, the second keeps a mistyped owner list from stranding the
 * account's funds behind addresses nobody can sign for.
 */
export class MultisigOpUpdatePolicy extends MultisigOp {
    public readonly variant = MultisigOpVariant.UpdatePolicy;
    public readonly owners: Uint8Array[];
    public readonly threshold: number;

    constructor(owners: readonly (string | Uint8Array | AccountAddress)[], threshold: number) {
        super();
        this.owners = owners.map(ownerBytes);
        this.threshold = threshold;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        serializeOwners(serializer, this.owners);
        serializer.serializeU8(this.threshold);
    }
}

/**
 * Leave the policy and hand the account to one key.
 *
 * The owners must name that key and it must co-sign: otherwise "remove the
 * policy" would silently re-arm whichever key the account had before, which for a
 * derived address is no key at all.
 *
 * The signing order is fixed by the data: the incoming key signs the challenge
 * first, the operation is assembled around that proof, and only then do owners
 * approve - their digest covers the finished operation.
 */
export class MultisigOpRemove extends MultisigOp {
    public readonly variant = MultisigOpVariant.Remove;
    public readonly newAuthKey: Uint8Array;
    public readonly newKeyProof: KeyProof;

    constructor(newAuthKey: Uint8Array, newKeyProof: KeyProof) {
        super();
        this.newAuthKey = fixed("a new auth key", newAuthKey, 32);
        this.newKeyProof = newKeyProof;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        serializer.serializeFixedBytes(this.newAuthKey);
        this.newKeyProof.serialize(serializer);
    }
}

/**
 * Rotate a single-key account's control key without changing its address. Sent by
 * the current key and co-signed by the new one, so it carries no owner proof.
 */
export class MultisigOpRotateKey extends MultisigOp {
    public readonly variant = MultisigOpVariant.RotateKey;
    public readonly newAuthKey: Uint8Array;
    public readonly newKeyProof: KeyProof;

    constructor(newAuthKey: Uint8Array, newKeyProof: KeyProof) {
        super();
        this.newAuthKey = fixed("a new auth key", newAuthKey, 32);
        this.newKeyProof = newKeyProof;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        serializer.serializeFixedBytes(this.newAuthKey);
        this.newKeyProof.serialize(serializer);
    }
}

/** Run one gated payload as the account. */
export class MultisigOpExecute extends MultisigOp {
    public readonly variant = MultisigOpVariant.Execute;
    public readonly payload: GatedPayload;

    constructor(payload: GatedPayload) {
        super();
        this.payload = payload;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        this.payload.serialize(serializer);
    }

    public get requiresThresholdProof(): boolean {
        return !this.payload.isAnyOwner;
    }
}

/**
 * Manage or act as a multisig account.
 *
 * `nonce` is the envelope's replay protection, spent by the submitting key;
 * `account` is the account being managed or acted for, which for a derived
 * address is never the sender.
 */
export class DexMultisigTx extends Serializable {
    public readonly nonce: bigint;
    public readonly account: AccountAddress;
    public readonly op: MultisigOp;
    public readonly proof?: MultisigProof;

    constructor(nonce: bigint, account: AccountAddress, op: MultisigOp, proof?: MultisigProof) {
        super();
        this.nonce = nonce;
        this.account = account;
        this.op = op;
        this.proof = proof;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        this.account.serialize(serializer);
        this.op.serialize(serializer);
        serializer.serializeOption(this.proof);
    }
}

// --- Operation id ---------------------------------------------------------

/**
 * The `kind` byte an operation id binds.
 *
 * A gated payload's own kind is folded in, so an `Execute(DexTransfer)` proof
 * cannot be presented as an `Execute(DexAgent)` even though both are
 * `MultisigOp::Execute`. The `16 +` keeps the two numbering spaces from colliding
 * as the enums grow.
 */
export function opKindByte(op: MultisigOp): number {
    return op instanceof MultisigOpExecute ? 16 + op.payload.variant : op.variant;
}

/** keccak-256 of a value's BCS encoding. */
function keccakBcs(value: Serializable): Uint8Array {
    return keccak_256(value.bcsToBytes());
}

/**
 * The replay key the owners sign, and the id the chain records as spent.
 *
 * Every field closes an attack: `chainId` stops a signature made on one network
 * from verifying on another, `account` stops it moving to another account under
 * the same owners, `authorityEpoch` retires it when the owner set changes, the
 * kind byte stops a proof for one kind of operation being presented as another,
 * the payload digest covers every payload byte, and `expiresAtSecs` bounds how
 * long a collected-but-unused approval stays dangerous.
 */
export function multisigOperationId(
    chainId: number,
    account: AccountAddress,
    authorityEpoch: bigint | number,
    op: MultisigOp,
    expiresAtSecs: bigint | number,
): Uint8Array {
    const serializer = new Serializer();
    serializer.serializeU8(chainId);
    serializer.serializeU8(MULTISIG_AUTHORIZATION_VERSION);
    account.serialize(serializer);
    serializer.serializeU64(BigInt(authorityEpoch));
    serializer.serializeU8(opKindByte(op));
    // A fixed-size array on the chain, so no length prefix.
    serializer.serializeFixedBytes(keccakBcs(op));
    serializer.serializeU64(BigInt(expiresAtSecs));
    return keccak_256(serializer.toUint8Array());
}

/**
 * The operation name the submitting owner's envelope dialog shows, and the same
 * string the REST payload view reports.
 *
 * Stable: it is hashed into the envelope's struct hash.
 */
export function submitOperationName(op: MultisigOp): string {
    switch (op.variant) {
        case MultisigOpVariant.Create:
            return "create_policy";
        case MultisigOpVariant.Install:
            return "install_policy";
        case MultisigOpVariant.UpdatePolicy:
            return "update_policy";
        case MultisigOpVariant.Remove:
            return "remove_policy";
        case MultisigOpVariant.RotateKey:
            return "rotate_key";
        case MultisigOpVariant.Execute:
            switch ((op as MultisigOpExecute).payload.variant) {
                case GatedPayloadVariant.DexTransfer:
                    return "execute_transfer";
                case GatedPayloadVariant.Vault:
                    return "execute_vault";
                case GatedPayloadVariant.DexAgent:
                    return "execute_agent";
                case GatedPayloadVariant.CreateSubAccount:
                    return "execute_create_subaccount";
            }
    }
    throw new Error(`unknown multisig operation variant: ${String(op.variant)}`);
}

// --- Derived address ------------------------------------------------------

/**
 * The address a `Create` installs a policy on.
 *
 * Keyless by construction: twenty bytes of a hash, so no public key derives to it
 * and the chain's `derive(pubkey) == sender` check can never hold for it. Both
 * creator and salt are in the preimage, so one creator can hold several multisig
 * accounts and the address is computable before the transaction is sent.
 */
export function deriveMultisigAccountAddress(
    creator: AccountAddress,
    salt: Uint8Array,
): AccountAddress {
    const digest = sha3_256(
        concat([
            utf8(MULTISIG_ADDRESS_DOMAIN),
            creator.toUint8Array(),
            fixed("a Create salt", salt, 32),
        ]),
    );
    const address = new Uint8Array(32);
    // The leading twenty bytes, right-aligned: the same shape as a vault account
    // and a subaccount, which keeps every derived address EVM-formatted so a
    // wallet can render it.
    address.set(digest.slice(0, 20), 12);
    return new AccountAddress(address);
}

/**
 * The commitment to an owner set that `AuthorityChangedEvent` carries and the
 * `/dex/authority` endpoint reports.
 *
 * The members themselves are not in the event - an owner set is up to ten
 * addresses of consensus-visible payload - so this is how a reader checks that
 * the set it holds is the set that was installed.
 */
export function multisigOwnersDigest(
    owners: readonly (string | Uint8Array | AccountAddress)[],
): Uint8Array {
    const serializer = new Serializer();
    serializeOwners(serializer, owners.map(ownerBytes));
    return keccak_256(concat([utf8("INTENTION_MULTISIG_OWNERS"), serializer.toUint8Array()]));
}

// --- State keys -----------------------------------------------------------

/** The raw state key of one account's authority record. */
export function dexAuthorityRawKey(account: AccountAddress): Uint8Array {
    return concat([utf8(DEX_AUTHORITY_PREFIX), account.toUint8Array()]);
}

/** The raw state key of one consumed operation id. */
export function dexMultisigOpUsedRawKey(opId: Uint8Array): Uint8Array {
    return concat([utf8(DEX_MULTISIG_OP_USED_PREFIX), fixed("an operation id", opId, 32)]);
}

// --- Authority record -----------------------------------------------------

/** A fixed k-of-n owner set, as stored on chain. */
export interface MultisigPolicy {
    /** Equal-weight owners, each a 20-byte EVM address as lowercase hex. */
    owners: `0x${string}`[];
    /** How many distinct owners must approve. */
    threshold: number;
    createdAtSecs: bigint;
}

/**
 * What controls an account, decoded from the stored record.
 *
 * No record at all is the default and means the key the address derives from -
 * which is why the read endpoint answers 404 rather than rendering a default.
 */
export interface AccountAuthority {
    version: number;
    /**
     * Bumped by every change. Every proof names the epoch it was signed against,
     * so a change retires all outstanding approvals rather than leaving them live
     * against an owner set that no longer exists. Monotonic for the life of the
     * account, and it does not restart when an account leaves a policy.
     */
    epoch: bigint;
    kind: AuthorityKindVariant;
    /** Set for a key record: the named control key. */
    authKey?: `0x${string}`;
    /** Set for a policy record. */
    policy?: MultisigPolicy;
    updatedAtSecs: bigint;
}

// --- Error codes ----------------------------------------------------------

/**
 * Consensus-visible rejection codes for multisig execution.
 *
 * Free-form text cannot travel in an execution status - it feeds the transaction
 * info hash - so the reason arrives as an abort code. `0x5xxxx` is Move's
 * `PERMISSION_DENIED` category, continuing above the Admin Control block.
 */
export enum MultisigErrorCode {
    AuthorityNotFound = 0x50040,
    AuthorityExists = 0x50041,
    AuthorityKindMismatch = 0x50042,
    AuthorityKeyMismatch = 0x50043,
    DirectSubmissionBlocked = 0x50044,
    NotOwner = 0x50045,
    ProofRequired = 0x50046,
    ProofInvalid = 0x50047,
    SignatureInvalid = 0x50048,
    SignerNotOwner = 0x50049,
    ThresholdNotMet = 0x5004a,
    EpochMismatch = 0x5004b,
    ProofExpired = 0x5004c,
    OperationAlreadyUsed = 0x5004d,
    PolicyInvalid = 0x5004e,
    KeyProofInvalid = 0x5004f,
    AuthorityStoreFailed = 0x50050,
    Overflow = 0x50051,
    DerivedAddressMismatch = 0x50052,
    SubmitterNotAccount = 0x50053,
}

const MULTISIG_REASON_NAMES: Record<MultisigErrorCode, string> = {
    [MultisigErrorCode.AuthorityNotFound]: "DEX_MULTISIG_AUTHORITY_NOT_FOUND",
    [MultisigErrorCode.AuthorityExists]: "DEX_MULTISIG_AUTHORITY_EXISTS",
    [MultisigErrorCode.AuthorityKindMismatch]: "DEX_MULTISIG_AUTHORITY_KIND_MISMATCH",
    [MultisigErrorCode.AuthorityKeyMismatch]: "DEX_MULTISIG_AUTHORITY_KEY_MISMATCH",
    [MultisigErrorCode.DirectSubmissionBlocked]: "DEX_MULTISIG_DIRECT_SUBMISSION_BLOCKED",
    [MultisigErrorCode.NotOwner]: "DEX_MULTISIG_NOT_OWNER",
    [MultisigErrorCode.ProofRequired]: "DEX_MULTISIG_PROOF_REQUIRED",
    [MultisigErrorCode.ProofInvalid]: "DEX_MULTISIG_PROOF_INVALID",
    [MultisigErrorCode.SignatureInvalid]: "DEX_MULTISIG_SIGNATURE_INVALID",
    [MultisigErrorCode.SignerNotOwner]: "DEX_MULTISIG_SIGNER_NOT_OWNER",
    [MultisigErrorCode.ThresholdNotMet]: "DEX_MULTISIG_THRESHOLD_NOT_MET",
    [MultisigErrorCode.EpochMismatch]: "DEX_MULTISIG_EPOCH_MISMATCH",
    [MultisigErrorCode.ProofExpired]: "DEX_MULTISIG_PROOF_EXPIRED",
    [MultisigErrorCode.OperationAlreadyUsed]: "DEX_MULTISIG_OPERATION_ALREADY_USED",
    [MultisigErrorCode.PolicyInvalid]: "DEX_MULTISIG_POLICY_INVALID",
    [MultisigErrorCode.KeyProofInvalid]: "DEX_MULTISIG_KEY_PROOF_INVALID",
    [MultisigErrorCode.AuthorityStoreFailed]: "DEX_MULTISIG_AUTHORITY_STORE_FAILED",
    [MultisigErrorCode.Overflow]: "DEX_MULTISIG_OVERFLOW",
    [MultisigErrorCode.DerivedAddressMismatch]: "DEX_MULTISIG_DERIVED_ADDRESS_MISMATCH",
    [MultisigErrorCode.SubmitterNotAccount]: "DEX_MULTISIG_SUBMITTER_NOT_ACCOUNT",
};

/**
 * The reason name for an abort code, or `undefined` if it is not a multisig one.
 *
 * `undefined` rather than a guess: an abort code from another subsystem named as a
 * multisig failure would send a caller looking at the wrong proof.
 */
export function multisigReasonName(abortCode: number | bigint): string | undefined {
    const code = Number(abortCode) as MultisigErrorCode;
    return MULTISIG_REASON_NAMES[code];
}

// --- Policy checks --------------------------------------------------------

/**
 * The shape checks the chain applies on every write, so a caller can fail before
 * paying for a transaction: size, uniqueness, no zero owner, and a threshold that
 * is reachable.
 *
 * Returns the offending reason rather than throwing, because the caller that
 * assembles a policy from user input wants to show it.
 */
export function validateMultisigPolicy(
    owners: readonly (string | Uint8Array | AccountAddress)[],
    threshold: number,
): string | undefined {
    if (owners.length === 0) return "a policy needs at least one owner";
    if (owners.length > MAX_POLICY_OWNERS) {
        return `a policy may name at most ${MAX_POLICY_OWNERS} owners, got ${owners.length}`;
    }
    if (threshold === 0 || threshold > owners.length) {
        return `a threshold of ${threshold} is not reachable with ${owners.length} owners`;
    }
    let normalized: string[];
    try {
        normalized = owners.map((owner) => hex(ownerBytes(owner)));
    } catch (error) {
        return (error as Error).message;
    }
    if (normalized.some((owner) => owner === "00".repeat(20))) {
        return "the zero address cannot be an owner";
    }
    if (new Set(normalized).size !== normalized.length) {
        return "an owner is listed twice";
    }
    return undefined;
}

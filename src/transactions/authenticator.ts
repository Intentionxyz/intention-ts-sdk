// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * AccountAuthenticator and SignedTransaction
 *
 * For constructing the BCS-serialized signed transaction that gets
 * submitted via HTTP POST.
 *
 * Uses TransactionAuthenticatorSecp256k1
 * (variant=1) for direct Secp256k1 signing path.
 */

import { Serializable, Serializer } from "../bcs/serializer";
import {
    AnyPublicKey,
    AnySignature,
    Secp256k1PublicKey,
    Secp256k1Signature,
} from "../core/crypto";
import { RawTransaction, SimpleTransaction } from "./rawTransaction";

// ============================================================================
// AccountAuthenticator Variants
// ============================================================================

export enum AccountAuthenticatorVariant {
    Ed25519 = 0,
    MultiEd25519 = 1,
    SingleKey = 2,
    MultiKey = 3,
    NoAccountAuthenticator = 4,
}

// ============================================================================
// AccountAuthenticatorSingleKey
// ============================================================================

/**
 * Single-key authenticator.
 * Trading-web uses this with Secp256k1 keys.
 */
export class AccountAuthenticatorSingleKey extends Serializable {
    readonly public_key: AnyPublicKey;
    readonly signature: AnySignature;

    constructor(public_key: AnyPublicKey, signature: AnySignature) {
        super();
        this.public_key = public_key;
        this.signature = signature;
    }

    serialize(serializer: Serializer): void {
        // Variant tag for SingleKey
        serializer.serializeU32AsUleb128(AccountAuthenticatorVariant.SingleKey);
        this.public_key.serialize(serializer);
        this.signature.serialize(serializer);
    }
}

// ============================================================================
// TransactionAuthenticator Variants
// ============================================================================

export enum TransactionAuthenticatorVariant {
    Ed25519 = 0,
    Secp256k1 = 1,
    MultiEd25519 = 2,
    MultiAgent = 3,
    FeePayer = 4,
    SingleSender = 5,
}

// ============================================================================
// TransactionAuthenticatorSecp256k1 (Intention-specific)
// ============================================================================

/**
 * Intention-specific Secp256k1 transaction authenticator (variant=1).
 * Directly serializes the Secp256k1PublicKey and Secp256k1Signature
 * without the SingleSender/SingleKey nesting.
 */
export class TransactionAuthenticatorSecp256k1 extends Serializable {
    readonly public_key: Secp256k1PublicKey;
    readonly signature: Secp256k1Signature;

    constructor(public_key: Secp256k1PublicKey, signature: Secp256k1Signature) {
        super();
        this.public_key = public_key;
        this.signature = signature;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TransactionAuthenticatorVariant.Secp256k1);
        this.public_key.serialize(serializer);
        this.signature.serialize(serializer);
    }
}

// ============================================================================
// SignedTransaction
// ============================================================================

/**
 * Authenticator type for SignedTransaction.
 * Can be either:
 * - TransactionAuthenticatorSecp256k1 (Intention direct path, variant=1)
 * - AccountAuthenticatorSingleKey (wrapped in SingleSender, variant=5)
 */
type TransactionAuthenticator =
    | TransactionAuthenticatorSecp256k1
    | AccountAuthenticatorSingleKey;

/**
 * A signed transaction: RawTransaction + Authenticator.
 * This gets BCS-serialized and sent to the node.
 */
export class SignedTransaction extends Serializable {
    readonly raw_txn: RawTransaction;
    readonly authenticator: TransactionAuthenticator;

    constructor(
        raw_txn: RawTransaction,
        authenticator: TransactionAuthenticator,
    ) {
        super();
        this.raw_txn = raw_txn;
        this.authenticator = authenticator;
    }

    serialize(serializer: Serializer): void {
        this.raw_txn.serialize(serializer);
        if (this.authenticator instanceof TransactionAuthenticatorSecp256k1) {
            // Direct Secp256k1 path - authenticator serializes its own variant tag
            this.authenticator.serialize(serializer);
        } else {
            // SingleSender wrapper path
            serializer.serializeU32AsUleb128(TransactionAuthenticatorVariant.SingleSender);
            this.authenticator.serialize(serializer);
        }
    }
}

// ============================================================================
// Helper: create Secp256k1 transaction authenticator if applicable
// ============================================================================

/**
 * Extract Secp256k1 key/sig from an AccountAuthenticatorSingleKey
 * and create the direct TransactionAuthenticatorSecp256k1.
 * Returns undefined if the key type is not Secp256k1.
 */
function createSecp256k1TransactionAuthenticator(
    accountAuthenticator: AccountAuthenticatorSingleKey,
): TransactionAuthenticatorSecp256k1 | undefined {
    const publicKey = accountAuthenticator.public_key.publicKey;
    const signature = accountAuthenticator.signature.signature;
    if (publicKey instanceof Secp256k1PublicKey && signature instanceof Secp256k1Signature) {
        return new TransactionAuthenticatorSecp256k1(publicKey, signature);
    }
    return undefined;
}

// ============================================================================
// Helper: build SignedTransaction from SimpleTransaction
// ============================================================================

/**
 * Build a BCS-serialized signed transaction ready for submission.
 * Automatically uses the direct
 * TransactionAuthenticatorSecp256k1 path for Secp256k1 keys.
 */
export function generateSignedTransaction(args: {
    transaction: SimpleTransaction | RawTransaction;
    senderAuthenticator: AccountAuthenticatorSingleKey;
}): Uint8Array {
    const rawTx =
        args.transaction instanceof SimpleTransaction
            ? args.transaction.rawTransaction
            : args.transaction;

    // Try to use the direct Secp256k1 path (Intention-specific, variant=1)
    const secpAuthenticator = createSecp256k1TransactionAuthenticator(args.senderAuthenticator);
    const authenticator = secpAuthenticator ?? args.senderAuthenticator;

    const signedTxn = new SignedTransaction(rawTx, authenticator);
    return signedTxn.bcsToBytes();
}


// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Account and Secp256k1PrivateKey classes.
 *
 * - Secp256k1PrivateKey.generate()
 * - Account.fromPrivateKey({ privateKey, address? })
 * - account.accountAddress, account.publicKey, account.sign()
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { AccountAddress } from "./accountAddress";
import {
    Secp256k1PublicKey,
    Secp256k1Signature,
    AnyPublicKey,
    AnySignature,
} from "./crypto";
import { Serializable, Serializer } from "../bcs/serializer";
import { SimpleTransaction, RawTransaction } from "../transactions/rawTransaction";
import { AccountAuthenticatorSingleKey } from "../transactions/authenticator";
import { generateSigningMessageForTransaction } from "../transactions/signingMessage";
import { typedDataDigest } from "../transactions/typedData";

import { SigningSchemeInput } from "../types/enums";

function eip712DomainSeparator(): Uint8Array {
    const domainTypeHash = keccak_256(new TextEncoder().encode("EIP712Domain(string name)"));
    const nameHash = keccak_256(new TextEncoder().encode("Intention"));
    const encoded = new Uint8Array(64);
    encoded.set(domainTypeHash, 0);
    encoded.set(nameHash, 32);
    return keccak_256(encoded);
}

function eip712StructHash(signingMessage: Uint8Array): Uint8Array {
    const typeHash = keccak_256(new TextEncoder().encode("IntentionTransaction(bytes32 digest)"));
    const digest = keccak_256(signingMessage);
    const encoded = new Uint8Array(64);
    encoded.set(typeHash, 0);
    encoded.set(digest, 32);
    return keccak_256(encoded);
}

function eip712SignHash(message: Uint8Array): Uint8Array {
    const domainSep = eip712DomainSeparator();
    const structHash = eip712StructHash(message);
    const signData = new Uint8Array(66);
    signData[0] = 0x19;
    signData[1] = 0x01;
    signData.set(domainSep, 2);
    signData.set(structHash, 34);
    return keccak_256(signData);
}

// =============================================================================
// Secp256k1PrivateKey
// =============================================================================

/**
 * Secp256k1 ECDSA private key with EIP-712 compatible signing.
 */
export class Secp256k1PrivateKey extends Serializable {
    static readonly LENGTH = 32;
    private readonly key: Uint8Array;

    constructor(hexInput: string | Uint8Array) {
        super();
        let keyBytes: Uint8Array;
        if (typeof hexInput === "string") {
            // Strip 0x prefix if present, also strip AIP-80 "secp256k1-priv-" prefix if present
            let hex = hexInput;
            if (hex.startsWith("secp256k1-priv-")) {
                hex = hex.slice("secp256k1-priv-".length);
            }
            if (hex.startsWith("0x") || hex.startsWith("0X")) {
                hex = hex.slice(2);
            }
            keyBytes = new Uint8Array(
                hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
            );
        } else {
            keyBytes = hexInput;
        }
        if (keyBytes.length !== Secp256k1PrivateKey.LENGTH) {
            throw new Error(
                `Secp256k1PrivateKey length should be ${Secp256k1PrivateKey.LENGTH}, got ${keyBytes.length}`,
            );
        }
        this.key = keyBytes;
    }

    /** Generate a new random Secp256k1 private key. */
    static generate(): Secp256k1PrivateKey {
        const rawKey = secp256k1.utils.randomPrivateKey();
        return new Secp256k1PrivateKey(rawKey);
    }

    /** Return the 65-byte uncompressed public key. */
    publicKey(): Secp256k1PublicKey {
        const bytes = secp256k1.getPublicKey(this.key, false);
        return new Secp256k1PublicKey(bytes);
    }

    /** Derive EVM-compatible 32-byte account address (12 zero-padding + 20 EVM address). */
    toEvmAccountBytes(): Uint8Array {
        const pubKey = this.publicKey();
        const rawPoint = pubKey.data.slice(1); // drop 0x04 prefix
        const hash = keccak_256(rawPoint);
        const evmBytes = hash.slice(hash.length - 20);
        const padded = new Uint8Array(32);
        padded.set(evmBytes, 32 - 20);
        return padded;
    }

    /** Sign a message using EIP-712 compatible scheme. */
    sign(message: Uint8Array): Secp256k1Signature {
        const messageHash = eip712SignHash(message);
        const signature = secp256k1.sign(messageHash, this.key, { lowS: true });
        return new Secp256k1Signature(signature.toCompactRawBytes());
    }

    /**
     * Sign 32 bytes that are already an EIP-712 digest.
     *
     * `sign` wraps what it is given in `IntentionTransaction(bytes32 digest)`
     * first, which is what a wallet can only render as one opaque hash.
     * Transactions that move funds or grant authority are signed over named fields
     * instead - see `transactions/typedData`, which builds the digest from the
     * payload - so that digest arrives here finished and must not be wrapped again.
     */
    signDigest(digest: Uint8Array): Secp256k1Signature {
        if (digest.length !== 32) {
            throw new Error("digest must be exactly 32 bytes");
        }
        const signature = secp256k1.sign(digest, this.key, { lowS: true });
        return new Secp256k1Signature(signature.toCompactRawBytes());
    }

    /** Get the raw private key bytes. */
    toUint8Array(): Uint8Array {
        return this.key;
    }

    /** Get hex string with 0x prefix. */
    toHexString(): string {
        return (
            "0x" +
            Array.from(this.key)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")
        );
    }

    /** Convert to string (same as toHexString). */
    toString(): string {
        return this.toHexString();
    }

    serialize(serializer: Serializer): void {
        serializer.serializeBytes(this.key);
    }
}

/**
 * Account class
 *
 * Usage:
 * ```ts
 * const privateKey = Secp256k1PrivateKey.generate();
 * const account = Account.fromPrivateKey({ privateKey });
 * // or with explicit address:
 * const account2 = Account.fromPrivateKey({ privateKey, address: someAddress });
 * ```
 */
export class Account {
    readonly accountAddress: AccountAddress;
    readonly publicKey: AnyPublicKey;
    readonly privateKey: Secp256k1PrivateKey;
    readonly signingScheme: SigningSchemeInput = SigningSchemeInput.Secp256k1Ecdsa;

    private constructor(
        privateKey: Secp256k1PrivateKey,
        publicKey: AnyPublicKey,
        accountAddress: AccountAddress,
    ) {
        this.privateKey = privateKey;
        this.publicKey = publicKey;
        this.accountAddress = accountAddress;
    }

    /**
     * Create an Account from a Secp256k1PrivateKey.
     * If address is not provided, derives EVM-compatible address from public key.
     */
    static fromPrivateKey(args: {
        privateKey: Secp256k1PrivateKey;
        address?: AccountAddress;
    }): Account {
        const { privateKey, address } = args;
        const secp256k1PubKey = privateKey.publicKey();
        const anyPubKey = new AnyPublicKey(secp256k1PubKey);

        const accountAddress =
            address ?? new AccountAddress(privateKey.toEvmAccountBytes());

        return new Account(privateKey, anyPubKey, accountAddress);
    }

    /**
     * Generate a new random account.
     * Compatible with: Account.generate({ scheme: SigningSchemeInput.Secp256k1Ecdsa })
     */
    static generate(_args?: {
        scheme?: number;
        legacy?: boolean;
    }): Account {
        const privateKey = Secp256k1PrivateKey.generate();
        return Account.fromPrivateKey({ privateKey });
    }

    /**
     * Sign a message (Uint8Array) and return an AnySignature.
     */
    sign(message: Uint8Array): AnySignature {
        const sig = this.privateKey.sign(message);
        return new AnySignature(sig);
    }

    /**
     * Sign a transaction and return an AccountAuthenticatorSingleKey.
     */
    signTransactionWithAuthenticator(
        transaction: SimpleTransaction | RawTransaction,
    ): AccountAuthenticatorSingleKey {
        return new AccountAuthenticatorSingleKey(
            this.publicKey,
            this.signTransaction(transaction),
        );
    }

    /**
     * Sign a transaction, choosing what the signature covers from the payload.
     *
     * Anything that moves funds or grants authority is signed over named fields
     * the wallet can render; `transactions/typedData` decides which payloads those
     * are and builds the digest from the payload itself. Everything else - orders,
     * leverage, admin ops - is signed by an agent key with no dialog to render, and
     * keeps the opaque wrapper. The chain makes the same choice from the same
     * rules, so the two cannot drift apart.
     */
    signTransaction(
        transaction: SimpleTransaction | RawTransaction,
    ): AnySignature {
        const rawTx =
            transaction instanceof SimpleTransaction
                ? transaction.rawTransaction
                : transaction;
        const typed = typedDataDigest(rawTx);
        if (typed) {
            return new AnySignature(this.privateKey.signDigest(typed));
        }
        return this.sign(generateSigningMessageForTransaction(transaction));
    }
}

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Crypto types for Secp256k1 signing.
 *
 * Only includes the types trading-web needs:
 * - Secp256k1PublicKey, Secp256k1Signature
 * - AnyPublicKey, AnySignature
 */

import { Serializable, Serializer } from "../bcs/serializer";

// ============================================================================
// Secp256k1PublicKey
// ============================================================================

/**
 * 65-byte uncompressed Secp256k1 public key.
 */
export class Secp256k1PublicKey extends Serializable {
    static readonly LENGTH = 65;
    readonly data: Uint8Array;

    constructor(data: Uint8Array) {
        super();
        if (data.length !== Secp256k1PublicKey.LENGTH) {
            throw new Error(
                `Secp256k1PublicKey length should be ${Secp256k1PublicKey.LENGTH}, got ${data.length}`,
            );
        }
        this.data = data;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeBytes(this.data);
    }

    /** Return raw bytes of the public key. */
    toUint8Array(): Uint8Array {
        return this.data;
    }
}

// ============================================================================
// Secp256k1Signature
// ============================================================================

/**
 * 64-byte Secp256k1 signature (r || s).
 */
export class Secp256k1Signature extends Serializable {
    static readonly LENGTH = 64;
    readonly data: Uint8Array;

    constructor(data: Uint8Array) {
        super();
        if (data.length !== Secp256k1Signature.LENGTH) {
            throw new Error(
                `Secp256k1Signature length should be ${Secp256k1Signature.LENGTH}, got ${data.length}`,
            );
        }
        this.data = data;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeBytes(this.data);
    }
}

// ============================================================================
// AnyPublicKey / AnySignature
// ============================================================================

/**
 * Enum tag for public key type within AnyPublicKey.
 */
export enum AnyPublicKeyVariant {
    Ed25519 = 0,
    Secp256k1 = 1,
    Keyless = 3,
}

/**
 * Enum tag for signature type within AnySignature.
 */
export enum AnySignatureVariant {
    Ed25519 = 0,
    Secp256k1 = 1,
    Keyless = 3,
}

/**
 * AnyPublicKey - wraps a public key with a type tag.
 * Trading-web only uses Secp256k1.
 */
export class AnyPublicKey extends Serializable {
    readonly variant: AnyPublicKeyVariant;
    readonly publicKey: Secp256k1PublicKey;

    constructor(publicKey: Secp256k1PublicKey) {
        super();
        this.variant = AnyPublicKeyVariant.Secp256k1;
        this.publicKey = publicKey;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        this.publicKey.serialize(serializer);
    }

    /** Return raw bytes of the underlying public key. */
    toUint8Array(): Uint8Array {
        return this.publicKey.toUint8Array();
    }
}

/**
 * AnySignature - wraps a signature with a type tag.
 */
export class AnySignature extends Serializable {
    readonly variant: AnySignatureVariant;
    readonly signature: Secp256k1Signature;

    constructor(signature: Secp256k1Signature) {
        super();
        this.variant = AnySignatureVariant.Secp256k1;
        this.signature = signature;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        this.signature.serialize(serializer);
    }
}

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Supports EVM-compatible addresses with EIP-55 checksum.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { Serializable, Serializer } from "../bcs/serializer";

/**
 * Hex string <-> Uint8Array utility functions
 */
function hexToBytes(hex: string): Uint8Array {
    const clean = hex.length % 2 === 1 ? `0${hex}` : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export type AccountAddressInput = string | Uint8Array | AccountAddress;

/**
 * 32-byte account address.
 * Supports EVM-compatible addresses.
 */
export class AccountAddress extends Serializable {
    readonly data: Uint8Array;

    static readonly LENGTH = 32;
    static readonly LONG_STRING_LENGTH = 64;

    static ZERO: AccountAddress;
    static ONE: AccountAddress;

    constructor(input: Uint8Array) {
        super();
        if (input.length !== AccountAddress.LENGTH) {
            throw new Error(
                `AccountAddress data should be exactly ${AccountAddress.LENGTH} bytes long, got ${input.length}`,
            );
        }
        this.data = input;
    }

    /**
     * Check if address is special (0x0 to 0xf).
     */
    isSpecial(): boolean {
        return (
            this.data.slice(0, this.data.length - 1).every((b) => b === 0) &&
            this.data[this.data.length - 1] < 16
        );
    }

    /**
     * Check if address is EVM-compatible (leading 12 bytes are zero).
     * An EVM address is 20 bytes; when stored in a 32-byte address,
     * the first 12 bytes are zero-padded.
     */
    isEvmCompatible(): boolean {
        const accountAddressEvmLength = 20;
        const leadingBytesToCheck = AccountAddress.LENGTH - accountAddressEvmLength; // 12 bytes
        for (let i = 0; i < leadingBytesToCheck; i++) {
            if (this.data[i] !== 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * Apply EIP-55 checksum encoding to an EVM address.
     * Mixes uppercase and lowercase hex letters based on the keccak hash.
     */
    private static toEip55Checksum(address: string): string {
        const lowerAddress = address.toLowerCase();
        const hash = bytesToHex(keccak_256(lowerAddress));
        let checksummed = "";

        for (let i = 0; i < lowerAddress.length; i++) {
            const char = lowerAddress[i];
            if (char >= "a" && char <= "f") {
                const hashDigit = parseInt(hash[i], 16);
                checksummed += hashDigit >= 8 ? char.toUpperCase() : char;
            } else {
                checksummed += char;
            }
        }

        return checksummed;
    }

    // --- String representations ---

    /**
     * Render the address for display.
     *
     * An address is always 32 bytes in storage; only the rendering differs, and
     * Intention's rule is EVM-compatibility first:
     *   - special addresses (0x0..0xf) render short:  `0x1`
     *   - addresses whose first 12 bytes are zero render as a 20-byte EVM
     *     address with an EIP-55 checksum: `0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`
     *   - anything else renders in full: `0x` + 64 hex chars
     *
     * The short and long forms follow AIP-40; the 20-byte EVM form is an
     * Intention addition and takes precedence when it applies.
     */
    toString(): string {
        return `0x${this.toStringWithoutPrefix()}`;
    }

    /**
     * Return the address without 0x prefix.
     * If EVM-compatible, returns EVM format (20 bytes) with EIP-55 checksum.
     */
    toStringWithoutPrefix(): string {
        // If EVM-compatible, return EVM format (last 20 bytes) with EIP-55 checksum
        if (this.isEvmCompatible()) {
            const accountAddressEvmLength = 20;
            const evmBytes = this.data.slice(AccountAddress.LENGTH - accountAddressEvmLength);
            const hexAddress = bytesToHex(evmBytes);
            return AccountAddress.toEip55Checksum(hexAddress);
        }

        let hex = bytesToHex(this.data);
        if (this.isSpecial()) {
            hex = hex[hex.length - 1];
        }
        return hex;
    }

    /**
     * Return the address in LONG form: 0x + 64 hex characters (always full).
     */
    toStringLong(): string {
        return `0x${this.toStringLongWithoutPrefix()}`;
    }

    /**
     * Return the address in LONG form without 0x prefix.
     */
    toStringLongWithoutPrefix(): string {
        return bytesToHex(this.data);
    }

    /**
     * Return the address in SHORT form: 0x + no leading zeros.
     */
    toStringShort(): string {
        return `0x${this.toStringShortWithoutPrefix()}`;
    }

    /**
     * Return the address in SHORT form without 0x prefix.
     */
    toStringShortWithoutPrefix(): string {
        const hex = bytesToHex(this.data).replace(/^0+/, "");
        return hex === "" ? "0" : hex;
    }

    toUint8Array(): Uint8Array {
        return this.data;
    }

    // --- Serialization ---

    serialize(serializer: Serializer): void {
        serializer.serializeFixedBytes(this.data);
    }

    // --- Factory methods ---

    /**
     * Create from hex string (with or without 0x prefix).
     * Pads to 32 bytes. Allows short addresses for special and EVM-compatible addresses.
     */
    static fromString(
        input: string,
        { maxMissingChars = 4 }: { maxMissingChars?: number } = {},
    ): AccountAddress {
        let parsed = input;
        if (parsed.startsWith("0x")) {
            parsed = parsed.slice(2);
        }
        if (parsed.length === 0) {
            throw new Error("Hex string is too short, must be 1 to 64 chars long, excluding the leading 0x.");
        }
        if (parsed.length > 64) {
            throw new Error("Hex string is too long, must be 1 to 64 chars long, excluding the leading 0x.");
        }
        const addressBytes = hexToBytes(parsed.padStart(64, "0"));
        const address = new AccountAddress(addressBytes);

        // Allow short addresses for special addresses (0x0-0xf) and EVM-compatible addresses
        if (parsed.length < 64 - maxMissingChars) {
            if (!address.isSpecial() && !address.isEvmCompatible()) {
                throw new Error(
                    `Hex string is too short, must be ${64 - maxMissingChars} to 64 chars long, excluding the leading 0x. ` +
                    `Received ${input}`,
                );
            }
        }
        return address;
    }

    /**
     * Create from string, Uint8Array, or AccountAddress.
     */
    static from(
        input: AccountAddressInput,
        { maxMissingChars = 4 }: { maxMissingChars?: number } = {},
    ): AccountAddress {
        if (typeof input === "string") {
            return AccountAddress.fromString(input, { maxMissingChars });
        }
        if (input instanceof Uint8Array) {
            return new AccountAddress(input);
        }
        return input;
    }

    /**
     * Compare two addresses.
     */
    equals(other: AccountAddress): boolean {
        if (this.data.length !== other.data.length) return false;
        return this.data.every((val, idx) => val === other.data[idx]);
    }
}

// Initialize static addresses
AccountAddress.ZERO = AccountAddress.from("0x0");
AccountAddress.ONE = AccountAddress.from("0x1");

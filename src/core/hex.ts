// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Hex utility class for working with hex data.
 */

import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { ParsingError, ParsingResult } from "./common";

/**
 * Type for hex input: either a hex string or Uint8Array.
 */
export type HexInput = string | Uint8Array;

/**
 * Reasons that hex parsing can fail.
 */
export enum HexInvalidReason {
    TOO_SHORT = "too_short",
    INVALID_LENGTH = "invalid_length",
    INVALID_HEX_CHARS = "invalid_hex_chars",
}

/**
 * Helper class for working with hex data.
 *
 * NOTE: Do not use this class for account addresses; use AccountAddress instead.
 * When accepting hex data as input, prefer HexInput and use Hex static methods.
 */
export class Hex {
    private readonly data: Uint8Array;

    constructor(data: Uint8Array) {
        this.data = data;
    }

    // --- Conversion methods ---

    toUint8Array(): Uint8Array {
        return this.data;
    }

    toStringWithoutPrefix(): string {
        return bytesToHex(this.data);
    }

    toString(): string {
        return `0x${this.toStringWithoutPrefix()}`;
    }

    // --- Factory methods ---

    static fromHexString(str: string): Hex {
        let input = str;
        if (input.startsWith("0x")) {
            input = input.slice(2);
        }

        if (input.length === 0) {
            throw new ParsingError(
                "Hex string is too short, must be at least 1 char long, excluding the optional leading 0x.",
                HexInvalidReason.TOO_SHORT,
            );
        }

        if (input.length % 2 !== 0) {
            throw new ParsingError(
                "Hex string must be an even number of hex characters.",
                HexInvalidReason.INVALID_LENGTH,
            );
        }

        try {
            return new Hex(hexToBytes(input));
        } catch (error: any) {
            throw new ParsingError(
                `Hex string contains invalid hex characters: ${error?.message}`,
                HexInvalidReason.INVALID_HEX_CHARS,
            );
        }
    }

    static fromHexInput(hexInput: HexInput): Hex {
        if (hexInput instanceof Uint8Array) return new Hex(hexInput);
        return Hex.fromHexString(hexInput);
    }

    static hexInputToUint8Array(hexInput: HexInput): Uint8Array {
        if (hexInput instanceof Uint8Array) return hexInput;
        return Hex.fromHexString(hexInput).toUint8Array();
    }

    static hexInputToString(hexInput: HexInput): string {
        return Hex.fromHexInput(hexInput).toString();
    }

    static hexInputToStringWithoutPrefix(hexInput: HexInput): string {
        return Hex.fromHexInput(hexInput).toStringWithoutPrefix();
    }

    // --- Validation ---

    static isValid(str: string): ParsingResult<HexInvalidReason> {
        try {
            Hex.fromHexString(str);
            return { valid: true };
        } catch (error: any) {
            return {
                valid: false,
                invalidReason: error?.invalidReason,
                invalidReasonMessage: error?.message,
            };
        }
    }

    equals(other: Hex): boolean {
        if (this.data.length !== other.data.length) return false;
        return this.data.every((value, index) => value === other.data[index]);
    }
}

export const hexToAsciiString = (hex: string) =>
    new TextDecoder().decode(Hex.fromHexInput(hex).toUint8Array());

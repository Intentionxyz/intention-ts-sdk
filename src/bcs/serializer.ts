// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * BCS (Binary Canonical Serialization) - Serializer
 */

export const MAX_U8_NUMBER = 255;
export const MAX_U16_NUMBER = 65535;
export const MAX_U32_NUMBER = 4294967295;
export const MAX_U64_BIG_INT = BigInt("18446744073709551615");
export const MAX_U128_BIG_INT = BigInt("340282366920938463463374607431768211455");

export const MIN_I8_NUMBER = -128;
export const MAX_I8_NUMBER = 127;
export const MIN_I16_NUMBER = -32768;
export const MAX_I16_NUMBER = 32767;
export const MIN_I32_NUMBER = -2147483648;
export const MAX_I32_NUMBER = 2147483647;
export const MIN_I64_BIG_INT = BigInt("-9223372036854775808");
export const MAX_I64_BIG_INT = BigInt("9223372036854775807");
export const MIN_I128_BIG_INT = BigInt("-170141183460469231731687303715884105728");
export const MAX_I128_BIG_INT = BigInt("170141183460469231731687303715884105727");

// ============================================================================
// Serializable base class
// ============================================================================

/**
 * Base class for all BCS-serializable types.
 */
export abstract class Serializable {
    abstract serialize(serializer: Serializer): void;

    /**
     * Serialize to BCS bytes.
     */
    bcsToBytes(): Uint8Array {
        const serializer = new Serializer();
        this.serialize(serializer);
        return serializer.toUint8Array();
    }

    /**
     * Hex string without 0x prefix.
     */
    toStringWithoutPrefix(): string {
        const bytes = this.bcsToBytes();
        return Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }

    /**
     * Hex string with 0x prefix.
     */
    toString(): string {
        return `0x${this.toStringWithoutPrefix()}`;
    }
}


function ensureBoolean(value: unknown): asserts value is boolean {
    if (typeof value !== "boolean") {
        throw new Error(`${value} is not a boolean value`);
    }
}

function validateNumberInRange<T extends number | bigint>(value: T, minValue: T, maxValue: T): void {
    const valueBigInt = BigInt(value);
    if (valueBigInt > BigInt(maxValue) || valueBigInt < BigInt(minValue)) {
        throw new Error(`${value} is out of range: [${minValue}, ${maxValue}]`);
    }
}

/**
 * BCS Serializer - writes data in Binary Canonical Serialization format.
 */
export class Serializer {
    private buffer: ArrayBuffer;
    private offset: number;

    constructor(length: number = 64) {
        if (length <= 0) {
            throw new Error("Length needs to be greater than 0");
        }
        this.buffer = new ArrayBuffer(length);
        this.offset = 0;
    }

    private ensureBufferWillHandleSize(bytes: number): void {
        while (this.buffer.byteLength < this.offset + bytes) {
            const newBuffer = new ArrayBuffer(this.buffer.byteLength * 2);
            new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
            this.buffer = newBuffer;
        }
    }

    protected appendToBuffer(values: Uint8Array): void {
        this.ensureBufferWillHandleSize(values.length);
        new Uint8Array(this.buffer, this.offset).set(values);
        this.offset += values.length;
    }

    private serializeWithFunction(
        fn: (byteOffset: number, value: number, littleEndian?: boolean) => void,
        bytesLength: number,
        value: number,
    ): void {
        this.ensureBufferWillHandleSize(bytesLength);
        const dv = new DataView(this.buffer, this.offset);
        fn.apply(dv, [0, value, true]);
        this.offset += bytesLength;
    }

    /**
     * Get serialized bytes.
     */
    toUint8Array(): Uint8Array {
        return new Uint8Array(this.buffer).slice(0, this.offset);
    }

    serializeBool(value: boolean): void {
        ensureBoolean(value);
        const byteValue = value ? 1 : 0;
        this.appendToBuffer(new Uint8Array([byteValue]));
    }

    serializeU8(value: number): void {
        validateNumberInRange(value, 0, MAX_U8_NUMBER);
        this.appendToBuffer(new Uint8Array([value]));
    }

    serializeU16(value: number): void {
        validateNumberInRange(value, 0, MAX_U16_NUMBER);
        this.serializeWithFunction(DataView.prototype.setUint16, 2, value);
    }

    serializeU32(value: number): void {
        validateNumberInRange(value, 0, MAX_U32_NUMBER);
        this.serializeWithFunction(DataView.prototype.setUint32, 4, value);
    }

    serializeU64(value: number | bigint): void {
        const bigVal = BigInt(value);
        validateNumberInRange(bigVal, BigInt(0), MAX_U64_BIG_INT);
        const low = bigVal & BigInt(MAX_U32_NUMBER);
        const high = bigVal >> BigInt(32);
        // write little endian number
        this.serializeU32(Number(low));
        this.serializeU32(Number(high));
    }

    serializeU128(value: number | bigint): void {
        const bigVal = BigInt(value);
        validateNumberInRange(bigVal, BigInt(0), MAX_U128_BIG_INT);
        const low = bigVal & MAX_U64_BIG_INT;
        const high = bigVal >> BigInt(64);
        // write little endian number
        this.serializeU64(low);
        this.serializeU64(high);
    }

    serializeI8(value: number): void {
        validateNumberInRange(value, MIN_I8_NUMBER, MAX_I8_NUMBER);
        this.serializeWithFunction(DataView.prototype.setInt8, 1, value);
    }

    serializeI16(value: number): void {
        validateNumberInRange(value, MIN_I16_NUMBER, MAX_I16_NUMBER);
        this.serializeWithFunction(DataView.prototype.setInt16, 2, value);
    }

    serializeI32(value: number): void {
        validateNumberInRange(value, MIN_I32_NUMBER, MAX_I32_NUMBER);
        this.serializeWithFunction(DataView.prototype.setInt32, 4, value);
    }

    serializeI64(value: number | bigint): void {
        const val = BigInt(value);
        validateNumberInRange(val, MIN_I64_BIG_INT, MAX_I64_BIG_INT);
        // Convert to unsigned representation using two's complement
        const unsigned = val < 0 ? (BigInt(1) << BigInt(64)) + val : val;
        const low = unsigned & BigInt(MAX_U32_NUMBER);
        const high = unsigned >> BigInt(32);
        // write little endian number
        this.serializeU32(Number(low));
        this.serializeU32(Number(high));
    }

    serializeI128(value: number | bigint): void {
        const val = BigInt(value);
        validateNumberInRange(val, MIN_I128_BIG_INT, MAX_I128_BIG_INT);
        // Convert to unsigned representation using two's complement
        const unsigned = val < 0 ? (BigInt(1) << BigInt(128)) + val : val;
        const low = unsigned & MAX_U64_BIG_INT;
        const high = unsigned >> BigInt(64);
        // write little endian number
        this.serializeU64(low);
        this.serializeU64(high);
    }

    // --- Variable-length types ---

    /**
     * Serialize a UTF-8 string (length-prefixed).
     */
    serializeStr(value: string): void {
        const textEncoder = new TextEncoder();
        this.serializeBytes(textEncoder.encode(value));
    }

    /**
     * Serialize bytes with ULEB128 length prefix.
     */
    serializeBytes(value: Uint8Array): void {
        this.serializeU32AsUleb128(value.length);
        this.appendToBuffer(value);
    }

    /**
     * Serialize fixed-length bytes (no length prefix).
     */
    serializeFixedBytes(value: Uint8Array): void {
        this.appendToBuffer(value);
    }

    /**
     * Serialize a u32 as ULEB128 variable-length encoding.
     */
    serializeU32AsUleb128(val: number): void {
        validateNumberInRange(val, 0, MAX_U32_NUMBER);
        let value = val;
        const valueArray: number[] = [];
        while (value >>> 7 !== 0) {
            valueArray.push((value & 0x7f) | 0x80);
            value >>>= 7;
        }
        valueArray.push(value);
        this.appendToBuffer(new Uint8Array(valueArray));
    }

    // --- Composite types ---

    /**
     * Serialize a Serializable value.
     */
    serialize<T extends Serializable>(value: T): void {
        value.serialize(this);
    }

    /**
     * Serialize a vector of Serializable values (length-prefixed).
     */
    serializeVector<T extends Serializable>(values: Array<T>): void {
        this.serializeU32AsUleb128(values.length);
        values.forEach((item) => {
            item.serialize(this);
        });
    }

    /**
     * Serialize an optional value (bool prefix + value if present).
     */
    serializeOption<T extends Serializable | string | Uint8Array>(
        value?: T,
        len?: number,
    ): void {
        const hasValue = value !== undefined;
        this.serializeBool(hasValue);
        if (hasValue) {
            if (typeof value === "string") {
                this.serializeStr(value);
            } else if (value instanceof Uint8Array) {
                if (len !== undefined) {
                    this.serializeFixedBytes(value);
                } else {
                    this.serializeBytes(value);
                }
            } else {
                value.serialize(this);
            }
        }
    }
}

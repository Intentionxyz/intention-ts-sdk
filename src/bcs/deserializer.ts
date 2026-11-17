// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * BCS (Binary Canonical Serialization) - Deserializer
 */

export class Deserializer {
    private data: DataView;
    private offset: number;

    constructor(data: Uint8Array) {
        this.data = new DataView(data.buffer, data.byteOffset, data.byteLength);
        this.offset = 0;
    }

    get remaining(): number {
        return this.data.byteLength - this.offset;
    }

    private read(n: number): void {
        if (this.offset + n > this.data.byteLength) {
            throw new Error(`BCS deserialize: need ${n} bytes but only ${this.remaining} remaining`);
        }
    }

    deserializeBool(): boolean {
        this.read(1);
        const v = this.data.getUint8(this.offset);
        this.offset += 1;
        if (v === 0) return false;
        if (v === 1) return true;
        throw new Error(`BCS deserialize: invalid bool value ${v}`);
    }

    deserializeU8(): number {
        this.read(1);
        const v = this.data.getUint8(this.offset);
        this.offset += 1;
        return v;
    }

    deserializeU16(): number {
        this.read(2);
        const v = this.data.getUint16(this.offset, true);
        this.offset += 2;
        return v;
    }

    deserializeU32(): number {
        this.read(4);
        const v = this.data.getUint32(this.offset, true);
        this.offset += 4;
        return v;
    }

    deserializeI32(): number {
        this.read(4);
        const v = this.data.getInt32(this.offset, true);
        this.offset += 4;
        return v;
    }

    deserializeU64(): bigint {
        this.read(8);
        const v = this.data.getBigUint64(this.offset, true);
        this.offset += 8;
        return v;
    }

    deserializeI64(): bigint {
        this.read(8);
        const v = this.data.getBigInt64(this.offset, true);
        this.offset += 8;
        return v;
    }

    deserializeU128(): bigint {
        this.read(16);
        const lo = this.data.getBigUint64(this.offset, true);
        const hi = this.data.getBigUint64(this.offset + 8, true);
        this.offset += 16;
        return (hi << BigInt(64)) | lo;
    }

    deserializeI128(): bigint {
        this.read(16);
        const lo = this.data.getBigUint64(this.offset, true);
        const hi = this.data.getBigInt64(this.offset + 8, true);
        this.offset += 16;
        return (hi << BigInt(64)) | lo;
    }

    deserializeU32FromUleb128(): number {
        let result = 0;
        let shift = 0;
        while (true) {
            this.read(1);
            const b = this.data.getUint8(this.offset);
            this.offset += 1;
            result |= (b & 0x7f) << shift;
            if ((b & 0x80) === 0) break;
            shift += 7;
            if (shift >= 35) throw new Error("BCS deserialize: ULEB128 overflow");
        }
        return result >>> 0;
    }

    deserializeBytes(): Uint8Array {
        const length = this.deserializeU32FromUleb128();
        return this.deserializeFixedBytes(length);
    }

    deserializeFixedBytes(n: number): Uint8Array {
        this.read(n);
        const bytes = new Uint8Array(this.data.buffer, this.data.byteOffset + this.offset, n);
        const copy = new Uint8Array(n);
        copy.set(bytes);
        this.offset += n;
        return copy;
    }

    deserializeStr(): string {
        const bytes = this.deserializeBytes();
        return new TextDecoder().decode(bytes);
    }

    deserializeOptionBool(): boolean | undefined {
        const present = this.deserializeBool();
        if (!present) return undefined;
        return this.deserializeBool();
    }
}

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/** Vault schema v1. Field order mirrors core BCS; *_Bits preserve raw unsigned bits. */
import { Deserializer } from "../bcs/deserializer";
import { AccountAddress } from "../core/accountAddress";

export interface DexVaultInternalOffsetEvent {
    schemaVersion: bigint;
    vaultAccount: string;
    subAddress: string;
    subaccountNumber: number;
    symbolId: number;
    status: number;
    quantums: bigint;
    beforeLongQuantums: bigint;
    beforeShortQuantums: bigint;
    afterLongQuantums: bigint;
    afterShortQuantums: bigint;
    price: bigint;
    offsetQuote: bigint;
    longReleasedCost: bigint;
    shortReleasedCost: bigint;
    longRealizedPnlBits: bigint;
    shortRealizedPnlBits: bigint;
    totalRealizedPnlBits: bigint;
    totalFee: bigint;
    blockHeight: bigint;
    timestampUs: bigint;
    actionSeq: number;
}

export const VAULT_EVENT_NAMES = [
    "VaultInternalOffsetEvent",
] as const;
export type VaultEventType = (typeof VAULT_EVENT_NAMES)[number];
export type VaultEvent =
    DexVaultInternalOffsetEvent;

function uint(value: unknown, bits: number): bigint {
    if (typeof value === "number" && !Number.isSafeInteger(value))
        throw new Error("unsafe JSON integer");
    if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "bigint"
    )
        throw new Error("invalid unsigned integer");
    if (
        typeof value === "string" &&
        (!/^[0-9]+$/.test(value) ||
            value.length > ({ 8: 3, 32: 10, 64: 20, 128: 39 }[bits] ?? 0))
    )
        throw new Error("invalid decimal integer");
    const n = BigInt(value);
    if (n < 0n || n >= 1n << BigInt(bits))
        throw new Error("integer outside ABI range");
    return n;
}
function address(value: unknown): string {
    if (typeof value === "string") {
        const raw = value.startsWith("0x") ? value.slice(2) : value;
        if (!/^[0-9a-fA-F]{1,64}$/.test(raw))
            throw new Error("invalid address");
        const padded = raw.padStart(64, "0");
        return new AccountAddress(
            Uint8Array.from(padded.match(/../g)!, (v) => parseInt(v, 16)),
        ).toString();
    }
    if (Array.isArray(value) && value.length === 32)
        return new AccountAddress(
            Uint8Array.from(value, (v) => Number(uint(v, 8))),
        ).toString();
    throw new Error("invalid address");
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length !== keys.length ||
        keys.some((k) => !Object.prototype.hasOwnProperty.call(value, k))
    )
        throw new Error("Vault fields do not match schema v1");
    return value as Record<string, unknown>;
}
function readVaultInternalOffsetEvent(
    d: Deserializer,
): DexVaultInternalOffsetEvent {
    return {
        schemaVersion: d.deserializeU64(),
        vaultAccount: new AccountAddress(
            d.deserializeFixedBytes(32),
        ).toString(),
        subAddress: new AccountAddress(d.deserializeFixedBytes(32)).toString(),
        subaccountNumber: d.deserializeU32(),
        symbolId: d.deserializeU32(),
        status: d.deserializeU8(),
        quantums: d.deserializeU64(),
        beforeLongQuantums: d.deserializeU64(),
        beforeShortQuantums: d.deserializeU64(),
        afterLongQuantums: d.deserializeU64(),
        afterShortQuantums: d.deserializeU64(),
        price: d.deserializeU64(),
        offsetQuote: d.deserializeU128(),
        longReleasedCost: d.deserializeU128(),
        shortReleasedCost: d.deserializeU128(),
        longRealizedPnlBits: d.deserializeU128(),
        shortRealizedPnlBits: d.deserializeU128(),
        totalRealizedPnlBits: d.deserializeU128(),
        totalFee: d.deserializeU128(),
        blockHeight: d.deserializeU64(),
        timestampUs: d.deserializeU64(),
        actionSeq: d.deserializeU32(),
    };
}
function jsonVaultInternalOffsetEvent(
    value: unknown,
): DexVaultInternalOffsetEvent {
    const d = record(value, [
        "schema_version",
        "vault_account",
        "sub_address",
        "subaccount_number",
        "symbol_id",
        "status",
        "quantums",
        "before_long_quantums",
        "before_short_quantums",
        "after_long_quantums",
        "after_short_quantums",
        "price",
        "offset_quote",
        "long_released_cost",
        "short_released_cost",
        "long_realized_pnl_bits",
        "short_realized_pnl_bits",
        "total_realized_pnl_bits",
        "total_fee",
        "block_height",
        "timestamp_us",
        "action_seq",
    ]);
    return {
        schemaVersion: uint(d.schema_version, 64),
        vaultAccount: address(d.vault_account),
        subAddress: address(d.sub_address),
        subaccountNumber: Number(uint(d.subaccount_number, 32)),
        symbolId: Number(uint(d.symbol_id, 32)),
        status: Number(uint(d.status, 8)),
        quantums: uint(d.quantums, 64),
        beforeLongQuantums: uint(d.before_long_quantums, 64),
        beforeShortQuantums: uint(d.before_short_quantums, 64),
        afterLongQuantums: uint(d.after_long_quantums, 64),
        afterShortQuantums: uint(d.after_short_quantums, 64),
        price: uint(d.price, 64),
        offsetQuote: uint(d.offset_quote, 128),
        longReleasedCost: uint(d.long_released_cost, 128),
        shortReleasedCost: uint(d.short_released_cost, 128),
        longRealizedPnlBits: uint(d.long_realized_pnl_bits, 128),
        shortRealizedPnlBits: uint(d.short_realized_pnl_bits, 128),
        totalRealizedPnlBits: uint(d.total_realized_pnl_bits, 128),
        totalFee: uint(d.total_fee, 128),
        blockHeight: uint(d.block_height, 64),
        timestampUs: uint(d.timestamp_us, 64),
        actionSeq: Number(uint(d.action_seq, 32)),
    };
}

const BCS = {
    VaultInternalOffsetEvent: readVaultInternalOffsetEvent,
};
const JSON_READERS = {
    VaultInternalOffsetEvent: jsonVaultInternalOffsetEvent,
};

export function decodeVaultEvent(
    name: VaultEventType,
    input: unknown,
): VaultEvent {
    let data = input;
    if (typeof data === "string" && /^[\s]*["{]/.test(data))
        data = JSON.parse(data);
    let event: VaultEvent;
    if (data !== null && typeof data === "object" && !Array.isArray(data))
        event = JSON_READERS[name](data);
    else if (typeof data === "string") {
        const raw = data.startsWith("0x") ? data.slice(2) : data;
        if (!/^(?:[0-9a-fA-F]{2})+$/.test(raw))
            throw new Error("invalid BCS hex");
        const d = new Deserializer(
            Uint8Array.from(raw.match(/../g)!, (v) => parseInt(v, 16)),
        );
        event = BCS[name](d);
        if (d.remaining !== 0) throw new Error("trailing Vault bytes");
    } else throw new Error("unsupported transport");
    if (
        event.schemaVersion !== 1n ||
        event.status > 3
    )
        throw new Error("unsupported Vault schema/status");
    return event;
}

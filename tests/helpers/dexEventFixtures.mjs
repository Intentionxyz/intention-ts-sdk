// Shared BCS fixtures for DEX event decoder tests.
//
// These encode events in the on-chain BCS field order, so tests can feed
// them through the public `decodeDexEvent` / `decodeTransactionEvents` API.
//
// Not a test file (excluded from the `test/*.test.mjs` glob); imported by
// dexLiquidationEvents.test.mjs and e2eLiquidationEvents.test.mjs.

import { Serializer } from "../../dist/esm/index.mjs";

export const FILL_EVENT_TAG = "0x1::dex::FillEvent";
export const RISK_TRANSFER_TAG = "0x1::dex::LiquidationRiskTransferEvent";
export const INTERNAL_OFFSET_TAG = "0x1::dex::LiquidationInternalOffsetEvent";
export const LIQ_FAILED_TAG = "0x1::dex::LiquidationFailedEvent";

export const u64bits = (n) => BigInt.asUintN(64, BigInt(n));

function writeEmptyTriggerSnapshot(s) {
    s.serializeI128(0n);
    s.serializeU128(0n);
    s.serializeU32AsUleb128(0);
}

function emptyTriggerSnapshotJson() {
    return {
        trigger_nc_bits: "0",
        trigger_mmr: "0",
        trigger_marks: [],
    };
}

export function hex(bytes) {
    return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function writeSubaccountId(s, addrByte, number, subByte) {
    s.serializeFixedBytes(new Uint8Array(32).fill(addrByte));
    s.serializeU32(number);
    s.serializeFixedBytes(new Uint8Array(32).fill(subByte));
    s.serializeFixedBytes(new Uint8Array(16).fill(0));
}

// FillEvent in on-chain BCS field order. `remainingQuantums` appends the two
// current order-progress u64 fields. `trailing` controls the final
// `is_liquidation` byte: true/false append the bool; "omit" reproduces either
// historical layout or the current layout without the optional final bool.
export function encodeFillEvent({ trailing, symbolId = 7, remainingQuantums = null } = {}) {
    const s = new Serializer();
    s.serializeU32(symbolId); // symbol_id
    s.serializeU64(1001n); // fill_order_id
    s.serializeU64(2001n); // maker_order_id
    s.serializeU64(3001n); // taker_order_id
    s.serializeU64(4001n); // filled_quantums
    s.serializeU64(5001n); // match_subticks
    s.serializeU64(6001n); // block_height
    s.serializeU64(7001n); // fill_timestamp
    writeSubaccountId(s, 1, 10, 2); // maker_subaccount_id
    s.serializeU32(1); // maker_direction
    s.serializeU64(8001n); // maker_open_quantums
    s.serializeU64(9001n); // maker_close_quantums
    s.serializeI128(0n); // maker_opening_fee
    s.serializeI128(0n); // maker_closing_fee
    s.serializeU32(2); // maker_new_state
    s.serializeI128(0n); // maker_realized_pnl
    s.serializeBool(false); // maker_client_order_id = None
    writeSubaccountId(s, 4, 20, 5); // taker_subaccount_id
    s.serializeU32(2); // taker_direction
    s.serializeU64(10001n); // taker_open_quantums
    s.serializeU64(11001n); // taker_close_quantums
    s.serializeI128(0n); // taker_opening_fee
    s.serializeI128(0n); // taker_closing_fee
    s.serializeU32(1); // taker_new_state
    s.serializeI128(0n); // taker_realized_pnl
    s.serializeBool(false); // taker_client_order_id = None
    if (remainingQuantums !== null) {
        s.serializeU64(remainingQuantums[0]); // maker_remaining_quantums
        s.serializeU64(remainingQuantums[1]); // taker_remaining_quantums
    }
    if (trailing !== "omit") {
        s.serializeBool(trailing); // is_liquidation
    }
    return hex(s.toUint8Array());
}

// LiquidationRiskTransferEvent in on-chain BCS field order. Options reproduce
// the historical layout, the current pre-snapshot layout, and the latest one.
export function encodeRiskTransfer({
    includeResidualBound = true,
    includeTriggerSnapshot = true,
    txIndex = 4_294_967_295,
} = {}) {
    const s = new Serializer();
    s.serializeBytes(new Uint8Array([0x11, 0x22])); // flow_instance_id
    s.serializeBytes(new Uint8Array([0x33, 0x44])); // source_risk_unit_id
    s.serializeFixedBytes(new Uint8Array(32).fill(3)); // source_account
    s.serializeFixedBytes(new Uint8Array(32).fill(0x68)); // sub_address
    s.serializeU32(1); // subaccount_number
    s.serializeU32(7); // symbol_id
    s.serializeU8(1); // risk_unit_type
    s.serializeU8(0); // side
    s.serializeFixedBytes(new Uint8Array(32).fill(0xfa)); // takeover_account
    s.serializeU64(1_000_000n); // quantums
    s.serializeU64(99_999n); // price
    s.serializeU64(42n); // fee_bits
    s.serializeU64(u64bits(-1234)); // realized_pnl_bits
    s.serializeU64(u64bits(-7)); // source_residual_settled_bits
    if (includeResidualBound) {
        s.serializeU64(82n); // source_residual_bound_quantums
    }
    s.serializeU64(58_409n); // block_height
    s.serializeU64(1_700_000_000_000_000n); // timestamp_us
    s.serializeU32(7); // action_seq
    s.serializeU32(txIndex); // tx_index
    if (includeTriggerSnapshot) {
        writeEmptyTriggerSnapshot(s);
    }
    return hex(s.toUint8Array());
}

// LiquidationInternalOffsetEvent in on-chain BCS field order.
export function encodeInternalOffset({ includeTriggerSnapshot = true } = {}) {
    const s = new Serializer();
    s.serializeBytes(new Uint8Array([0xab, 0xcd])); // flow_instance_id
    s.serializeBytes(new Uint8Array([0xdc, 0xba])); // source_risk_unit_id
    s.serializeFixedBytes(new Uint8Array(32).fill(1)); // source_account
    s.serializeFixedBytes(new Uint8Array(32).fill(0x68)); // sub_address
    s.serializeU32(9); // subaccount_number
    s.serializeU32(7); // symbol_id
    s.serializeU8(0); // risk_unit_type
    s.serializeU64(18_446_744_073_709_551_615n); // quantums (u64::MAX)
    s.serializeU64(12_345n); // price
    s.serializeU64(200n); // total_fee_bits
    s.serializeU64(u64bits(-50)); // total_realized_pnl_bits
    s.serializeU64(150n); // long_realized_pnl_bits
    s.serializeU64(u64bits(-200)); // short_realized_pnl_bits
    s.serializeU64(58_409n); // block_height
    s.serializeU64(1_700_000_000_000_000n); // timestamp_us
    s.serializeU32(3); // action_seq
    s.serializeU32(4_294_967_295); // tx_index
    if (includeTriggerSnapshot) {
        writeEmptyTriggerSnapshot(s);
    }
    return hex(s.toUint8Array());
}

// LiquidationFailedEvent in on-chain BCS field order.
// symbol_id uses the account-level sentinel u32::MAX.
export function encodeFailed({ includeTriggerSnapshot = true } = {}) {
    const s = new Serializer();
    s.serializeBytes(new Uint8Array([0x33])); // flow_instance_id
    s.serializeBytes(new Uint8Array([0x44])); // source_risk_unit_id
    s.serializeFixedBytes(new Uint8Array(32).fill(5)); // source_account
    s.serializeFixedBytes(new Uint8Array(32).fill(0x68)); // sub_address
    s.serializeU32(2); // subaccount_number
    s.serializeU32(4_294_967_295); // symbol_id (account-level sentinel)
    s.serializeU8(0); // risk_unit_type
    s.serializeU8(3); // step
    s.serializeU8(255); // reason_code
    s.serializeU64(58_409n); // block_height
    s.serializeU64(1_700_000_000_000_000n); // timestamp_us
    s.serializeU32(1); // action_seq
    s.serializeU32(4_294_967_295); // tx_index
    if (includeTriggerSnapshot) {
        writeEmptyTriggerSnapshot(s);
    }
    return hex(s.toUint8Array());
}

// ---------------------------------------------------------------------------
// JSON transport fixtures - mirror the node REST shape for Move-ABI events:
// wide integers as strings, small integers as numbers, bytes/address as 0x hex.
// Values match the BCS fixtures above so tests can assert BCS/JSON parity.
// ---------------------------------------------------------------------------

const addr = (byte) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;

export function riskTransferJson() {
    return {
        flow_instance_id: "0x1122",
        source_risk_unit_id: "0x3344",
        source_account: addr(3),
        sub_address: addr(0x68),
        subaccount_number: 1,
        symbol_id: 7,
        risk_unit_type: 1,
        side: 0,
        takeover_account: addr(0xfa),
        quantums: "1000000",
        price: "99999",
        fee_bits: "42",
        realized_pnl_bits: u64bits(-1234).toString(),
        source_residual_settled_bits: u64bits(-7).toString(),
        source_residual_bound_quantums: "82",
        block_height: "58409",
        timestamp_us: "1700000000000000",
        action_seq: 7,
        tx_index: 4294967295,
        ...emptyTriggerSnapshotJson(),
    };
}

export function internalOffsetJson() {
    return {
        flow_instance_id: "0xabcd",
        source_risk_unit_id: "0xdcba",
        source_account: addr(1),
        sub_address: addr(0x68),
        subaccount_number: 9,
        symbol_id: 7,
        risk_unit_type: 0,
        quantums: "18446744073709551615",
        price: "12345",
        total_fee_bits: "200",
        total_realized_pnl_bits: u64bits(-50).toString(),
        long_realized_pnl_bits: "150",
        short_realized_pnl_bits: u64bits(-200).toString(),
        block_height: "58409",
        timestamp_us: "1700000000000000",
        action_seq: 3,
        tx_index: 4294967295,
        ...emptyTriggerSnapshotJson(),
    };
}

export function failedJson() {
    return {
        flow_instance_id: "0x33",
        source_risk_unit_id: "0x44",
        source_account: addr(5),
        sub_address: addr(0x68),
        subaccount_number: 2,
        symbol_id: 4294967295,
        risk_unit_type: 0,
        step: 3,
        reason_code: 255,
        block_height: "58409",
        timestamp_us: "1700000000000000",
        action_seq: 1,
        tx_index: 4294967295,
        ...emptyTriggerSnapshotJson(),
    };
}

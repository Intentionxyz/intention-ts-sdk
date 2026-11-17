import assert from "node:assert/strict";
import test from "node:test";

import {
    Serializer,
    decodeConditionOrderPlacedEvent,
    decodeDexEvent,
    decodeOrderAmendedEvent,
    decodeOrderPlacedEvent,
} from "../dist/esm/index.mjs";

function writeSubaccountId(s) {
    s.serializeFixedBytes(new Uint8Array(32).fill(1));
    s.serializeU32(2);
    s.serializeFixedBytes(new Uint8Array(32).fill(3));
    s.serializeFixedBytes(new Uint8Array(16));
}

function writeTrailingRate(s, rate) {
    if (rate === undefined) return;
    s.serializeBool(rate !== null);
    if (rate !== null) s.serializeU32(rate);
}

function encodeOrderPlacedEvent(rate) {
    const s = new Serializer();
    writeSubaccountId(s);
    s.serializeU32(1);
    s.serializeU32(2);
    s.serializeU32(1);
    s.serializeI64(10n);
    s.serializeU64(20n);
    s.serializeU32(2);
    s.serializeU32(4);
    s.serializeU32(0);
    s.serializeU32(0);
    s.serializeU64(30n);
    s.serializeU64(0n);
    s.serializeU64(40n);
    s.serializeU32(0);
    s.serializeBytes(new Uint8Array([4, 5]));
    s.serializeU64(10n);
    s.serializeU64(0n);
    s.serializeI128(6n);
    s.serializeI128(7n);
    s.serializeBool(false);
    s.serializeU32(0);
    s.serializeU32(0);
    s.serializeU32(0);
    s.serializeU32(0);
    s.serializeU32(50);
    s.serializeU64(0n);
    s.serializeU32(0);
    s.serializeI64(0n);
    s.serializeBool(false);
    s.serializeBool(false);
    s.serializeU64(60n);
    s.serializeU64(70n);
    writeTrailingRate(s, rate);
    return s.toUint8Array();
}

function encodeOrderAmendedEvent(rate) {
    const s = new Serializer();
    s.serializeU64(40n);
    s.serializeFixedBytes(new Uint8Array(32).fill(1));
    s.serializeFixedBytes(new Uint8Array(32).fill(2));
    s.serializeU32(1);
    s.serializeI64(10n);
    s.serializeI64(8n);
    s.serializeU64(10n);
    s.serializeU64(8n);
    s.serializeBool(true);
    s.serializeBool(false);
    s.serializeU64(60n);
    s.serializeU64(70n);
    writeTrailingRate(s, rate);
    return s.toUint8Array();
}

function hex(bytes) {
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

test("order events decode reservation fee rates and preserve old layouts", () => {
    const oldPlaced = encodeOrderPlacedEvent(undefined);
    const placed = encodeOrderPlacedEvent(450);
    const condition = encodeOrderPlacedEvent(null);
    const oldAmended = encodeOrderAmendedEvent(undefined);
    const amended = encodeOrderAmendedEvent(500);

    assert.equal(decodeOrderPlacedEvent(oldPlaced).reservationFeeRatePpm, null);
    assert.equal(decodeOrderPlacedEvent(placed).reservationFeeRatePpm, 450);
    assert.equal(
        decodeConditionOrderPlacedEvent(condition).reservationFeeRatePpm,
        null,
    );
    assert.equal(decodeOrderAmendedEvent(oldAmended).reservationFeeRatePpm, null);
    assert.equal(decodeOrderAmendedEvent(amended).reservationFeeRatePpm, 500);

    assert.equal(
        decodeDexEvent("0x1::dex::OrderPlacedEvent", hex(placed)).event
            .reservationFeeRatePpm,
        450,
    );
    assert.equal(
        decodeDexEvent("0x1::dex::ConditionOrderPlacedEvent", hex(condition)).event
            .reservationFeeRatePpm,
        null,
    );
    assert.equal(
        decodeDexEvent("0x1::dex::OrderAmendedEvent", hex(amended)).event
            .reservationFeeRatePpm,
        500,
    );
});

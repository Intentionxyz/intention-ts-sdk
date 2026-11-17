// JSON-transport decoding for liquidation events.
//
// The node REST returns Move-ABI events (the three liquidation events) with
// `data` as a JSON object, while native-executor events (FillEvent, ...) come
// as hex BCS. The decoder must handle both and produce identical output.

import assert from "node:assert/strict";
import test from "node:test";

import { AccountAddress, decodeDexEvent, decodeTransactionEvents } from "../dist/esm/index.mjs";
import {
    FILL_EVENT_TAG,
    RISK_TRANSFER_TAG,
    INTERNAL_OFFSET_TAG,
    LIQ_FAILED_TAG,
    encodeFillEvent,
    encodeRiskTransfer,
    encodeInternalOffset,
    encodeFailed,
    riskTransferJson,
    internalOffsetJson,
    failedJson,
} from "./helpers/dexEventFixtures.mjs";

test("JSON and BCS decode to identical LiquidationRiskTransferEvent", () => {
    const fromJson = decodeDexEvent(RISK_TRANSFER_TAG, riskTransferJson());
    const fromBcs = decodeDexEvent(RISK_TRANSFER_TAG, encodeRiskTransfer());

    assert.equal(fromJson.eventType, "LiquidationRiskTransferEvent");
    assert.deepStrictEqual(fromJson.event, fromBcs.event);
});

test("JSON and BCS decode to identical LiquidationInternalOffsetEvent", () => {
    const fromJson = decodeDexEvent(INTERNAL_OFFSET_TAG, internalOffsetJson());
    const fromBcs = decodeDexEvent(INTERNAL_OFFSET_TAG, encodeInternalOffset());

    assert.equal(fromJson.eventType, "LiquidationInternalOffsetEvent");
    assert.deepStrictEqual(fromJson.event, fromBcs.event);
});

test("JSON and BCS decode to identical LiquidationFailedEvent", () => {
    const fromJson = decodeDexEvent(LIQ_FAILED_TAG, failedJson());
    const fromBcs = decodeDexEvent(LIQ_FAILED_TAG, encodeFailed());

    assert.equal(fromJson.eventType, "LiquidationFailedEvent");
    assert.deepStrictEqual(fromJson.event, fromBcs.event);
});

test("decodeTransactionEvents handles mixed hex + JSON transport (real chain shape)", () => {
    // Mirrors the on-chain shape: hex FillEvent(s) + JSON liquidation events + noise.
    const events = [
        { type: FILL_EVENT_TAG, data: encodeFillEvent({ trailing: true, symbolId: 0 }) },
        { type: RISK_TRANSFER_TAG, data: riskTransferJson() },
        { type: "0x1::coin::Deposit", data: "0x00" },
        { type: INTERNAL_OFFSET_TAG, data: internalOffsetJson() },
        { type: LIQ_FAILED_TAG, data: failedJson() },
    ];

    const r = decodeTransactionEvents(events);

    assert.deepEqual(
        r.map((x) => x.eventType),
        [
            "FillEvent",
            "LiquidationRiskTransferEvent",
            "LiquidationInternalOffsetEvent",
            "LiquidationFailedEvent",
        ],
    );
    assert.deepEqual(r.map((x) => x.index), [0, 1, 3, 4]);
    assert.equal(r[0].event.isLiquidation, true);
    assert.equal(BigInt.asIntN(64, r[1].event.realizedPnlBits), -1234n);
    assert.equal(BigInt.asIntN(64, r[2].event.shortRealizedPnlBits), -200n);
    assert.equal(r[3].event.symbolId, 4_294_967_295);
});

test("JSON short-form address is left-padded to 32 bytes (parity with BCS)", () => {
    const j = riskTransferJson();
    j.source_account = "0xdff4da7eb394024f1db5a23c14adef96ddcd0eb0"; // 20-byte short form

    const decoded = decodeDexEvent(RISK_TRANSFER_TAG, j);

    const sig = Uint8Array.from(
        "dff4da7eb394024f1db5a23c14adef96ddcd0eb0".match(/../g).map((h) => parseInt(h, 16)),
    );
    const padded = new Uint8Array(32);
    padded.set(sig, 32 - sig.length);
    const expected = new AccountAddress(padded).toString();

    assert.equal(decoded.event.sourceAccount, expected);
});

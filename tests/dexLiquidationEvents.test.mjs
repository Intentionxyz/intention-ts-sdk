import assert from "node:assert/strict";
import test from "node:test";

import { decodeDexEvent, decodeTransactionEvents } from "../dist/esm/index.mjs";
import {
    FILL_EVENT_TAG,
    RISK_TRANSFER_TAG,
    INTERNAL_OFFSET_TAG,
    LIQ_FAILED_TAG,
    encodeFillEvent,
    encodeRiskTransfer,
    encodeInternalOffset,
    encodeFailed,
} from "./helpers/dexEventFixtures.mjs";

// ---------------------------------------------------------------------------
// FillEvent.is_liquidation
// ---------------------------------------------------------------------------

test("FillEvent decodes trailing is_liquidation = true", () => {
    const decoded = decodeDexEvent(FILL_EVENT_TAG, encodeFillEvent({ trailing: true }));

    assert.equal(decoded.eventType, "FillEvent");
    assert.equal(decoded.event.isLiquidation, true);
    // sanity: the rest of the struct still parses
    assert.equal(decoded.event.symbolId, 7);
    assert.equal(decoded.event.fillOrderId, 1001n);
    assert.equal(decoded.event.takerSubaccountId.number, 20);
});

test("FillEvent decodes trailing is_liquidation = false", () => {
    const decoded = decodeDexEvent(FILL_EVENT_TAG, encodeFillEvent({ trailing: false }));

    assert.equal(decoded.eventType, "FillEvent");
    assert.equal(decoded.event.isLiquidation, false);
});

test("FillEvent without trailing byte (pre-migration) defaults isLiquidation to false", () => {
    const decoded = decodeDexEvent(FILL_EVENT_TAG, encodeFillEvent({ trailing: "omit" }));

    assert.equal(decoded.eventType, "FillEvent");
    assert.equal(decoded.event.isLiquidation, false);
    // the rest of the struct is unaffected by the missing tail byte
    assert.equal(decoded.event.symbolId, 7);
    assert.equal(decoded.event.takerRealizedPnl, 0n);
});

// ---------------------------------------------------------------------------
// LiquidationRiskTransferEvent
// ---------------------------------------------------------------------------

test("decodes LiquidationRiskTransferEvent with signed bit-cast fields", () => {
    const decoded = decodeDexEvent(RISK_TRANSFER_TAG, encodeRiskTransfer());

    assert.equal(decoded.eventType, "LiquidationRiskTransferEvent");
    const e = decoded.event;
    assert.deepEqual(Array.from(e.flowInstanceId), [0x11, 0x22]);
    assert.deepEqual(Array.from(e.sourceRiskUnitId), [0x33, 0x44]);
    assert.equal(e.subaccountNumber, 1);
    assert.equal(e.symbolId, 7);
    assert.equal(e.riskUnitType, 1);
    assert.equal(e.side, 0);
    assert.equal(e.quantums, 1_000_000n);
    assert.equal(e.price, 99_999n);
    assert.equal(e.feeBits, 42n);
    // bits keep the raw u64; signed value via BigInt.asIntN(64, x)
    assert.equal(BigInt.asIntN(64, e.realizedPnlBits), -1234n);
    assert.equal(BigInt.asIntN(64, e.sourceResidualSettledBits), -7n);
    assert.equal(e.blockHeight, 58_409n);
    assert.equal(e.actionSeq, 7);
    assert.equal(e.txIndex, 4_294_967_295);
});

test("decodeTransactionEvents picks up a LiquidationRiskTransferEvent", () => {
    const results = decodeTransactionEvents([
        { type: RISK_TRANSFER_TAG, data: encodeRiskTransfer() },
        { type: "0x1::other::Thing", data: "0x00" },
    ]);

    assert.equal(results.length, 1);
    assert.equal(results[0].eventType, "LiquidationRiskTransferEvent");
    assert.equal(results[0].index, 0);
});

// ---------------------------------------------------------------------------
// LiquidationInternalOffsetEvent
// ---------------------------------------------------------------------------

test("decodes LiquidationInternalOffsetEvent with per-side signed pnl", () => {
    const decoded = decodeDexEvent(INTERNAL_OFFSET_TAG, encodeInternalOffset());

    assert.equal(decoded.eventType, "LiquidationInternalOffsetEvent");
    const e = decoded.event;
    assert.equal(e.subaccountNumber, 9);
    assert.equal(e.symbolId, 7);
    assert.equal(e.quantums, 18_446_744_073_709_551_615n);
    assert.equal(e.price, 12_345n);
    assert.equal(BigInt.asIntN(64, e.totalRealizedPnlBits), -50n);
    assert.equal(BigInt.asIntN(64, e.longRealizedPnlBits), 150n);
    assert.equal(BigInt.asIntN(64, e.shortRealizedPnlBits), -200n);
    assert.equal(e.txIndex, 4_294_967_295);
});

// ---------------------------------------------------------------------------
// LiquidationFailedEvent
// ---------------------------------------------------------------------------

test("decodes LiquidationFailedEvent with account-level sentinel symbol_id", () => {
    const decoded = decodeDexEvent(LIQ_FAILED_TAG, encodeFailed());

    assert.equal(decoded.eventType, "LiquidationFailedEvent");
    const e = decoded.event;
    assert.deepEqual(Array.from(e.flowInstanceId), [0x33]);
    assert.equal(e.subaccountNumber, 2);
    assert.equal(e.symbolId, 4_294_967_295); // sentinel preserved as-is
    assert.equal(e.step, 3);
    assert.equal(e.reasonCode, 255);
    assert.equal(e.blockHeight, 58_409n);
    assert.equal(e.actionSeq, 1);
    assert.equal(e.txIndex, 4_294_967_295);
});

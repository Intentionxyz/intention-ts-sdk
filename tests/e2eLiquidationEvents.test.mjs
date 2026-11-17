// e2e-style decode of a liquidation block's Transaction events.
//
// Mirrors the shape a consumer sees from the fullnode REST
// `/transactions/by_version/{v}` response: an ordered `events` array where
// each entry has a Move `type` string + hex-encoded BCS `data`. We push a
// realistic mix (normal fill, synthetic-liquidation fill, the three
// liquidation telemetry events, and non-DEX noise) through the public
// `decodeTransactionEvents` API and assert the full decoded projection.
//
// No live network - matches the mock/self-contained style of the go SDK's
// api/json_submit_e2e_test.go.

import assert from "node:assert/strict";
import test from "node:test";

import { decodeTransactionEvents, isDexEvent } from "../dist/esm/index.mjs";
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

// Long-form 0x1 address to prove suffix matching is address-agnostic.
const LONG_1 = `0x${"0".repeat(63)}1`;

function liquidationBlockEvents() {
    return [
        { type: "0x1::coin::Deposit", data: "0x00" }, // 0: non-DEX noise
        { type: FILL_EVENT_TAG, data: encodeFillEvent({ trailing: false, symbolId: 7 }) }, // 1: normal fill
        {
            type: `${LONG_1}::dex::FillEvent`,
            data: encodeFillEvent({ trailing: true, symbolId: 8 }),
        }, // 2: synthetic liquidation fill (long-form tag)
        { type: INTERNAL_OFFSET_TAG, data: encodeInternalOffset() }, // 3
        { type: RISK_TRANSFER_TAG, data: encodeRiskTransfer() }, // 4
        { type: LIQ_FAILED_TAG, data: encodeFailed() }, // 5
        { type: "0x1::account::CoinRegister", data: "0x01" }, // 6: non-DEX noise
    ];
}

test("e2e: decodeTransactionEvents projects a full liquidation block", () => {
    const results = decodeTransactionEvents(liquidationBlockEvents());

    // Only the 5 DEX events are returned, in original order, with source indices.
    assert.deepEqual(
        results.map((r) => r.eventType),
        [
            "FillEvent",
            "FillEvent",
            "LiquidationInternalOffsetEvent",
            "LiquidationRiskTransferEvent",
            "LiquidationFailedEvent",
        ],
    );
    assert.deepEqual(results.map((r) => r.index), [1, 2, 3, 4, 5]);

    // Fills carry the liquidation discriminator.
    assert.equal(results[0].event.isLiquidation, false);
    assert.equal(results[1].event.isLiquidation, true);
    assert.equal(results[1].event.symbolId, 8);

    // InternalOffset: per-side signed pnl via BigInt.asIntN(64, bits).
    const io = results[2].event;
    assert.equal(BigInt.asIntN(64, io.longRealizedPnlBits), 150n);
    assert.equal(BigInt.asIntN(64, io.shortRealizedPnlBits), -200n);

    // RiskTransfer: signed realized pnl + takeover semantics.
    const rt = results[3].event;
    assert.equal(BigInt.asIntN(64, rt.realizedPnlBits), -1234n);
    assert.equal(rt.side, 0);

    // Failed: account-level sentinel symbol_id preserved.
    assert.equal(results[4].event.symbolId, 4_294_967_295);
});

test("e2e: liquidation-relevant projection (flagged fills + dedicated events)", () => {
    const results = decodeTransactionEvents(liquidationBlockEvents());

    // What a downstream account-history consumer would keep as "liquidation":
    // synthetic-liquidation fills + the three telemetry events.
    const liquidationRelated = results.filter(
        (r) =>
            (r.eventType === "FillEvent" && r.event.isLiquidation) ||
            r.eventType === "LiquidationInternalOffsetEvent" ||
            r.eventType === "LiquidationRiskTransferEvent" ||
            r.eventType === "LiquidationFailedEvent",
    );
    assert.equal(liquidationRelated.length, 4);

    // All three liquidation telemetry flows share one flow_instance_id space:
    // each decodes to a byte array (not dropped/undefined).
    for (const r of liquidationRelated) {
        if (r.eventType !== "FillEvent") {
            assert.ok(r.event.flowInstanceId instanceof Uint8Array);
            assert.equal(r.event.txIndex, 4_294_967_295);
        }
    }
});

test("e2e: non-DEX events are not treated as DEX events", () => {
    assert.equal(isDexEvent("0x1::coin::Deposit"), false);
    assert.equal(isDexEvent("0x1::account::CoinRegister"), false);
    assert.equal(isDexEvent(LIQ_FAILED_TAG), true);
    assert.equal(isDexEvent(`${LONG_1}::dex::LiquidationRiskTransferEvent`), true);
});

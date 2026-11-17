import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as sdk from "../dist/esm/index.mjs";
import {
    FILL_EVENT_TAG,
    INTERNAL_OFFSET_TAG,
    LIQ_FAILED_TAG,
    RISK_TRANSFER_TAG,
    encodeFailed,
    encodeFillEvent,
    encodeInternalOffset,
    encodeRiskTransfer,
    riskTransferJson,
} from "./helpers/dexEventFixtures.mjs";

const ADL_EXECUTION_TAG = "0x1::dex::AdlExecutionEvent";
const ADL_V6_FIXTURE = JSON.parse(
    readFileSync(
        new URL("./fixtures/adl_execution_algorithm_v6.json", import.meta.url),
        "utf8",
    ),
);

function decodeAdlV6() {
    const decoded = sdk.decodeDexEvent(ADL_EXECUTION_TAG, ADL_V6_FIXTURE.event.data);
    assert.notEqual(decoded, null);
    assert.equal(decoded.eventType, "AdlExecutionEvent");
    return decoded.event;
}

function bytesFromHex(payload) {
    return Uint8Array.from(Buffer.from(payload.replace(/^0x/, ""), "hex"));
}

test("current FillEvent preserves both remaining quantities and liquidation flag", () => {
    const decoded = sdk.decodeDexEvent(
        FILL_EVENT_TAG,
        encodeFillEvent({ trailing: true, remainingQuantums: [5n, 7n] }),
    );

    assert.notEqual(decoded, null);
    assert.equal(decoded.event.makerRemainingQuantums, 5n);
    assert.equal(decoded.event.takerRemainingQuantums, 7n);
    assert.equal(decoded.event.isLiquidation, true);
});

test("current FillEvent without final bool defaults to non-liquidation", () => {
    const decoded = sdk.decodeDexEvent(
        FILL_EVENT_TAG,
        encodeFillEvent({ trailing: "omit", remainingQuantums: [5n, 7n] }),
    );

    assert.notEqual(decoded, null);
    assert.equal(decoded.event.makerRemainingQuantums, 5n);
    assert.equal(decoded.event.takerRemainingQuantums, 7n);
    assert.equal(decoded.event.isLiquidation, false);
});

test("FillEvent rejects an unknown tail instead of silently dropping bytes", () => {
    const malformed = encodeFillEvent({ trailing: "omit" }) + "0100";
    assert.equal(sdk.decodeDexEvent(FILL_EVENT_TAG, malformed), null);
});

test("direct public FillEvent decoder follows the same current contract", () => {
    const event = sdk.decodeFillEvent(
        bytesFromHex(
            encodeFillEvent({ trailing: true, remainingQuantums: [11n, 13n] }),
        ),
    );

    assert.equal(event.makerRemainingQuantums, 11n);
    assert.equal(event.takerRemainingQuantums, 13n);
    assert.equal(event.isLiquidation, true);
});

test("RiskTransfer accepts historical and current pre-snapshot layouts", () => {
    const historical = sdk.decodeDexEvent(
        RISK_TRANSFER_TAG,
        encodeRiskTransfer({ includeResidualBound: false, includeTriggerSnapshot: false }),
    );
    const current = sdk.decodeDexEvent(
        RISK_TRANSFER_TAG,
        encodeRiskTransfer({ includeTriggerSnapshot: false }),
    );

    assert.notEqual(historical, null);
    assert.equal(historical.event.sourceResidualBoundQuantums, 0n);
    assert.deepEqual(historical.event.triggerMarks, []);
    assert.notEqual(current, null);
    assert.equal(current.event.sourceResidualBoundQuantums, 82n);
    assert.deepEqual(current.event.triggerMarks, []);
});

test("trigger snapshots remain optional for InternalOffset and Failed", () => {
    const internal = sdk.decodeDexEvent(
        INTERNAL_OFFSET_TAG,
        encodeInternalOffset({ includeTriggerSnapshot: false }),
    );
    const failed = sdk.decodeDexEvent(
        LIQ_FAILED_TAG,
        encodeFailed({ includeTriggerSnapshot: false }),
    );

    assert.notEqual(internal, null);
    assert.equal(internal.event.triggerNc, 0n);
    assert.deepEqual(internal.event.triggerMarks, []);
    assert.notEqual(failed, null);
    assert.equal(failed.event.triggerMmr, 0n);
    assert.deepEqual(failed.event.triggerMarks, []);
});

test("RiskTransfer rejects non-system tx_index in BCS and JSON", () => {
    assert.equal(
        sdk.decodeDexEvent(RISK_TRANSFER_TAG, encodeRiskTransfer({ txIndex: 0 })),
        null,
    );
    const json = riskTransferJson();
    json.tx_index = 0;
    assert.equal(sdk.decodeDexEvent(RISK_TRANSFER_TAG, json), null);
});

test("public ADL chunk validator accepts a complete singleton", () => {
    assert.equal(typeof sdk.validateAdlExecutionEventChunks, "function");
    assert.equal(sdk.validateAdlExecutionEventChunks([decodeAdlV6()]), undefined);
});

test("public ADL validator accepts a complete contiguous chunk set", () => {
    const event = decodeAdlV6();
    const first = { ...event, totalChunks: 2n };
    const second = {
        ...event,
        chunkIndex: 1n,
        totalChunks: 2n,
        auditEntriesStartIndex: event.auditEntriesEndIndexExclusive,
        auditEntriesEndIndexExclusive: event.auditEntriesEndIndexExclusive,
        auditEntries: [],
    };

    assert.equal(sdk.validateAdlExecutionEventChunks([first, second]), undefined);
});

test("ADL audit entry indexes must match their declared range", () => {
    const event = decodeAdlV6();
    const malformed = {
        ...event,
        auditEntries: [
            { ...event.auditEntries[0], auditEntryIndex: event.auditEntriesStartIndex + 1n },
            ...event.auditEntries.slice(1),
        ],
    };

    assert.throws(() => sdk.validateAdlExecutionEventChunks([malformed]), /audit entry indexes/i);
});

test("Vault takeover is rejected before the final ADL chunk", () => {
    const event = decodeAdlV6();
    const malformed = {
        ...event,
        totalChunks: 2n,
        vaultTakeoverFill: { schemaVersion: event.schemaVersion },
    };

    assert.throws(() => sdk.validateAdlExecutionEventChunks([malformed]), /final chunk/i);
});

test("ADL validation requires the complete physical chunk set", () => {
    const event = decodeAdlV6();
    const incomplete = { ...event, totalChunks: 2n };

    assert.throws(() => sdk.validateAdlExecutionEventChunks([incomplete]), /complete.*chunk set/i);
});

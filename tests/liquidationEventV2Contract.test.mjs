import assert from "node:assert/strict";
import test from "node:test";

import { decodeDexEvent } from "../dist/esm/index.mjs";


const RISK_TRANSFER_TAG = "0x1::dex::LiquidationRiskTransferEvent";
const INTERNAL_OFFSET_TAG = "0x1::dex::LiquidationInternalOffsetEvent";
const FAILED_TAG = "0x1::dex::LiquidationFailedEvent";

// Canonical bytes from the chain's liquidation-events-v2.md contract.
const RISK_TRANSFER_PP2 = "2011111111111111111111111111111111111111111111111111111111111111112022222222222222222222222222222222222222222222222222222222222222223333333333333333333333333333333333333333333333333333333333333333444444444444444444444444444444444444444444444444444444444444444407000000650000000000fafafafafafafafafafafafafafafafafafafafafafafafafafafafafafafafa40e2010000000000cd81010000000000efffffffffffffff6cd9ffffffffffffc7ffffffffffffff58000000000000009210000000000000927a08000000000003000000ffffffffc7cfffffffffffffffffffffffffffff0000000000000000010000000000000002070000000100000000002000650000008c81010000000000";
const INTERNAL_OFFSET_PP3 = "2012121212121212121212121212121212121212121212121212121212121212122023232323232323232323232323232323232323232323232323232323232323233434343434343434343434343434343434343434343434343434343434343434454545454545454545454545454545454545454545454545454545454545454508000000ca000000007d640300000000000bae000000000000e1ffffffffffffff38feffffffffffff150300000000000023fbffffffffffff1f14000000000000a0de0b000000000004000000ffffffff32a9ffffffffffffffffffffffffffff0100000000000000010000000000000002070000000100000000002000ca0000000bae000000000000";
const FAILED_PP4 = "2013131313131313131313131313131313131313131313131313131313131313132024242424242424242424242424242424242424242424242424242424242424243535353535353535353535353535353535353535353535353535353535353535464646464646464646464646464646464646464646464646464646464646464609000000ffffffff0002031118000000000000583e0f000000000005000000ffffffffcb7dffffffffffffffffffffffffffff02000000000000000100000000000000020700000001000000000020002f010000d12f010000000000";
const RISK_TRANSFER_PP1 = "2011111111111111111111111111111111111111111111111111111111111111112022222222222222222222222222222222222222222222222222222222222222223333333333333333333333333333333333333333333333333333333333333333444444444444444444444444444444444444444444444444444444444444444407000000650000000100fafafafafafafafafafafafafafafafafafafafafafafafafafafafafafafafa40e2010000000000cd81010000000000efffffffffffffff6cd9ffffffffffffc7ffffffffffffff58000000000000009210000000000000927a08000000000003000000ffffffffc7cfffffffffffffffffffffffffffff3209010000000000000000000000000001650000008c81010000000000";


test("decodes all three Chain v17 goldens without precision loss", () => {
    const cases = [
        [RISK_TRANSFER_TAG, RISK_TRANSFER_PP2, "LiquidationRiskTransferEvent", -12345n, 18446744073709551616n, [[7, 9007199254740993n], [101, 98700n]]],
        [INTERNAL_OFFSET_TAG, INTERNAL_OFFSET_PP3, "LiquidationInternalOffsetEvent", -22222n, 18446744073709551617n, [[7, 9007199254740993n], [202, 44555n]]],
        [FAILED_TAG, FAILED_PP4, "LiquidationFailedEvent", -33333n, 18446744073709551618n, [[7, 9007199254740993n], [303, 77777n]]],
    ];

    for (const [tag, bytes, eventType, triggerNc, triggerMmr, triggerMarks] of cases) {
        const decoded = decodeDexEvent(tag, bytes);
        assert.ok(decoded);
        assert.equal(decoded.eventType, eventType);
        assert.equal(decoded.event.triggerNc, triggerNc);
        assert.equal(decoded.event.triggerMmr, triggerMmr);
        assert.deepEqual(
            decoded.event.triggerMarks.map((mark) => [mark.symbolId, mark.markSubticks]),
            triggerMarks,
        );
    }
});

test("preserves mark=0 and lossless JSON-facing decimal strings", () => {
    const zeroMark = `${RISK_TRANSFER_PP1.slice(0, -16)}0000000000000000`;
    const decoded = decodeDexEvent(RISK_TRANSFER_TAG, zeroMark);
    assert.ok(decoded);
    assert.deepEqual(decoded.event.triggerMarks, [{ symbolId: 101, markSubticks: 0n }]);

    const snapshot = JSON.parse(JSON.stringify({
        triggerNc: decoded.event.triggerNc.toString(),
        triggerMmr: decoded.event.triggerMmr.toString(),
        triggerMarks: decoded.event.triggerMarks.map((mark) => ({
            symbolId: mark.symbolId,
            markSubticks: mark.markSubticks.toString(),
        })),
    }));
    assert.equal(snapshot.triggerMarks[0].markSubticks, "0");
});

test("pre-snapshot RiskTransfer remains readable and there is no fourth event", () => {
    const preSnapshot = RISK_TRANSFER_PP2.slice(0, -(57 * 2));
    const decoded = decodeDexEvent(RISK_TRANSFER_TAG, preSnapshot);

    assert.notEqual(decoded, null);
    assert.equal(decoded.event.sourceResidualBoundQuantums, 88n);
    assert.equal(decoded.event.triggerNc, 0n);
    assert.equal(decoded.event.triggerMmr, 0n);
    assert.deepEqual(decoded.event.triggerMarks, []);
    assert.equal(decodeDexEvent(RISK_TRANSFER_TAG, preSnapshot + "00"), null);
    assert.equal(
        decodeDexEvent("0x1::dex::LiquidationTriggerAuditEvent", "00"),
        null,
    );
});

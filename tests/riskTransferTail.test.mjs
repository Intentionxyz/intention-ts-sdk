import assert from "node:assert/strict";
import test from "node:test";

import * as sdk from "../dist/esm/index.mjs";
import { RISK_TRANSFER_TAG, encodeRiskTransfer } from "./helpers/dexEventFixtures.mjs";

// Two RiskTransfer tails ship in the wild. Release/v2.3 appends the trigger
// snapshot straight after tx_index; current main inserts
// source_residual_bound_quantums before the block coordinates. The trigger_marks
// vector makes both tails variable length, so the tail's byte count cannot tell
// the layouts apart -- each one has to be parsed and checked for an exact fit.
const LAYOUTS = [
    [
        "release/v2.3 tail, no snapshot",
        { includeResidualBound: false, includeTriggerSnapshot: false },
        0n,
    ],
    ["current tail, no snapshot", { includeTriggerSnapshot: false }, 82n],
    ["current tail, with snapshot", {}, 82n],
    [
        "release/v2.3 tail, with snapshot",
        { includeResidualBound: false, includeTriggerSnapshot: true },
        0n,
    ],
];

test("RiskTransfer decodes every shipped trailing layout", () => {
    for (const [name, options, expectedBound] of LAYOUTS) {
        const decoded = sdk.decodeDexEvent(RISK_TRANSFER_TAG, encodeRiskTransfer(options));
        assert.notEqual(decoded, null, `${name} should decode`);
        assert.equal(decoded.event.sourceResidualBoundQuantums, expectedBound, name);
        assert.equal(decoded.event.blockHeight, 58_409n, name);
        assert.equal(decoded.event.actionSeq, 7, name);
    }
});

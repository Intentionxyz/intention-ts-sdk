import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeDexEvent } from "../dist/esm/index.mjs";

const ADL_EXECUTION_TAG = "0x1::dex::AdlExecutionEvent";
const ALGORITHM_VERSION_OFFSET = 2 + 6 * 8 + 2;
const V6_FIXTURE = JSON.parse(
    readFileSync(
        new URL("./fixtures/adl_execution_algorithm_v6.json", import.meta.url),
        "utf8",
    ),
);
const ADL_EXECUTION_V6 = V6_FIXTURE.event.data.slice(2);
const V9_FIXTURE = JSON.parse(
    readFileSync(
        new URL("./fixtures/adl_execution_algorithm_v9.json", import.meta.url),
        "utf8",
    ),
);
const ADL_EXECUTION_V9 = V9_FIXTURE.event.data.slice(2);
const V7_FIXTURE = JSON.parse(
    readFileSync(
        new URL("./fixtures/adl_execution_algorithm_v7.json", import.meta.url),
        "utf8",
    ),
);

function withAlgorithmVersion(payload, version) {
    const bytes = Buffer.from(payload, "hex");
    bytes.writeBigUInt64LE(version, ALGORITHM_VERSION_OFFSET);
    return bytes.toString("hex");
}

// Captured from a live chain. Keeping a real payload rather than a hand-built one is the
// point: the decoder is checked against what the chain emits, not against its own assumptions.
const ADL_EXECUTION_V5 =
    "05004d1b010000000000000000000000000000000000000000000100000000000000000000000000000001000000000000000500050000000000000001000000000000004d1b0100000000002f0000000201010103014d1b0100000000000000000000000000a3ce88037c85181be9b3e96402a0b839480a8968787b394e200f2a3a9ce010b600000000000000000000000000000000121982725f4961cd0a499f2b9c8ab1ee2c31193400000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000121982725f4961cd0a499f2b9c8ab1ee2c311934000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000121982725f4961cd0a499f2b9c8ab1ee2c3119340000000000000000000000000000000000000000000000000000000000000000000000002f0000000100a0cce70e00000000802003a700000000802003a7000000000101050000000000000000000101000000000000000000000000000000000000004733f19782267156782d4380900bba4258c5263d0000000000000000000000000000000000000000000000000000000000000000000000002f0000000200802003a70000000000000000000000000100a9cb52fd783802000000000000000080d3c51ad19c0b632b0000000000000001802003a70000000001fd92eb050000000000000000000000000000e5e1a11a852f25975868aea6ac3cca99bf0a5b22d4c96fe4e4e5902d8528926d7a25297a7ab9bf6b851ee0a90d1c850ea4f1a085b420635ff8a6303075c3797f59c268f1d881d35f9ef55145e52bdefe00361d316aaf44cf82b40fdf6a0c2840";

test("decodes a live AdlExecutionEvent without dropping its tail", () => {
    const decoded = decodeDexEvent(ADL_EXECUTION_TAG, ADL_EXECUTION_V5);
    assert.notEqual(decoded, null);
    assert.equal(decoded.eventType, "AdlExecutionEvent");

    const event = decoded.event;
    assert.equal(event.schemaVersion, 5);
    assert.equal(event.selectedPrefixHeader.schemaVersion, 5);
    assert.equal(event.selectedPrefixHeader.algorithmVersion, 5n);

    // The chunk carries exactly the audit range it declares.
    assert.equal(
        BigInt(event.auditEntries.length),
        event.auditEntriesEndIndexExclusive - event.auditEntriesStartIndex,
    );
    assert.ok(event.chunkIndex < event.totalChunks);

    // A Direct source without its locator would be a contract violation, not a decode success.
    assert.notEqual(event.selectedPrefixHeader.sourceLocator.directLiquidationLocator, null);
    assert.equal(
        event.selectedPrefixHeader.sourceLocator.directLiquidationLocator.flowInstanceId.length,
        32,
    );

    for (const hash of [
        event.inputSnapshotHash,
        event.selectedPrefixHash,
        event.executionFillsDigest,
    ]) {
        assert.equal(hash.length, 32);
    }
});

test("rejects an AdlExecutionEvent with trailing bytes", () => {
    assert.equal(decodeDexEvent(ADL_EXECUTION_TAG, ADL_EXECUTION_V5 + "00"), null);
});

test("rejects a truncated AdlExecutionEvent instead of returning a short object", () => {
    assert.equal(decodeDexEvent(ADL_EXECUTION_TAG, ADL_EXECUTION_V5.slice(0, -2)), null);
});

test("decodes the real schema-v5 algorithm-v6 AdlExecutionEvent", () => {
    const fixtureBytes = Buffer.from(ADL_EXECUTION_V6, "hex");
    assert.equal(fixtureBytes.length, V6_FIXTURE.byteLength);
    assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), V6_FIXTURE.sha256);

    const decoded = decodeDexEvent(ADL_EXECUTION_TAG, ADL_EXECUTION_V6);
    assert.notEqual(decoded, null);
    assert.equal(decoded.eventType, "AdlExecutionEvent");
    const event = decoded.event;
    assert.equal(event.schemaVersion, 5);
    assert.equal(event.selectedPrefixHeader.schemaVersion, 5);
    assert.equal(event.selectedPrefixHeader.algorithmVersion, 6n);
    assert.equal(
        BigInt(event.auditEntries.length),
        event.auditEntriesEndIndexExclusive - event.auditEntriesStartIndex,
    );
    for (const commitment of [
        event.inputSnapshotHash,
        event.selectedPrefixHash,
        event.executionFillsDigest,
    ]) {
        assert.equal(commitment.length, 32);
    }
});

test("decodes the real schema-v5 algorithm-v9 AdlExecutionEvent", () => {
    const fixtureBytes = Buffer.from(ADL_EXECUTION_V9, "hex");
    assert.equal(fixtureBytes.length, V9_FIXTURE.byteLength);
    assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), V9_FIXTURE.sha256);

    const decoded = decodeDexEvent(ADL_EXECUTION_TAG, ADL_EXECUTION_V9);
    assert.notEqual(decoded, null);
    assert.equal(decoded.eventType, "AdlExecutionEvent");
    const event = decoded.event;
    assert.equal(event.schemaVersion, 5);
    assert.equal(event.selectedPrefixHeader.algorithmVersion, 9n);
    assert.equal(
        BigInt(event.auditEntries.length),
        event.auditEntriesEndIndexExclusive - event.auditEntriesStartIndex,
    );
});

test("decodes the canonical schema-v5 algorithm-v7 round-half-up fixture", () => {
    const decoded = decodeDexEvent(ADL_EXECUTION_TAG, V7_FIXTURE.canonicalBcsHex);
    assert.notEqual(decoded, null);
    assert.equal(decoded.event.selectedPrefixHeader.algorithmVersion, 7n);
    assert.equal(decoded.event.selectedPrefixHeader.targetQuantums, 70_000_000n);
    assert.equal(decoded.event.selectedPrefixHeader.bankruptcySubticks, 243_254_123n);
    assert.equal(decoded.event.auditEntries[0].realizedPnlSigned.absValue, 115_552_211n);
    assert.equal(V7_FIXTURE.workedExample.sourceRealizedPnlQuantums, "-115552211");
    assert.equal(V7_FIXTURE.workedExample.candidateRealizedPnlQuantums, "115552211");
    assert.equal(Buffer.from(decoded.event.inputSnapshotHash).toString("hex"), V7_FIXTURE.inputSnapshotHashHex);
    assert.equal(Buffer.from(decoded.event.selectedPrefixHash).toString("hex"), V7_FIXTURE.selectedPrefixHashHex);
    assert.equal(Buffer.from(decoded.event.executionFillsDigest).toString("hex"), V7_FIXTURE.executionFillsDigestHex);
    assert.equal(decodeDexEvent(ADL_EXECUTION_TAG, V7_FIXTURE.canonicalBcsHex.slice(0, -2)), null);
    assert.equal(decodeDexEvent(ADL_EXECUTION_TAG, V7_FIXTURE.canonicalBcsHex + "00"), null);
});

test("rejects unknown algorithm v10 while retaining the v6 schema", () => {
    // v8 and v9 are supported now; v10 is the first revision above the ceiling.
    assert.equal(
        decodeDexEvent(ADL_EXECUTION_TAG, withAlgorithmVersion(ADL_EXECUTION_V6, 10n)),
        null,
    );
});

test("continues to decode an archived algorithm-v4 event", () => {
    const decoded = decodeDexEvent(
        ADL_EXECUTION_TAG,
        withAlgorithmVersion(ADL_EXECUTION_V5, 4n),
    );
    assert.notEqual(decoded, null);
    assert.equal(decoded.event.selectedPrefixHeader.algorithmVersion, 4n);
});

test("rejects truncated and trailing-byte variants of the v6 fixture", () => {
    assert.equal(decodeDexEvent(ADL_EXECUTION_TAG, ADL_EXECUTION_V6.slice(0, -2)), null);
    assert.equal(decodeDexEvent(ADL_EXECUTION_TAG, ADL_EXECUTION_V6 + "00"), null);
});

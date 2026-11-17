// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    decodeDexEvent,
    type DexAdminActionInvalidatedEvent,
    type DexAdminActionScheduledEvent,
    type DexAdminControlPolicyUpdatedEvent,
    type DexAdminControlInitializedEvent,
    type DexAdminControlCommitteeUpdatedEvent,
    type DexAdminControlRoleUpdatedEvent,
} from "../src/index";
import { Serializer } from "../src/bcs/serializer";

function toHex(serializer: Serializer): string {
    return `0x${Buffer.from(serializer.toUint8Array()).toString("hex")}`;
}

function putAddress(serializer: Serializer, byte: number): void {
    serializer.serializeFixedBytes(new Uint8Array(32).fill(byte));
}

function actionFixture(terminal: "scheduled" | "executed" | "cancelled" | "expired"): string {
    const serializer = new Serializer();
    serializer.serializeBytes(new Uint8Array(32).fill(0x11));
    serializer.serializeBytes(new Uint8Array(32).fill(0x22));
    serializer.serializeU8(3);
    serializer.serializeU64(4n);
    putAddress(serializer, 0xaa);
    serializer.serializeU64(5n);
    serializer.serializeU64(6n);
    serializer.serializeU64(7n);
    if (terminal !== "scheduled") serializer.serializeU64(8n);
    if (terminal !== "expired") serializer.serializeU8(terminal === "executed" ? 5 : 4);
    return toHex(serializer);
}

function invalidatedActionFixture(): string {
    const serializer = new Serializer();
    serializer.serializeBytes(new Uint8Array(32).fill(0x11));
    serializer.serializeBytes(new Uint8Array(32).fill(0x22));
    serializer.serializeU8(3);
    serializer.serializeU64(4n);
    serializer.serializeU64(5n);
    putAddress(serializer, 0xaa);
    serializer.serializeU64(6n);
    serializer.serializeU64(7n);
    serializer.serializeU64(8n);
    serializer.serializeU64(9n);
    return toHex(serializer);
}

test("decode every Admin Control audit-event family", () => {
    const initialized = new Serializer();
    for (const value of [1n, 86_400n, 604_800n]) initialized.serializeU64(value);
    initialized.serializeBytes(new Uint8Array(32).fill(0x11));

    const enabled = new Serializer();
    enabled.serializeU64(6n);

    const feeConfig = new Serializer();
    feeConfig.serializeBytes(new Uint8Array(32).fill(0x44));
    feeConfig.serializeBytes(new Uint8Array(32).fill(0x55));
    feeConfig.serializeU64(7n);

    const role = new Serializer();
    role.serializeBytes(new Uint8Array(32).fill(0x66));
    role.serializeU32AsUleb128(1);
    role.serializeU64(9n);
    role.serializeU32(2);
    role.serializeBytes(new Uint8Array(32).fill(0x77));

    const committeeGolden =
        "0x200101010101010101010101010101010101010101010101010101010101010101" +
        "070000000000000008000000000000002002020202020202020202020202020202" +
        "020202020202020202020202020202022003030303030303030303030303030303" +
        "030303030303030303030303030303030900000000000000";
    const policyGolden =
        "0x200101010101010101010101010101010101010101010101010101010101010101" +
        "010000000000000002000000000000008051010000000000c0a8000000000000" +
        "803a09000000000080f403000000000040420f0000000000";

    const fixtures = [
        ["AdminControlInitializedEvent", toHex(initialized)],
        ["AdminControlEnabledEvent", toHex(enabled)],
        ["AdminActionScheduledEvent", actionFixture("scheduled")],
        ["AdminActionExecutedEvent", actionFixture("executed")],
        ["AdminActionCancelledEvent", actionFixture("cancelled")],
        ["AdminActionExpiredEvent", actionFixture("expired")],
        ["AdminActionInvalidatedEvent", invalidatedActionFixture()],
        ["AdminControlRotatedEvent", committeeGolden],
        ["AdminControlPolicyUpdatedEvent", policyGolden],
        ["AdminControlListingSignerSetUpdatedEvent", committeeGolden],
        ["FeeSignerSetUpdatedEvent", committeeGolden],
        ["FeeConfigUpdatedEvent", toHex(feeConfig)],
        ["AdminControlRoleUpdatedEvent", toHex(role)],
    ] as const;

    for (const [eventType, data] of fixtures) {
        const decoded = decodeDexEvent(`0x1::dex::${eventType}`, data);
        assert.ok(decoded, eventType);
        assert.equal(decoded.eventType, eventType);
    }

    const scheduled = decodeDexEvent(
        "0x1::dex::AdminActionScheduledEvent",
        actionFixture("scheduled"),
    )?.event as DexAdminActionScheduledEvent;
    assert.equal(scheduled.signatureCount, 4);
    assert.equal(scheduled.proposer, `0x${"aa".repeat(32)}`);

    const invalidated = decodeDexEvent(
        "0x1::dex::AdminActionInvalidatedEvent",
        invalidatedActionFixture(),
    )?.event as DexAdminActionInvalidatedEvent;
    assert.equal(invalidated.signerEpoch, 4n);
    assert.equal(invalidated.currentSignerEpoch, 5n);
    assert.equal(invalidated.executor, `0x${"aa".repeat(32)}`);
    assert.equal(invalidated.invalidatedAtSecs, 9n);

    const initializedEvent = decodeDexEvent(
        "0x1::dex::AdminControlInitializedEvent",
        toHex(initialized),
    )?.event as DexAdminControlInitializedEvent;
    assert.equal(initializedEvent.adminSignerEpoch, 1n);
    assert.equal(initializedEvent.adminDelaySecs, 86_400n);
    assert.equal(initializedEvent.adminActionExpirySecs, 604_800n);
    assert.deepEqual(initializedEvent.committeeDigest, new Uint8Array(32).fill(0x11));

    const committee = decodeDexEvent(
        "0x1::dex::AdminControlRotatedEvent",
        committeeGolden,
    )?.event as DexAdminControlCommitteeUpdatedEvent;
    assert.deepEqual(committee.oldCommitteeDigest, new Uint8Array(32).fill(0x02));
    assert.deepEqual(committee.newCommitteeDigest, new Uint8Array(32).fill(0x03));
    assert.equal(committee.executedAtSecs, 9n);

    const policy = decodeDexEvent(
        "0x1::dex::AdminControlPolicyUpdatedEvent",
        policyGolden,
    )?.event as DexAdminControlPolicyUpdatedEvent;
    assert.equal(policy.oldPolicyEpoch, 1n);
    assert.equal(policy.newPolicyEpoch, 2n);
    assert.equal(policy.oldAdminDelaySecs, 86_400n);
    assert.equal(policy.newAdminDelaySecs, 43_200n);
    assert.equal(policy.newAdminActionExpirySecs, 259_200n);

    const roleEvent = decodeDexEvent("0x1::dex::AdminControlRoleUpdatedEvent", toHex(role))
        ?.event as DexAdminControlRoleUpdatedEvent;
    assert.equal(roleEvent.action, 1);
    assert.equal(roleEvent.roleMask, 9n);
    assert.equal(roleEvent.targetCount, 2);
    assert.deepEqual(roleEvent.targetsDigest, new Uint8Array(32).fill(0x77));
});

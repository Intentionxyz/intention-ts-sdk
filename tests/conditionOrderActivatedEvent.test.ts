// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    decodeConditionOrderActivatedEvent,
    decodeDexEvent,
    decodeTransactionEvents,
    isDexEvent,
} from "../src/index";
import { Serializer } from "../src/bcs/serializer";

const EVENT_TYPE = "0x1::dex::ConditionOrderActivatedEvent";

function fixture(): { bytes: Uint8Array; hex: string } {
    const serializer = new Serializer();
    serializer.serializeU64(43n);
    serializer.serializeU64(42n);
    serializer.serializeFixedBytes(new Uint8Array(32).fill(0x11));
    serializer.serializeFixedBytes(new Uint8Array(32).fill(0x22));
    serializer.serializeU32(7);
    serializer.serializeU32(2);
    serializer.serializeBool(false);
    serializer.serializeBool(true);
    serializer.serializeU32(1);
    serializer.serializeU64(123n);
    serializer.serializeU64(1_700_000_000_123_456n);
    const bytes = serializer.toUint8Array();
    return { bytes, hex: `0x${Buffer.from(bytes).toString("hex")}` };
}

test("decode attached condition activation from BCS", () => {
    const { bytes, hex } = fixture();
    const direct = decodeConditionOrderActivatedEvent(bytes);

    assert.equal(direct.orderId, 43n);
    assert.equal(direct.parentOrderId, 42n);
    assert.equal(direct.owner.toString(), `0x${"11".repeat(32)}`);
    assert.equal(direct.subAddress.toString(), `0x${"22".repeat(32)}`);
    assert.equal(direct.isActivated, true);
    assert.equal(direct.activationState, 1);

    assert.equal(isDexEvent(EVENT_TYPE), true);
    const decoded = decodeDexEvent(EVENT_TYPE, hex);
    assert.ok(decoded);
    assert.equal(decoded.eventType, "ConditionOrderActivatedEvent");
    assert.equal(decoded.event.orderId, 43n);
    assert.equal(decoded.event.parentOrderId, 42n);
    assert.equal(decoded.event.isActivated, true);
});

test("decode attached condition activation from structured REST data", () => {
    const data = {
        order_id: "43",
        parent_order_id: "42",
        owner: `0x${"11".repeat(32)}`,
        sub_address: "0x0",
        symbol_id: 7,
        condition_type: 2,
        client_order_id: { vec: [] },
        is_activated: true,
        activation_state: 1,
        block_height: "123",
        block_timestamp: "1700000000123456",
    };

    const decoded = decodeDexEvent(EVENT_TYPE, data);
    assert.ok(decoded);
    assert.equal(decoded.eventType, "ConditionOrderActivatedEvent");
    assert.deepEqual(decoded.event, {
        orderId: 43n,
        parentOrderId: 42n,
        owner: `0x${"11".repeat(32)}`,
        subAddress: `0x${"00".repeat(20)}`,
        symbolId: 7,
        conditionType: 2,
        clientOrderId: null,
        isActivated: true,
        activationState: 1,
        blockHeight: 123n,
        blockTimestamp: 1_700_000_000_123_456n,
    });
    assert.deepEqual(decodeTransactionEvents([{ type: EVENT_TYPE, data }]), [
        { index: 0, ...decoded },
    ]);
});

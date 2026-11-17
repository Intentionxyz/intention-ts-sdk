// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    decodeConditionOrderParentReboundEvent,
    decodeDexEvent,
    decodeTransactionEvents,
    isDexEvent,
} from "../src/index";
import { Serializer } from "../src/bcs/serializer";

const EVENT_TYPE = "0x1::dex::ConditionOrderParentReboundEvent";

function fixture(): { bytes: Uint8Array; hex: string } {
    const serializer = new Serializer();
    serializer.serializeU64(43n);
    serializer.serializeU64(42n);
    serializer.serializeU64(84n);
    serializer.serializeFixedBytes(new Uint8Array(32).fill(0x11));
    serializer.serializeFixedBytes(new Uint8Array(32).fill(0x22));
    serializer.serializeU32(7);
    serializer.serializeU32(2);
    serializer.serializeBool(false);
    serializer.serializeU64(123n);
    serializer.serializeU64(1_700_000_000_123_456n);
    const bytes = serializer.toUint8Array();
    return { bytes, hex: `0x${Buffer.from(bytes).toString("hex")}` };
}

test("decode linked condition parent rebound from BCS", () => {
    const { bytes, hex } = fixture();
    const direct = decodeConditionOrderParentReboundEvent(bytes);

    assert.equal(direct.orderId, 43n);
    assert.equal(direct.oldParentOrderId, 42n);
    assert.equal(direct.newParentOrderId, 84n);
    assert.equal(direct.owner.toString(), `0x${"11".repeat(32)}`);
    assert.equal(direct.subAddress.toString(), `0x${"22".repeat(32)}`);

    assert.equal(isDexEvent(EVENT_TYPE), true);
    const decoded = decodeDexEvent(EVENT_TYPE, hex);
    assert.ok(decoded);
    assert.equal(decoded.eventType, "ConditionOrderParentReboundEvent");
    assert.equal(decoded.event.orderId, 43n);
    assert.equal(decoded.event.oldParentOrderId, 42n);
    assert.equal(decoded.event.newParentOrderId, 84n);
});

test("decode linked condition parent rebound from structured REST data", () => {
    const data = {
        order_id: "43",
        old_parent_order_id: "42",
        new_parent_order_id: "84",
        owner: `0x${"11".repeat(32)}`,
        sub_address: "0x0",
        symbol_id: 7,
        condition_type: 2,
        client_order_id: { vec: [] },
        block_height: "123",
        block_timestamp: "1700000000123456",
    };

    const decoded = decodeDexEvent(EVENT_TYPE, data);
    assert.ok(decoded);
    assert.equal(decoded.eventType, "ConditionOrderParentReboundEvent");
    assert.deepEqual(decoded.event, {
        orderId: 43n,
        oldParentOrderId: 42n,
        newParentOrderId: 84n,
        owner: `0x${"11".repeat(32)}`,
        subAddress: `0x${"00".repeat(20)}`,
        symbolId: 7,
        conditionType: 2,
        clientOrderId: null,
        blockHeight: 123n,
        blockTimestamp: 1_700_000_000_123_456n,
    });
    assert.deepEqual(decodeTransactionEvents([{ type: EVENT_TYPE, data }]), [
        { index: 0, ...decoded },
    ]);
});

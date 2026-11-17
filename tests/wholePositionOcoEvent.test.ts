// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    decodeDexEvent,
    decodeTransactionEvents,
    decodeWholePositionOcoUpdatedEvent,
    isDexEvent,
} from "../src/index";
import { Serializer } from "../src/bcs/serializer";

const EVENT_TYPE = "0x1::dex::WholePositionOcoUpdatedEvent";

function fixture(): { bytes: Uint8Array; hex: string } {
    const serializer = new Serializer();
    serializer.serializeFixedBytes(new Uint8Array(32).fill(0x11));
    serializer.serializeFixedBytes(new Uint8Array(32).fill(0x22));
    serializer.serializeU32(7);
    serializer.serializeU32(1);
    serializer.serializeU64(0n);
    serializer.serializeBool(true);
    serializer.serializeU64(0n);
    serializer.serializeBool(false);
    serializer.serializeU32(2);
    serializer.serializeU64(11n);
    serializer.serializeU64(22n);
    const bytes = serializer.toUint8Array();
    const hex = `0x${Buffer.from(bytes).toString("hex")}`;
    return { bytes, hex };
}

test("decode whole-position OCO update preserves Some(0) and a missing leg", () => {
    const { bytes, hex } = fixture();
    const direct = decodeWholePositionOcoUpdatedEvent(bytes);

    assert.equal(direct.owner.toString(), `0x${"11".repeat(32)}`);
    assert.equal(direct.subAddress.toString(), `0x${"22".repeat(32)}`);
    assert.equal(direct.symbolId, 7);
    assert.equal(direct.positionSide, 1);
    assert.equal(direct.groupId, 0n);
    assert.equal(direct.takeProfitOrderId, 0n);
    assert.equal(direct.stopLossOrderId, null);
    assert.equal(direct.updateType, 2);
    assert.equal(direct.blockHeight, 11n);
    assert.equal(direct.blockTimestamp, 22n);

    assert.equal(isDexEvent(EVENT_TYPE), true);
    const decoded = decodeDexEvent(EVENT_TYPE, hex);
    assert.ok(decoded);
    assert.equal(decoded.eventType, "WholePositionOcoUpdatedEvent");
    assert.deepEqual(decoded.event, {
        owner: `0x${"11".repeat(32)}`,
        subAddress: `0x${"22".repeat(32)}`,
        symbolId: 7,
        positionSide: 1,
        groupId: 0n,
        takeProfitOrderId: 0n,
        stopLossOrderId: null,
        updateType: 2,
        blockHeight: 11n,
        blockTimestamp: 22n,
    });
});

test("decode whole-position OCO update from structured REST event data", () => {
    const owner = `0x${"11".repeat(32)}`;
    const subAddress = `0x${"00".repeat(20)}`;
    const data = {
        owner,
        sub_address: "0x0",
        symbol_id: 7,
        position_side: 2,
        group_id: "0",
        take_profit_order_id: { vec: ["0"] },
        stop_loss_order_id: { vec: [] },
        update_type: 1,
        block_height: "11",
        block_timestamp: "22",
    };

    const decoded = decodeDexEvent(EVENT_TYPE, data);
    assert.ok(decoded);
    assert.equal(decoded.eventType, "WholePositionOcoUpdatedEvent");
    assert.deepEqual(decoded.event, {
        owner,
        subAddress,
        symbolId: 7,
        positionSide: 2,
        groupId: 0n,
        takeProfitOrderId: 0n,
        stopLossOrderId: null,
        updateType: 1,
        blockHeight: 11n,
        blockTimestamp: 22n,
    });

    assert.deepEqual(decodeTransactionEvents([{ type: EVENT_TYPE, data }]), [
        { index: 0, ...decoded },
    ]);
});

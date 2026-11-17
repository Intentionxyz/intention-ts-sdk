import assert from "node:assert/strict";
import test from "node:test";

import { decodeDexEvent, decodeTransactionEvents, isDexEvent } from "../dist/esm/index.mjs";

const ORDER_PLACED_TAG = "0x1::dex::OrderPlacedEvent";
const FUNDING_RATE_TAG = "0x1::dex::FundingRateEvent";

test("structured OrderPlacedEvent is preserved instead of being dropped", () => {
    const data = {
        order_id: "42",
        state: 1,
        client_order_id: { vec: ["client-42"] },
    };

    const decoded = decodeDexEvent(ORDER_PLACED_TAG, data);

    assert.ok(decoded);
    assert.equal(decoded.eventType, "OrderPlacedEvent");
    assert.deepStrictEqual(decoded.event, data);
});

test("new structured DEX event types do not require a static SDK registry entry", () => {
    const data = {
        symbol_id: 7,
        funding_rate_ppm: 25,
        mark_price: "101000",
        block_height: "99",
        timestamp: "123456",
    };

    assert.equal(isDexEvent(FUNDING_RATE_TAG), true);
    assert.deepStrictEqual(decodeDexEvent(FUNDING_RATE_TAG, data), {
        eventType: "FundingRateEvent",
        event: data,
    });
});

test("batch decoding preserves structured DEX events and skips unrelated objects", () => {
    const events = [
        { type: "0x1::coin::DepositEvent", data: { amount: "1" } },
        { type: ORDER_PLACED_TAG, data: { order_id: "42" } },
        { type: FUNDING_RATE_TAG, data: { symbol_id: 7 } },
    ];

    const decoded = decodeTransactionEvents(events);

    assert.deepStrictEqual(
        decoded.map(({ index, eventType }) => ({ index, eventType })),
        [
            { index: 1, eventType: "OrderPlacedEvent" },
            { index: 2, eventType: "FundingRateEvent" },
        ],
    );
});

test("non-DEX structured events are not accepted by the DEX decoder", () => {
    assert.equal(decodeDexEvent("0x1::coin::DepositEvent", { amount: "1" }), null);
});

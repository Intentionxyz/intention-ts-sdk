// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Intent-to-wire tests for TP/SL and conditional order builders.
 *
 * These do not need a live chain. They exercise the user-facing API shape and
 * assert that it emits the chain-supported wire: DexOrders, DexPlaceOrders,
 * Grouping, and dedicated condition-replace payloads.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    AccountAddress,
    ConditionType,
    DexConditionReplaceOrder,
    DexOrders,
    DexOrdersVariant,
    DexPlaceOrders,
    DexReplaceOrder,
    Grouping,
    OrderBasicType,
    OrderIntents,
    OrderPositionMode,
    OrderType,
    Side,
    SimpleMarketResolver,
    SymbolType,
    TimeInForce,
    TriggerPriceType,
} from "../src/index";

const SUB_ADDRESS = AccountAddress.fromString("0x" + "11".repeat(32));
const DEFAULT_MARKET_SLIPPAGE_PPM = 100_000;
const CID = "0x" + "b".repeat(32);

function btcResolver(): SimpleMarketResolver {
    return new SimpleMarketResolver([
        {
            symbol: "BTC-USDC",
            clobPairId: 0,
            atomicResolution: -10,
            quantumConversionExponent: -9,
            stepBaseQuantums: 1_000_000,
            subticksPerTick: 100_000,
        },
    ]);
}

function builder(positionMode: OrderPositionMode): OrderIntents {
    return new OrderIntents({
        subAddress: SUB_ADDRESS,
        positionMode,
        resolver: btcResolver(),
    });
}

function placeGroups(orders: DexOrders): DexPlaceOrders[] {
    assert.equal(orders.variant, DexOrdersVariant.Place);
    return orders.orders as DexPlaceOrders[];
}

function conditionReplaceOrders(orders: DexOrders): DexConditionReplaceOrder[] {
    assert.equal(orders.variant, DexOrdersVariant.ReplaceCondition);
    return orders.orders as DexConditionReplaceOrder[];
}

function replaceOrders(orders: DexOrders): DexReplaceOrder[] {
    assert.equal(orders.variant, DexOrdersVariant.Replace);
    return orders.orders as DexReplaceOrder[];
}

test("intent wire: ordinary modify resolves number price and string size", () => {
    const [replace] = replaceOrders(
        builder(OrderPositionMode.Net).modifyOrder(
            { orderId: 42n },
            { symbol: "BTC-USDC", price: 58_000.5, size: "0.2" },
        ),
    );

    assert.equal(replace.target.kind, "OrderIdWithContext");
    if (replace.target.kind === "OrderIdWithContext") {
        assert.equal(replace.target.target_order_id, 42n);
        assert.equal(replace.target.symbol_id, 0);
        assert.equal(replace.target.symbol_type, SymbolType.Perpetual);
    }
    assert.equal(replace.quantums, 2_000_000_000n);
    assert.equal(replace.subticks, 5_800_000_000n);
});

test("intent wire: post-only limit maps to ALO", () => {
    const [group] = placeGroups(
        builder(OrderPositionMode.Net).placeOrder({
            symbol: "BTC-USDC",
            side: "BUY",
            type: OrderType.LIMIT,
            size: "0.1",
            price: 58_000,
            postOnly: true,
        }),
    );
    assert.equal(group.orders[0].time_in_force, TimeInForce.Alo);
});

test("intent wire: pure builder refuses unresolved full-close zero quantums", () => {
    assert.throws(
        () => builder(OrderPositionMode.Net).closePosition({ symbol: "BTC-USDC", size: "ALL" }),
        /Full close requires current position quantums/,
    );
});

test("intent wire: ordinary modify batch resolves each change and preserves omitted fields", () => {
    const replacements = replaceOrders(
        builder(OrderPositionMode.Net).modifyOrders([
            {
                ref: { orderId: 42n },
                changes: { symbol: "BTC-USDC", price: "58000" },
            },
            {
                ref: { clientOrderId: CID },
                changes: { symbol: "BTC-USDC", size: 0.2 },
            },
        ]),
    );

    assert.equal(replacements.length, 2);
    assert.equal(replacements[0].quantums, undefined);
    assert.equal(replacements[0].subticks, 5_800_000_000n);
    assert.equal(replacements[1].quantums, 2_000_000_000n);
    assert.equal(replacements[1].subticks, undefined);
});

test("intent wire: entry with TP/SL hides parent-child details behind NormalTPSL grouping", () => {
    const groups = placeGroups(
        builder(OrderPositionMode.Net).placeOrderWithTpSl(
            {
                symbol: "BTC-USDC",
                side: "BUY",
                type: OrderType.LIMIT,
                size: "0.5",
                price: "60000",
            },
            {
                tp: { type: OrderType.TAKE_PROFIT_MARKET, triggerPrice: "66000" },
                sl: {
                    type: OrderType.STOP_MARKET,
                    triggerPrice: "57000",
                    triggerPriceType: "LAST_PRICE",
                },
            },
        ),
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0].grouping, Grouping.NormalTPSL);
    assert.equal(groups[0].orders.length, 3);

    const [entry, tp, sl] = groups[0].orders;
    assert.equal(entry.condition_type, ConditionType.Unspecified);
    assert.equal(entry.order_basic_type, OrderBasicType.Limit);
    assert.equal(entry.side, Side.Buy);
    assert.equal(entry.reduce_only, false);
    assert.equal(entry.quantums, 5_000_000_000n);
    assert.equal(entry.subticks, 6_000_000_000n);
    assert.equal(entry.trigger_subticks, 0n);
    assert.equal(entry.target_order_id, 0n);

    assert.equal(tp.condition_type, ConditionType.TakeProfit);
    assert.equal(tp.order_basic_type, OrderBasicType.Market);
    assert.equal(tp.time_in_force, TimeInForce.Ioc);
    assert.equal(tp.side, Side.Sell);
    assert.equal(tp.reduce_only, true);
    assert.equal(tp.quantums, entry.quantums);
    assert.equal(tp.trigger_price_type, TriggerPriceType.MarkPrice);
    assert.equal(tp.trigger_subticks, 6_600_000_000n);
    assert.equal(tp.target_order_id, 0n);
    assert.equal(tp.slippage_tolerance_ppm, DEFAULT_MARKET_SLIPPAGE_PPM);

    assert.equal(sl.condition_type, ConditionType.StopLoss);
    assert.equal(sl.order_basic_type, OrderBasicType.Market);
    assert.equal(sl.time_in_force, TimeInForce.Ioc);
    assert.equal(sl.side, Side.Sell);
    assert.equal(sl.reduce_only, true);
    assert.equal(sl.quantums, entry.quantums);
    assert.equal(sl.trigger_price_type, TriggerPriceType.LastPrice);
    assert.equal(sl.trigger_subticks, 5_700_000_000n);
    assert.equal(sl.target_order_id, 0n);
    assert.equal(sl.slippage_tolerance_ppm, DEFAULT_MARKET_SLIPPAGE_PPM);
});

test("intent wire: position TP/SL close_position emits PositionTPSL zero-quantity legs", () => {
    const longGroups = placeGroups(
        builder(OrderPositionMode.Hedge).placePositionTpSl({
            symbol: "BTC-USDC",
            positionSide: "LONG",
            sizeMode: "close_position",
            tp: { type: OrderType.TAKE_PROFIT_MARKET, triggerPrice: "66000" },
            sl: { type: OrderType.STOP_MARKET, triggerPrice: "57000" },
        }),
    );

    assert.equal(longGroups.length, 1);
    assert.equal(longGroups[0].grouping, Grouping.PositionTPSL);
    assert.equal(longGroups[0].orders.length, 2);
    assert.deepEqual(
        longGroups[0].orders.map((o) => [o.side, o.quantums, o.reduce_only]),
        [
            [Side.Sell, 0n, true],
            [Side.Sell, 0n, true],
        ],
    );

    const shortGroups = placeGroups(
        builder(OrderPositionMode.Hedge).placePositionTpSl({
            symbol: "BTC-USDC",
            positionSide: "SHORT",
            sizeMode: "close_position",
            tp: { type: OrderType.TAKE_PROFIT_MARKET, triggerPrice: "54000" },
            sl: { type: OrderType.STOP_MARKET, triggerPrice: "62000" },
        }),
    );

    assert.equal(shortGroups.length, 1);
    assert.equal(shortGroups[0].grouping, Grouping.PositionTPSL);
    assert.equal(shortGroups[0].orders.length, 2);
    assert.deepEqual(
        shortGroups[0].orders.map((o) => [o.side, o.quantums, o.reduce_only]),
        [
            [Side.Buy, 0n, true],
            [Side.Buy, 0n, true],
        ],
    );
});

test("intent wire: Net fixed-size short-position TP/SL buys to close", () => {
    const groups = placeGroups(
        builder(OrderPositionMode.Net).placePositionTpSl({
            symbol: "BTC-USDC",
            positionSide: "SHORT",
            sizeMode: "fixed",
            configAmount: "0.1",
            tp: { type: OrderType.TAKE_PROFIT_MARKET, triggerPrice: "54000" },
        }),
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0].grouping, Grouping.PositionTPSL);
    assert.deepEqual(
        groups[0].orders.map((order) => [order.side, order.quantums, order.reduce_only]),
        [[Side.Buy, 1_000_000_000n, true]],
    );
});

test("intent wire: standalone conditional order uses existing NA wire", () => {
    const groups = placeGroups(
        builder(OrderPositionMode.Net).placeOrder({
            symbol: "BTC-USDC",
            side: "SELL",
            type: OrderType.STOP_LIMIT,
            size: "0.2",
            price: "57000",
            triggerPrice: "57500",
            triggerPriceType: "LAST_PRICE",
            reduceOnly: true,
        }),
    );

    assert.equal(groups.length, 1);
    assert.equal(groups[0].grouping, Grouping.NA);
    assert.equal(groups[0].orders.length, 1);

    const [stop] = groups[0].orders;
    assert.equal(stop.condition_type, ConditionType.StopLoss);
    assert.equal(stop.order_basic_type, OrderBasicType.Limit);
    assert.equal(stop.side, Side.Sell);
    assert.equal(stop.reduce_only, true);
    assert.equal(stop.quantums, 2_000_000_000n);
    assert.equal(stop.subticks, 5_700_000_000n);
    assert.equal(stop.trigger_subticks, 5_750_000_000n);
    assert.equal(stop.trigger_price_type, TriggerPriceType.LastPrice);
});

test("intent wire: condition modify emits dedicated STOP_MARKET full-spec wire", () => {
    const [replace] = conditionReplaceOrders(
        builder(OrderPositionMode.Net).modifyConditionOrder(
            { orderId: 42n },
            {
                symbol: "BTC-USDC",
                type: OrderType.STOP_MARKET,
                sizeMode: "fixed",
                currentSizeMode: "fixed",
                size: "0.2",
                triggerPrice: "57500",
                triggerPriceType: "LAST_PRICE",
                newClientOrderId: CID,
            },
        ),
    );

    assert.equal(replace.target.kind, "OrderIdWithContext");
    if (replace.target.kind === "OrderIdWithContext") {
        assert.equal(replace.target.target_order_id, 42n);
        assert.equal(replace.target.symbol_id, 0);
        assert.equal(replace.target.symbol_type, SymbolType.Perpetual);
    }
    assert.equal(replace.quantums, 2_000_000_000n);
    assert.equal(replace.subticks, 0n);
    assert.equal(replace.trigger_subticks, 5_750_000_000n);
    assert.equal(replace.order_basic_type, OrderBasicType.Market);
    assert.equal(replace.condition_type, ConditionType.StopLoss);
    assert.equal(replace.trigger_price_type, TriggerPriceType.LastPrice);
    assert.equal(replace.new_client_order_id, CID);
});

test("intent wire: condition modify supports whole-position TAKE_PROFIT_LIMIT", () => {
    const [replace] = conditionReplaceOrders(
        builder(OrderPositionMode.Hedge).modifyConditionOrder(
            { clientOrderId: CID },
            {
                symbol: "BTC-USDC",
                type: OrderType.TAKE_PROFIT_LIMIT,
                sizeMode: "close_position",
                currentSizeMode: "close_position",
                price: "66000",
                triggerPrice: "65000",
                triggerPriceType: "MARK_PRICE",
            },
        ),
    );

    assert.equal(replace.target.kind, "ClientOrderId");
    if (replace.target.kind === "ClientOrderId") {
        assert.equal(replace.target.client_order_id, CID);
    }
    assert.equal(replace.quantums, 0n);
    assert.equal(replace.subticks, 6_600_000_000n);
    assert.equal(replace.trigger_subticks, 6_500_000_000n);
    assert.equal(replace.order_basic_type, OrderBasicType.Limit);
    assert.equal(replace.condition_type, ConditionType.TakeProfit);
    assert.equal(replace.trigger_price_type, TriggerPriceType.MarkPrice);
});

test("intent wire: condition modify rejects invalid full-spec shapes", () => {
    const intents = builder(OrderPositionMode.Net);
    assert.throws(() =>
        intents.modifyConditionOrder(
            { orderId: 1n },
            {
                symbol: "BTC-USDC",
                type: OrderType.STOP_MARKET,
                sizeMode: "close_position",
                size: "0.1",
                triggerPrice: "57500",
            },
        ),
    );
    assert.throws(() =>
        intents.modifyConditionOrder(
            { orderId: 1n },
            {
                symbol: "BTC-USDC",
                type: OrderType.STOP_MARKET,
                sizeMode: "fixed",
                currentSizeMode: "close_position",
                size: "0.1",
                triggerPrice: "57500",
            },
        ),
    );
    assert.throws(() =>
        intents.modifyConditionOrder(
            { orderId: 1n },
            {
                symbol: "BTC-USDC",
                type: OrderType.STOP_MARKET,
                size: "0.1",
                price: "57000",
                triggerPrice: "57500",
            },
        ),
    );
    assert.throws(() =>
        intents.modifyConditionOrder(
            { orderId: 1n },
            {
                symbol: "BTC-USDC",
                type: OrderType.STOP_LIMIT,
                size: "0.1",
                triggerPrice: "57500",
            },
        ),
    );
    assert.throws(() =>
        intents.modifyConditionOrder(
            { orderId: 1n },
            {
                symbol: "BTC-USDC",
                type: OrderType.TAKE_PROFIT_MARKET,
                triggerPrice: "66000",
            },
        ),
    );
});

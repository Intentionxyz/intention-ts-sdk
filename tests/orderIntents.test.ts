// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Unit tests for the pure order-intent helpers + market resolver.
 * Run: `pnpm test` (tsx + node:test). No chain / network needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    encodeLegSelection,
    floorScaleToBigInt,
    orderTypeToBasics,
    resolveTimeInForce,
    cancelTargetFromRef,
    replaceTargetFromRef,
    SimpleMarketResolver,
    OrderType,
    OrderPositionMode,
    Side,
    OrderBasicType,
    ConditionType,
    TimeInForce,
} from "../src/index";

const CID = "0x" + "a".repeat(32); // valid client_order_id (0x + 32 lowercase hex)

// --- encodeLegSelection -----------------------------------------------------

test("encodeLegSelection: Net uses side-by-direction, positive quantums", () => {
    assert.deepEqual(
        encodeLegSelection({ positionMode: OrderPositionMode.Net, intentSide: "BUY", reduceOnly: false, absQuantums: 100n }),
        { side: Side.Buy, quantums: 100n },
    );
    assert.deepEqual(
        encodeLegSelection({ positionMode: OrderPositionMode.Net, intentSide: "SELL", reduceOnly: false, absQuantums: 100n }),
        { side: Side.Sell, quantums: 100n },
    );
});

test("encodeLegSelection: Hedge open = Buy, sign by positionSide", () => {
    assert.deepEqual(
        encodeLegSelection({ positionMode: OrderPositionMode.Hedge, intentSide: "BUY", reduceOnly: false, positionSide: "LONG", absQuantums: 100n }),
        { side: Side.Buy, quantums: 100n },
    );
    assert.deepEqual(
        encodeLegSelection({ positionMode: OrderPositionMode.Hedge, intentSide: "BUY", reduceOnly: false, positionSide: "SHORT", absQuantums: 100n }),
        { side: Side.Buy, quantums: -100n },
    );
});

test("encodeLegSelection: Hedge close = Sell, sign by positionSide", () => {
    assert.deepEqual(
        encodeLegSelection({ positionMode: OrderPositionMode.Hedge, intentSide: "SELL", reduceOnly: true, positionSide: "LONG", absQuantums: 100n }),
        { side: Side.Sell, quantums: 100n },
    );
    assert.deepEqual(
        encodeLegSelection({ positionMode: OrderPositionMode.Hedge, intentSide: "SELL", reduceOnly: true, positionSide: "SHORT", absQuantums: 100n }),
        { side: Side.Sell, quantums: -100n },
    );
});

test("encodeLegSelection: Hedge zero-quantity close uses side to select the leg", () => {
    assert.deepEqual(
        encodeLegSelection({ positionMode: OrderPositionMode.Hedge, intentSide: "SELL", reduceOnly: true, positionSide: "LONG", absQuantums: 0n }),
        { side: Side.Sell, quantums: 0n },
    );
    assert.deepEqual(
        encodeLegSelection({ positionMode: OrderPositionMode.Hedge, intentSide: "BUY", reduceOnly: true, positionSide: "SHORT", absQuantums: 0n }),
        { side: Side.Buy, quantums: 0n },
    );
});

test("encodeLegSelection: Hedge without positionSide throws", () => {
    assert.throws(() =>
        encodeLegSelection({ positionMode: OrderPositionMode.Hedge, intentSide: "SELL", reduceOnly: true, absQuantums: 100n }),
    );
});

test("encodeLegSelection: normalizes negative absQuantums", () => {
    assert.deepEqual(
        encodeLegSelection({ positionMode: OrderPositionMode.Net, intentSide: "BUY", reduceOnly: false, absQuantums: -100n }),
        { side: Side.Buy, quantums: 100n },
    );
});

// --- floorScaleToBigInt -----------------------------------------------------

test("floorScaleToBigInt: BTC size/price examples", () => {
    assert.equal(floorScaleToBigInt("0.5", 10), 5_000_000_000n);
    assert.equal(floorScaleToBigInt("97000", 5), 9_700_000_000n);
    assert.equal(floorScaleToBigInt("0.0001", 10), 1_000_000n);
    assert.equal(floorScaleToBigInt(0.5, 10), 5_000_000_000n); // number input
});

test("floorScaleToBigInt: floors on positive shift and negative exp", () => {
    assert.equal(floorScaleToBigInt("123.456", 0), 123n);
    assert.equal(floorScaleToBigInt("123.456", -1), 12n); // floor(12.3456)
    assert.equal(floorScaleToBigInt("999", -2), 9n);
});

test("floorScaleToBigInt: expands exponential number notation", () => {
    assert.equal(floorScaleToBigInt(1e-7, 10), 1000n); // 1e-7 * 1e10 = 1000
});

test("floorScaleToBigInt: negative values keep sign", () => {
    assert.equal(floorScaleToBigInt("-0.5", 10), -5_000_000_000n);
});

test("floorScaleToBigInt: invalid input throws", () => {
    assert.throws(() => floorScaleToBigInt("abc", 1));
    assert.throws(() => floorScaleToBigInt(".", 1));
});

// --- orderTypeToBasics ------------------------------------------------------

test("orderTypeToBasics: full mapping", () => {
    assert.deepEqual(orderTypeToBasics(OrderType.LIMIT), { basicType: OrderBasicType.Limit, conditionType: ConditionType.Unspecified });
    assert.deepEqual(orderTypeToBasics(OrderType.MARKET), { basicType: OrderBasicType.Market, conditionType: ConditionType.Unspecified });
    assert.deepEqual(orderTypeToBasics(OrderType.STOP_LIMIT), { basicType: OrderBasicType.Limit, conditionType: ConditionType.StopLoss });
    assert.deepEqual(orderTypeToBasics(OrderType.STOP_MARKET), { basicType: OrderBasicType.Market, conditionType: ConditionType.StopLoss });
    assert.deepEqual(orderTypeToBasics(OrderType.TAKE_PROFIT_LIMIT), { basicType: OrderBasicType.Limit, conditionType: ConditionType.TakeProfit });
    assert.deepEqual(orderTypeToBasics(OrderType.TAKE_PROFIT_MARKET), { basicType: OrderBasicType.Market, conditionType: ConditionType.TakeProfit });
});

// --- resolveTimeInForce -----------------------------------------------------

test("resolveTimeInForce: default by type + explicit override", () => {
    assert.equal(resolveTimeInForce(OrderType.MARKET), TimeInForce.Ioc);
    assert.equal(resolveTimeInForce(OrderType.LIMIT), TimeInForce.Gtc);
    assert.equal(resolveTimeInForce(OrderType.STOP_MARKET), TimeInForce.Ioc);
    assert.equal(resolveTimeInForce(OrderType.LIMIT, TimeInForce.Ioc), TimeInForce.Ioc);
    assert.equal(resolveTimeInForce(OrderType.MARKET, TimeInForce.Gtc), TimeInForce.Gtc);
    assert.equal(resolveTimeInForce(OrderType.LIMIT, TimeInForce.Alo), TimeInForce.Alo);
    assert.throws(
        () => resolveTimeInForce(OrderType.LIMIT, TimeInForce.Ioc, true),
        /postOnly cannot be combined with IOC/,
    );
    assert.throws(
        () => resolveTimeInForce(OrderType.MARKET, TimeInForce.Alo),
        /postOnly\/ALO is only supported for limit orders/,
    );
});

test("resolveTimeInForce: rejects strings and unsupported wire enum values", () => {
    assert.throws(
        () => resolveTimeInForce(OrderType.LIMIT, "GTC" as never),
        /timeInForce must use the TimeInForce enum/,
    );
    assert.throws(
        () => resolveTimeInForce(OrderType.LIMIT, TimeInForce.Fok as never),
        /high-level order API supports only GTC, IOC, and ALO/,
    );
});

// --- cancel / replace target from ref --------------------------------------

test("cancelTargetFromRef / replaceTargetFromRef: OrderId vs ClientOrderId", () => {
    assert.deepEqual(cancelTargetFromRef({ orderId: 5n }), { kind: "OrderId", target_order_id: 5n });
    assert.deepEqual(cancelTargetFromRef({ clientOrderId: CID }), { kind: "ClientOrderId", client_order_id: CID });
    assert.deepEqual(replaceTargetFromRef({ orderId: 7n }), { kind: "OrderId", target_order_id: 7n });
    assert.deepEqual(replaceTargetFromRef({ clientOrderId: CID }), { kind: "ClientOrderId", client_order_id: CID });
});

// --- SimpleMarketResolver ---------------------------------------------------

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

test("SimpleMarketResolver: symbolId / toQuantums / toSubticks (BTC)", () => {
    const r = btcResolver();
    assert.equal(r.symbolId("BTC-USDC"), 0);
    assert.equal(r.toQuantums("BTC-USDC", 0.5), 5_000_000_000n);
    assert.equal(r.toSubticks("BTC-USDC", 97000), 9_700_000_000n);
});

test("SimpleMarketResolver: aligns down to step / tick", () => {
    const r = btcResolver();
    // 0.00015 -> floor(0.00015*1e10)=1_500_000 -> align step 1e6 -> 1_000_000
    assert.equal(r.toQuantums("BTC-USDC", 0.00015), 1_000_000n);
    // 97000.5 -> floor(97000.5*1e5)=9_700_050_000 -> align tick 1e5 -> 9_700_000_000
    assert.equal(r.toSubticks("BTC-USDC", 97000.5), 9_700_000_000n);
});

test("SimpleMarketResolver: unknown symbol throws", () => {
    const r = btcResolver();
    assert.throws(() => r.symbolId("ETH-USDC"));
});

test("SimpleMarketResolver: WS applyWsMessage snapshot + partial merge", () => {
    const r = new SimpleMarketResolver();
    // snapshot (full) adds a market
    const touched = r.applyWsMessage({
        markets: {
            "ETH-USDC": {
                clobPairId: 1,
                atomicResolution: -9,
                quantumConversionExponent: -9,
                stepBaseQuantums: 1_000_000,
                subticksPerTick: 100_000,
            },
        },
    });
    assert.equal(touched, 1);
    assert.ok(r.has("ETH-USDC"));
    assert.equal(r.symbolId("ETH-USDC"), 1);

    // incomplete partial for a NEW symbol is skipped (returns false)
    assert.equal(r.upsertPartial("NEW-USDC", { atomicResolution: -6 }), false);
    assert.equal(r.has("NEW-USDC"), false);

    // partial merge on existing market updates only provided fields
    assert.equal(r.upsertPartial("ETH-USDC", { subticksPerTick: 50_000 }), true);
    // subtick align now uses 50_000
    const s = r.toSubticks("ETH-USDC", 3200);
    assert.equal(s % 50_000n, 0n);
});

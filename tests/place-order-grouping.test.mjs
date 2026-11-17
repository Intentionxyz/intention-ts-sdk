import assert from "node:assert/strict";
import test from "node:test";

import {
    Account,
    AccountAddress,
    ChainId,
    ConditionType,
    CreatedBy,
    DexOrderlessTx,
    DexOrderlessTxVariant,
    DexOrders,
    DexOrdersVariant,
    DexPlaceOrder,
    DexPlaceOrders,
    DexTx,
    generateSigningMessageForTransaction,
    generateSubmitTransactionRequest,
    Grouping,
    OrderBasicType,
    OrderPositionMode,
    RawTransaction,
    Secp256k1PrivateKey,
    Side,
    SimpleTransaction,
    SymbolType,
    TimeInForce,
    TransactionPayloadDexOrderless,
    TriggerPriceType,
} from "../dist/esm/index.mjs";

const NONCE = 123456789n;
const CLIENT_ORDER_ID_A = clientOrderId("a");
const CLIENT_ORDER_ID_B = clientOrderId("b");
const DEV1_MASTER_ADDRESS = AccountAddress.fromString(
    "0x968e82E36a929a1df5673B29762608CB9494BEDd",
);
const DEV1_SUBACCOUNT_ADDRESS = AccountAddress.fromString(
    "0x68a91c3512d02f4de33ddf81825d336ec9e596ef",
);

function clientOrderId(hexDigit) {
    return `0x${hexDigit.repeat(32)}`;
}

function hex(bytes) {
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function buildAccount() {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    return Account.fromPrivateKey({ privateKey });
}

function buildPlaceOrder(overrides = {}) {
    return new DexPlaceOrder(
        overrides.subAddress ?? AccountAddress.ZERO,
        overrides.symbolId ?? 7,
        SymbolType.Perpetual,
        overrides.side ?? Side.Buy,
        overrides.quantums ?? 1000n,
        overrides.subticks ?? 2000n,
        overrides.triggerSubticks ?? 0n,
        overrides.orderBasicType ?? OrderBasicType.Limit,
        overrides.timeInForce ?? TimeInForce.Gtc,
        overrides.conditionType ?? ConditionType.Unspecified,
        overrides.triggerPriceType ?? TriggerPriceType.LastPrice,
        0n,
        overrides.reduceOnly ?? false,
        overrides.positionMode ?? OrderPositionMode.Net,
        100_000,
        overrides.clientOrderId,
    );
}

function buildNormalTpslGroup(symbolId, clientOrderIdDigits) {
    return new DexPlaceOrders(
        [
            buildPlaceOrder({
                symbolId,
                clientOrderId: clientOrderId(clientOrderIdDigits[0]),
            }),
            buildPlaceOrder({
                symbolId,
                side: Side.Sell,
                quantums: 1000n,
                subticks: 0n,
                triggerSubticks: 2500n,
                orderBasicType: OrderBasicType.Market,
                conditionType: ConditionType.TakeProfit,
                triggerPriceType: TriggerPriceType.MarkPrice,
                clientOrderId: clientOrderId(clientOrderIdDigits[1]),
            }),
            buildPlaceOrder({
                symbolId,
                side: Side.Sell,
                quantums: 1000n,
                subticks: 0n,
                triggerSubticks: 1500n,
                orderBasicType: OrderBasicType.Market,
                conditionType: ConditionType.StopLoss,
                triggerPriceType: TriggerPriceType.MarkPrice,
                clientOrderId: clientOrderId(clientOrderIdDigits[2]),
            }),
        ],
        Grouping.NormalTPSL,
    );
}

function buildTransaction(groups) {
    return buildTransactionWithOptions(groups);
}

function buildTransactionWithOptions(groups, options = {}) {
    const account = buildAccount();
    const dexTx = new DexTx(
        NONCE,
        new DexOrders(DexOrdersVariant.Place, groups),
        CreatedBy.User,
        options.onBehalfOf,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.Dex, dexTx),
    );
    const rawTransaction = RawTransaction.createOrderless(
        account.accountAddress,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { transaction, senderAuthenticator };
}

function buildCloseAllHedgeLeg(side, quantums, subticks) {
    return buildPlaceOrder({
        subAddress: DEV1_SUBACCOUNT_ADDRESS,
        symbolId: 0,
        side,
        quantums,
        subticks,
        orderBasicType: OrderBasicType.Market,
        timeInForce: TimeInForce.Ioc,
        reduceOnly: true,
        positionMode: OrderPositionMode.Hedge,
    });
}

test("flat legacy parse may merge adjacent same-grouping orders, so nested groups are required for signature parity", () => {
    const firstOrder = buildPlaceOrder({ clientOrderId: CLIENT_ORDER_ID_A });
    const secondOrder = buildPlaceOrder({
        symbolId: 8,
        side: Side.Sell,
        quantums: 3000n,
        subticks: 4000n,
        clientOrderId: CLIENT_ORDER_ID_B,
    });
    const adjacent = buildTransaction([
        new DexPlaceOrders([firstOrder], Grouping.NA),
        new DexPlaceOrders([secondOrder], Grouping.NA),
    ]);
    const merged = buildTransaction([
        new DexPlaceOrders([firstOrder, secondOrder], Grouping.NA),
    ]);

    assert.notEqual(
        hex(adjacent.transaction.rawTransaction.bcsToBytes()),
        hex(merged.transaction.rawTransaction.bcsToBytes()),
    );
    assert.notEqual(
        hex(generateSigningMessageForTransaction(adjacent.transaction)),
        hex(generateSigningMessageForTransaction(merged.transaction)),
    );

    const adjacentRequest = generateSubmitTransactionRequest(adjacent);
    const mergedRequest = generateSubmitTransactionRequest(merged);

    assert.deepEqual(adjacentRequest.payload.orders, mergedRequest.payload.orders);
    assert.equal(adjacentRequest.payload.order_groups.length, 2);
    assert.equal(mergedRequest.payload.order_groups.length, 1);
    assert.deepEqual(
        adjacentRequest.payload.order_groups.flatMap((group) => group.orders),
        adjacentRequest.payload.orders,
    );
});

test("nested groups retain adjacent NormalTPSL parent and TP/SL batches", () => {
    const { transaction, senderAuthenticator } = buildTransaction([
        buildNormalTpslGroup(7, ["c", "d", "e"]),
        buildNormalTpslGroup(8, ["f", "1", "2"]),
    ]);

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.payload.operation, "place");
    assert.equal(request.payload.orders.length, 6);
    assert.equal(request.payload.order_groups.length, 2);
    assert.deepEqual(
        request.payload.order_groups.map((group) => group.grouping),
        [Grouping.NormalTPSL, Grouping.NormalTPSL],
    );
    assert.deepEqual(
        request.payload.order_groups.map((group) => group.orders.length),
        [3, 3],
    );
    assert.deepEqual(
        request.payload.order_groups.flatMap((group) => group.orders),
        request.payload.orders,
    );
    assert.deepEqual(
        request.payload.order_groups.map((group) =>
            group.orders.map((order) => order.condition_type),
        ),
        [
            [
                ConditionType.Unspecified,
                ConditionType.TakeProfit,
                ConditionType.StopLoss,
            ],
            [
                ConditionType.Unspecified,
                ConditionType.TakeProfit,
                ConditionType.StopLoss,
            ],
        ],
    );
});

test("PositionTPSL whole-position orders require reduce_only", () => {
    const tp = buildPlaceOrder({
        side: Side.Sell,
        quantums: 0n,
        subticks: 0n,
        triggerSubticks: 2500n,
        orderBasicType: OrderBasicType.Market,
        conditionType: ConditionType.TakeProfit,
        triggerPriceType: TriggerPriceType.MarkPrice,
        reduceOnly: false,
    });

    assert.throws(
        () => new DexPlaceOrders([tp], Grouping.PositionTPSL),
        /whole-position orders require reduce_only = true/,
    );
});

test("PositionTPSL Closeall sides imply reduce_only", () => {
    for (const side of [Side.CloseallLong, Side.CloseallShort]) {
        const tp = buildPlaceOrder({
            side,
            quantums: 0n,
            subticks: 0n,
            triggerSubticks: 2500n,
            orderBasicType: OrderBasicType.Market,
            conditionType: ConditionType.TakeProfit,
            triggerPriceType: TriggerPriceType.MarkPrice,
            reduceOnly: false,
        });

        assert.doesNotThrow(() => new DexPlaceOrders([tp], Grouping.PositionTPSL));
    }
});

test("close-all hedge JSON submit uses CloseallLong and CloseallShort enum sides instead of Sell plus negative quantums", () => {
    const { transaction, senderAuthenticator } = buildTransactionWithOptions(
        [
            new DexPlaceOrders(
                [buildCloseAllHedgeLeg(Side.CloseallLong, 7000000000n, 5879900000n)],
                Grouping.NA,
            ),
            new DexPlaceOrders(
                [buildCloseAllHedgeLeg(Side.CloseallShort, 5000000000n, 5880000000n)],
                Grouping.NA,
            ),
        ],
        { onBehalfOf: DEV1_MASTER_ADDRESS },
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.payload.operation, "place");
    assert.equal(request.payload.nonce, NONCE.toString());
    assert.equal(request.replay_protection_nonce, NONCE.toString());
    assert.equal(request.payload.on_behalf_of, DEV1_MASTER_ADDRESS.toString());
    assert.equal(request.payload.orders.length, 2);
    assert.equal(request.payload.order_groups.length, 2);

    const [closeLong, closeShort] = request.payload.orders;
    assert.deepEqual(
        request.payload.order_groups.map((group) => group.orders),
        [[closeLong], [closeShort]],
    );
    assert.deepEqual(
        request.payload.orders.map((order) => order.side),
        [Side.CloseallLong, Side.CloseallShort],
    );
    assert.deepEqual(
        request.payload.orders.map((order) => order.quantums),
        ["7000000000", "5000000000"],
    );

    for (const order of request.payload.orders) {
        assert.equal(order.sub_address, DEV1_SUBACCOUNT_ADDRESS.toStringLong());
        assert.equal(order.symbol_id, 0);
        assert.equal(order.symbol_type, SymbolType.Perpetual);
        assert.equal(order.order_basic_type, OrderBasicType.Market);
        assert.equal(order.time_in_force, TimeInForce.Ioc);
        assert.equal(order.reduce_only, true);
        assert.equal(order.position_mode, OrderPositionMode.Hedge);
        assert.equal(order.slippage_tolerance_ppm, 100_000);
        assert.equal(order.grouping, Grouping.NA);
        assert.notEqual(order.side, Side.Sell);
        assert.equal(order.quantums.startsWith("-"), false);
    }
});

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    Account,
    AccountAddress,
    DexOrders,
    DexPlaceOrders,
    Intention,
    IntentionApiType,
    IntentionConfig,
    OrderClient,
    OrderPreflightError,
    OrderRejectedError,
    OrderPositionMode,
    OrderType,
    RelayerOrderPreflightDataProvider,
    SimpleMarketResolver,
    TransactionExecutionError,
    type OrderPreflightDataProvider,
    type OrderPreflightMarketSnapshot,
    type DexAccountProvider,
    type OpenOrdersProvider,
    type DecodedDexEvent,
    orderOutcomesFromDecodedEvents,
} from "../src/index";
import type { PendingTransactionResponse, TransactionResponse } from "../src/api/client";

const HASH = "0x" + "ab".repeat(32);

function pending(): PendingTransactionResponse {
    return {
        hash: HASH,
        sender: "0x1",
        sequence_number: "0",
        max_gas_amount: "5000",
        gas_unit_price: "2000",
        expiration_timestamp_secs: "9999999999",
        payload: {},
        signature: {},
    } as PendingTransactionResponse;
}

function committed(overrides: Partial<TransactionResponse> = {}): TransactionResponse {
    return {
        type: "user_transaction",
        version: "1",
        hash: HASH,
        state_change_hash: "0x1",
        event_root_hash: "0x1",
        state_checkpoint_hash: "0x1",
        gas_used: "10",
        success: true,
        vm_status: "Executed successfully",
        accumulator_root_hash: "0x1",
        changes: [],
        sender: "0x1",
        sequence_number: "0",
        max_gas_amount: "5000",
        gas_unit_price: "2000",
        expiration_timestamp_secs: "9999999999",
        payload: {},
        signature: {},
        events: [],
        timestamp: "1",
        ...overrides,
    };
}

class FakeIntention {
    submitCalls = 0;
    submitted: unknown[] = [];
    waitCalls: unknown[] = [];
    response = committed();

    async submitDexOrders(args?: unknown): Promise<PendingTransactionResponse> {
        this.submitCalls += 1;
        this.submitted.push(args);
        return pending();
    }

    async waitForTransaction(args: unknown): Promise<TransactionResponse> {
        this.waitCalls.push(args);
        return this.response;
    }
}

const OWNER = AccountAddress.fromString("0x" + "22".repeat(32));

function actionClient(args: {
    intention: FakeIntention;
    accountProvider?: DexAccountProvider;
    openOrdersProvider?: OpenOrdersProvider;
}): OrderClient {
    return new OrderClient({
        intention: args.intention as unknown as Intention,
        signer: { accountAddress: OWNER } as Account,
        subAddress: AccountAddress.fromString("0x" + "11".repeat(32)),
        positionMode: OrderPositionMode.Net,
        resolver: new SimpleMarketResolver([
            {
                symbol: "BTC-USDC",
                clobPairId: 0,
                atomicResolution: -10,
                quantumConversionExponent: -9,
                stepBaseQuantums: 1_000_000,
                subticksPerTick: 100_000,
            },
        ]),
        preflightProvider: null,
        accountProvider: args.accountProvider ?? null,
        openOrdersProvider: args.openOrdersProvider ?? null,
    });
}

function orderClient(
    intention: FakeIntention,
    preflightProvider?: OrderPreflightDataProvider | null,
): OrderClient {
    return new OrderClient({
        intention: intention as unknown as Intention,
        signer: {} as Account,
        subAddress: AccountAddress.fromString("0x" + "11".repeat(32)),
        positionMode: OrderPositionMode.Net,
        resolver: new SimpleMarketResolver([
            {
                symbol: "BTC-USDC",
                clobPairId: 0,
                atomicResolution: -10,
                quantumConversionExponent: -9,
                stepBaseQuantums: 1_000_000,
                subticksPerTick: 100_000,
            },
        ]),
        preflightProvider,
    });
}

const ORDER = {
    symbol: "BTC-USDC",
    side: "BUY" as const,
    type: OrderType.LIMIT,
    size: "0.1",
    price: "60000",
};

test("OrderClient.placeOrder submits, waits with options, and returns confirmed result", async () => {
    const intention = new FakeIntention();
    const result = await orderClient(intention).placeOrder(ORDER, {
        timeoutSecs: 12,
        pollIntervalMs: 250,
    });

    assert.equal(intention.submitCalls, 1);
    assert.deepEqual(intention.waitCalls, [
        {
            transactionHash: HASH,
            options: { timeoutSecs: 12, checkIntervalMs: 250, checkSuccess: true },
        },
    ]);
    assert.equal(result.hash, HASH);
    assert.equal(result.transaction.success, true);
    assert.equal(result.allAccepted, null);
    assert.deepEqual(result.orders, []);
});

test("OrderClient.submitOrder is the no-wait fast path", async () => {
    const intention = new FakeIntention();
    const result = await orderClient(intention).submitOrder(ORDER);

    assert.equal(result.hash, HASH);
    assert.equal(intention.submitCalls, 1);
    assert.equal(intention.waitCalls.length, 0);
});

test("OrderClient full close loads exact position quantums and waits", async () => {
    const intention = new FakeIntention();
    const accountProvider: DexAccountProvider = {
        async getAccounts() {
            return [
                {
                    subAddress: "0x" + "11".repeat(32),
                    perps: [{ perpetualId: 0, longQuantums: 987654321n, shortQuantums: 0n }],
                },
            ] as never;
        },
    };
    const result = await actionClient({ intention, accountProvider }).closePosition({
        symbol: "BTC-USDC",
        size: "ALL",
    });

    const submitted = intention.submitted[0] as { dexOrders: DexOrders };
    const group = submitted.dexOrders.orders[0] as DexPlaceOrders;
    assert.equal(group.orders[0].quantums, 987654321n);
    assert.equal(result.hash, HASH);
    assert.equal(intention.waitCalls.length, 1);
});

test("OrderClient true cancelAll discovers open orders and submit fast path does not wait", async () => {
    const intention = new FakeIntention();
    const openOrdersProvider: OpenOrdersProvider = {
        async getOpenOrders(args) {
            assert.equal(args.symbolId, 0);
            return [
                {
                    orderId: 77n,
                    clientOrderId: "client-77",
                    symbolId: 0,
                    symbol: "BTC-USDC",
                    subAddress: String(args.subAddress),
                },
            ];
        },
    };
    const pendingResult = await actionClient({ intention, openOrdersProvider }).submitCancelAllForSymbol(
        "BTC-USDC",
    );

    assert.equal(pendingResult.hash, HASH);
    assert.equal(intention.submitCalls, 1);
    assert.equal(intention.waitCalls.length, 0);
});

test("cancel and modify high-level methods wait for confirmation", async () => {
    const intention = new FakeIntention();
    const client = actionClient({ intention });
    await client.cancelOrder({ orderId: 7n });
    await client.modifyOrder(
        { clientOrderId: "0x" + "1".repeat(32) },
        { symbol: "BTC-USDC", price: "61000" },
    );

    assert.equal(intention.submitCalls, 2);
    assert.equal(intention.waitCalls.length, 2);
});

class FakePreflightProvider implements OrderPreflightDataProvider {
    calls = 0;

    constructor(private readonly snapshot: Omit<OrderPreflightMarketSnapshot, "symbol">) {}

    async getMarketSnapshot(args: { symbol: string }): Promise<OrderPreflightMarketSnapshot> {
        this.calls += 1;
        return { symbol: args.symbol, ...this.snapshot };
    }
}

test("OrderClient.placeOrder blocks an invalid trigger before submitting", async () => {
    const intention = new FakeIntention();
    const provider = new FakePreflightProvider({
        markPrice: "60000",
        fetchedAtMs: Date.now(),
    });
    const client = orderClient(intention, provider);

    await assert.rejects(
        client.placeOrder({
            symbol: "BTC-USDC",
            side: "SELL",
            type: OrderType.STOP_MARKET,
            size: "0.1",
            triggerPrice: "61000",
        }),
        (error: unknown) => {
            assert.ok(error instanceof OrderPreflightError);
            assert.equal(error.issues[0].code, "STOP_ORDER_PRICE_MUST_BELOW_REF");
            return true;
        },
    );
    assert.equal(provider.calls, 1);
    assert.equal(intention.submitCalls, 0);
});

test("OrderClient market-entry bracket validates TP/SL against orderbook mid", async () => {
    const intention = new FakeIntention();
    const provider = new FakePreflightProvider({
        bestBidPrice: "59900",
        bestAskPrice: "60100",
        fetchedAtMs: Date.now(),
    });
    const client = orderClient(intention, provider);

    const issues = await client.preflightOrderWithTpSl(
        {
            symbol: "BTC-USDC",
            side: "BUY",
            type: OrderType.MARKET,
            size: "0.1",
        },
        { tp: { type: OrderType.TAKE_PROFIT_MARKET, triggerPrice: "59000" } },
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "TAKE_PROFIT_PRICE_MUST_ABOVE_REF");
    assert.equal(issues[0].referencePriceType, "MID_PRICE");
    assert.equal(intention.submitCalls, 0);
});

test("OrderClient limit-entry bracket performs local TP/SL validation", async () => {
    const intention = new FakeIntention();
    await assert.rejects(
        orderClient(intention, null).placeOrderWithTpSl(
            {
                symbol: "BTC-USDC",
                side: "BUY",
                type: OrderType.LIMIT,
                size: "0.1",
                price: "60000",
            },
            { tp: { type: OrderType.TAKE_PROFIT_MARKET, triggerPrice: "59000" } },
        ),
        (error: unknown) => {
            assert.ok(error instanceof OrderPreflightError);
            assert.equal(error.issues[0].code, "TAKE_PROFIT_PRICE_MUST_ABOVE_REF");
            assert.equal(error.issues[0].referencePriceType, "LIMIT_PRICE");
            return true;
        },
    );
    assert.equal(intention.submitCalls, 0);
});

test("OrderClient limit-entry bracket ignores child trigger type and needs no snapshot", async () => {
    const intention = new FakeIntention();
    const provider = new FakePreflightProvider({
        markPrice: "50000",
        lastPrice: "48000",
        midPrice: "52000",
        fetchedAtMs: Date.now(),
    });
    const client = orderClient(intention, provider);

    for (const side of ["BUY", "SELL"] as const) {
        for (const triggerPriceType of ["MARK_PRICE", "LAST_PRICE"] as const) {
            const issues = await client.preflightOrderWithTpSl(
                {
                    symbol: "BTC-USDC",
                    side,
                    type: OrderType.LIMIT,
                    size: "0.1",
                    price: "52000",
                },
                {
                    tp: {
                        type: OrderType.TAKE_PROFIT_MARKET,
                        triggerPrice: "52000",
                        triggerPriceType,
                    },
                    sl: {
                        type: OrderType.STOP_MARKET,
                        triggerPrice: "52000",
                        triggerPriceType,
                    },
                },
            );
            assert.deepEqual(issues, []);
        }
    }

    assert.equal(provider.calls, 0);
});

test("OrderClient market-entry bracket uses BBO mid regardless of child trigger type", async () => {
    const intention = new FakeIntention();
    const provider = new FakePreflightProvider({
        markPrice: "50000",
        lastPrice: "48000",
        bestBidPrice: "51000",
        bestAskPrice: "53000",
        fetchedAtMs: Date.now(),
    });
    const client = orderClient(intention, provider);

    for (const side of ["BUY", "SELL"] as const) {
        for (const triggerPriceType of ["MARK_PRICE", "LAST_PRICE"] as const) {
            const issues = await client.preflightOrderWithTpSl(
                {
                    symbol: "BTC-USDC",
                    side,
                    type: OrderType.MARKET,
                    size: "0.1",
                },
                {
                    tp: {
                        type: OrderType.TAKE_PROFIT_MARKET,
                        triggerPrice: "52000",
                        triggerPriceType,
                    },
                    sl: {
                        type: OrderType.STOP_MARKET,
                        triggerPrice: "52000",
                        triggerPriceType,
                    },
                },
            );
            assert.deepEqual(issues, []);
        }
    }

    assert.equal(provider.calls, 4);
});

test("OrderClient market-entry bracket rejects missing or invalid BBO mid", async () => {
    const intention = new FakeIntention();

    for (const snapshot of [
        { markPrice: "50000", lastPrice: "48000", fetchedAtMs: Date.now() },
        { midPrice: "0", fetchedAtMs: Date.now() },
    ]) {
        const issues = await orderClient(
            intention,
            new FakePreflightProvider(snapshot),
        ).preflightOrderWithTpSl(
            {
                symbol: "BTC-USDC",
                side: "BUY",
                type: OrderType.MARKET,
                size: "0.1",
            },
            {
                tp: {
                    type: OrderType.TAKE_PROFIT_MARKET,
                    triggerPrice: "52000",
                },
            },
        );

        assert.equal(issues.length, 1);
        assert.equal(issues[0].code, "REFERENCE_PRICE_UNAVAILABLE");
        assert.equal(issues[0].referencePriceType, "MID_PRICE");
    }
});

test("OrderClient.placePositionTpSl validates against the requested trigger price type", async () => {
    const intention = new FakeIntention();
    const provider = new FakePreflightProvider({
        markPrice: "60000",
        fetchedAtMs: Date.now(),
    });
    await assert.rejects(
        orderClient(intention, provider).placePositionTpSl({
            symbol: "BTC-USDC",
            positionSide: "LONG",
            sizeMode: "close_position",
            tp: { type: OrderType.TAKE_PROFIT_MARKET, triggerPrice: "59000" },
        }),
        (error: unknown) => {
            assert.ok(error instanceof OrderPreflightError);
            assert.equal(error.issues[0].code, "TAKE_PROFIT_PRICE_MUST_ABOVE_REF");
            assert.equal(error.issues[0].referencePriceType, "MARK_PRICE");
            return true;
        },
    );
    assert.equal(provider.calls, 1);
    assert.equal(intention.submitCalls, 0);
});

test("OrderClient applies the chain-configured directional condition limit deviation", async () => {
    const intention = new FakeIntention();
    const provider = new FakePreflightProvider({
        markPrice: "60000",
        triggerProtectPpm: 0,
        conditionPriceDeviationPpm: 30_000,
        fetchedAtMs: Date.now(),
    });
    const issues = await orderClient(intention, provider).preflightOrder({
        symbol: "BTC-USDC",
        side: "SELL",
        type: OrderType.STOP_LIMIT,
        size: "0.1",
        price: "55000",
        triggerPrice: "59000",
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "CONDITION_LIMIT_PRICE_DEVIATION");
});

test("OrderClient deduplicates one market snapshot across a batch", async () => {
    const intention = new FakeIntention();
    const provider = new FakePreflightProvider({
        markPrice: "60000",
        fetchedAtMs: Date.now(),
    });
    const client = orderClient(intention, provider);

    const result = await client.placeOrders([
        {
            kind: "single",
            order: {
                symbol: "BTC-USDC",
                side: "SELL",
                type: OrderType.STOP_MARKET,
                size: "0.1",
                triggerPrice: "59000",
            },
        },
        {
            kind: "single",
            order: {
                symbol: "BTC-USDC",
                side: "SELL",
                type: OrderType.TAKE_PROFIT_MARKET,
                size: "0.1",
                triggerPrice: "61000",
            },
        },
    ]);

    assert.equal(result.hash, HASH);
    assert.equal(provider.calls, 1);
    assert.equal(intention.submitCalls, 1);
});

test("OrderClient.submitOrder defaults to local-only preflight", async () => {
    const intention = new FakeIntention();
    const provider = new FakePreflightProvider({
        markPrice: "60000",
        fetchedAtMs: Date.now(),
    });
    await orderClient(intention, provider).submitOrder({
        symbol: "BTC-USDC",
        side: "SELL",
        type: OrderType.STOP_MARKET,
        size: "0.1",
        triggerPrice: "61000",
    });

    assert.equal(provider.calls, 0);
    assert.equal(intention.submitCalls, 1);
});

test("OrderClient static preflight rejects a missing trigger price", () => {
    const issues = orderClient(new FakeIntention(), null).validateOrder({
        symbol: "BTC-USDC",
        side: "SELL",
        type: OrderType.STOP_MARKET,
        size: "0.1",
    });
    assert.equal(issues[0].code, "REQUIRED_TRIGGER_PRICE");
});

test("OrderClient reports the dedicated TP/SL limit-without-trigger code", () => {
    const issues = orderClient(new FakeIntention(), null).validateOrder({
        symbol: "BTC-USDC",
        side: "SELL",
        type: OrderType.STOP_LIMIT,
        size: "0.1",
        price: "59000",
    });
    assert.equal(issues[0].code, "CANNOT_SET_SL_LIMIT_WITHOUT_SL");
});

test("IntentionConfig exposes node/relayer/ws URLs and keeps legacy aliases", () => {
    const config = new IntentionConfig({
        nodeUrl: "https://node.example/v1",
        relayerUrl: "https://relayer.example",
        wsUrl: "wss://relayer.example/ws",
    });
    assert.equal(config.nodeUrl, "https://node.example/v1");
    assert.equal(config.fullnode, config.nodeUrl);
    assert.equal(config.dexRestUrl, config.relayerUrl);
    assert.equal(config.getRequestUrl(IntentionApiType.RELAYER), config.relayerUrl);
    assert.equal(config.getRequestUrl(IntentionApiType.WEBSOCKET), config.wsUrl);

    const legacy = new IntentionConfig({ fullnode: "https://legacy.example/v1" });
    assert.equal(legacy.nodeUrl, "https://legacy.example/v1");
});

test("RelayerOrderPreflightDataProvider combines node mark/policy and relayer book/trades", async () => {
    const config = new IntentionConfig({
        nodeUrl: "https://node.example/v1",
        relayerUrl: "https://relayer.example",
    });
    const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("/dex/mark_prices")) {
            return new Response(
                JSON.stringify({
                    prices: [
                        {
                            symbol_id: 0,
                            ticker: "BTC-USDC",
                            mark_price: "60000",
                            timestamp: 1_700_000_000_000_000,
                        },
                    ],
                }),
            );
        }
        if (url.endsWith("/dex/trading_policy/0")) {
            return new Response(
                JSON.stringify({
                    trigger_protect_ppm: 10_000,
                    condition_price_deviation_ppm: 30_000,
                }),
            );
        }
        if (url.includes("/v1/orderbooks/perpetualMarket/BTC-USDC")) {
            return new Response(
                JSON.stringify({
                    code: 0,
                    data: {
                        bids: [{ price: "59900" }],
                        asks: [{ price: "60100" }],
                        timestamp: 1_700_000_000_000,
                    },
                }),
            );
        }
        if (url.includes("/v1/trades/perpetualMarket/BTC-USDC")) {
            return new Response(
                JSON.stringify({
                    code: 0,
                    data: { trades: [{ price: "60010", createdAt: 1_700_000_000_100 }] },
                }),
            );
        }
        return new Response("not found", { status: 404 });
    };
    const provider = new RelayerOrderPreflightDataProvider(config, fetchImpl);
    const snapshot = await provider.getMarketSnapshot({
        symbol: "BTC-USDC",
        symbolId: 0,
        requirements: {
            markPrice: true,
            lastPrice: true,
            midPrice: true,
            tradingPolicy: true,
        },
    });

    assert.equal(snapshot.markPrice, "60000");
    assert.equal(snapshot.lastPrice, "60010");
    assert.equal(snapshot.bestBidPrice, "59900");
    assert.equal(snapshot.bestAskPrice, "60100");
    assert.equal(snapshot.triggerProtectPpm, 10_000);
    assert.equal(snapshot.conditionPriceDeviationPpm, 30_000);
    assert.equal(snapshot.timestamps?.markPrice, 1_700_000_000_000);
});

test("RelayerOrderPreflightDataProvider falls back to the market condition policy", async () => {
    const config = new IntentionConfig({
        nodeUrl: "https://node.example/v1",
        relayerUrl: "https://relayer.example",
    });
    const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("/dex/trading_policy/0")) {
            return new Response("not found", { status: 404 });
        }
        if (url.endsWith("/dex/perpetuals/0")) {
            return new Response(
                JSON.stringify({ condition_price_deviation_ppm: 95_000 }),
            );
        }
        return new Response("not found", { status: 404 });
    };

    const provider = new RelayerOrderPreflightDataProvider(config, fetchImpl);
    const snapshot = await provider.getMarketSnapshot({
        symbol: "BTC-USDC",
        symbolId: 0,
        requirements: { tradingPolicy: true },
    });

    assert.equal(snapshot.triggerProtectPpm, 0);
    assert.equal(snapshot.conditionPriceDeviationPpm, 95_000);
});

test("order outcomes collapse placed to filled and preserve per-order rejection", () => {
    const events = [
        {
            eventType: "OrderPlacedEvent",
            event: { orderId: 7n, clientOrderId: "placed", symbolId: 0 },
        },
        {
            eventType: "OrderFilledEvent",
            event: { orderId: 7n, clientOrderId: "placed", symbolId: 0 },
        },
        {
            eventType: "OrderRejectedEvent",
            event: {
                orderId: 8n,
                clientOrderId: "rejected",
                symbolId: 1,
                rejectReason: 1,
            },
        },
    ] as unknown as DecodedDexEvent[];

    assert.deepEqual(orderOutcomesFromDecodedEvents(events), [
        {
            status: "filled",
            orderId: 7n,
            clientOrderId: "placed",
            symbolId: 0,
        },
        {
            status: "rejected",
            orderId: 8n,
            clientOrderId: "rejected",
            symbolId: 1,
            rejectReasonCode: 1,
        },
    ]);
});

test("order outcomes normalize structured JSON and collapse to terminal rejection", () => {
    const events = [
        {
            eventType: "OrderPlacedEvent",
            event: {
                order_id: "42",
                client_order_id: { vec: ["client-42"] },
                symbol_id: "7",
            },
        },
        {
            eventType: "OrderRejectedEvent",
            event: {
                order_id: "42",
                client_order_id: { vec: [] },
                symbol_id: "7",
                reject_reason: "22",
            },
        },
    ] as unknown as DecodedDexEvent[];

    assert.deepEqual(orderOutcomesFromDecodedEvents(events), [
        {
            status: "rejected",
            orderId: 42n,
            clientOrderId: null,
            symbolId: 7,
            rejectReasonCode: 22,
        },
    ]);
});

test("OrderClient returns structured JSON outcomes and throws typed rejection errors", async () => {
    const acceptedIntention = new FakeIntention();
    acceptedIntention.response = committed({
        events: [
            {
                type: "0x1::dex::OrderPlacedEvent",
                data: {
                    order_id: "42",
                    client_order_id: { vec: ["client-42"] },
                    symbol_id: "7",
                },
            },
        ],
    });
    const accepted = await orderClient(acceptedIntention, null).placeOrder(ORDER);

    assert.deepEqual(accepted.orders, [
        {
            status: "placed",
            orderId: 42n,
            clientOrderId: "client-42",
            symbolId: 7,
        },
    ]);

    const rejectedIntention = new FakeIntention();
    rejectedIntention.response = committed({
        events: [
            {
                type: "0x1::dex::OrderRejectedEvent",
                data: {
                    order_id: "43",
                    client_order_id: { vec: [] },
                    symbol_id: "7",
                    reject_reason: "22",
                },
            },
        ],
    });

    await assert.rejects(
        orderClient(rejectedIntention, null).placeOrder(ORDER, {
            throwOnOrderReject: true,
        }),
        (error: unknown) => {
            assert.ok(error instanceof OrderRejectedError);
            assert.equal(error.result.orders[0].orderId, 43n);
            assert.equal(error.result.orders[0].rejectReasonCode, 22);
            return true;
        },
    );
});

test("order outcomes include amended confirmations", () => {
    const events = [
        {
            eventType: "OrderAmendedEvent",
            event: { orderId: 9n, clientOrderId: "amended", symbolId: 0 },
        },
    ] as unknown as DecodedDexEvent[];
    assert.deepEqual(orderOutcomesFromDecodedEvents(events), [
        { status: "amended", orderId: 9n, clientOrderId: "amended", symbolId: 0 },
    ]);
});

test("Intention.waitForTransaction checkSuccess throws a typed execution error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
        new Response(JSON.stringify(committed({ success: false, vm_status: "OUT_OF_GAS" })));
    try {
        const intention = new Intention({
            toClientConfig: () => ({ nodeUrl: "http://localhost:8080/v1" }),
        } as never);
        await assert.rejects(
            intention.waitForTransaction({
                transactionHash: HASH,
                options: { checkSuccess: true },
            }),
            (error: unknown) => {
                assert.ok(error instanceof TransactionExecutionError);
                assert.equal(error.transactionHash, HASH);
                assert.equal(error.vmStatus, "OUT_OF_GAS");
                return true;
            },
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    AccountAddress,
    DexAccountClient,
    Intention,
    IntentionConfig,
    RelayerOpenOrdersProvider,
    decodeDexEvent,
} from "../src/index";

test("DexAccountClient preserves wide integers from both RPC numbers and strings", async () => {
    const subAddress = "0x" + "11".repeat(32);
    const volume = "9011943791664541";
    const orderId = "9007199254740993";
    const fetchWithEncoding = (encoding: "number" | "string"): typeof fetch => async (input) => {
        const response = (payload: object, field: string, integer: string) => {
            const body = JSON.stringify(payload);
            return new Response(encoding === "number"
                ? body.replace(`"${field}":"${integer}"`, `"${field}":${integer}`)
                : body);
        };
        const url = String(input);
        if (url.includes("/dex/accounts/")) {
            return response(
                {
                    accounts: [
                        {
                            address: "0x1",
                            sub_address: subAddress,
                            name: "trading",
                            available_margin: "42",
                            position_mode: 0,
                            taker_rate: 3,
                            maker_rate: 1,
                            parent_volume_info: {
                                type_: 0,
                                last_trade_timestamp_sec: "1",
                                cumulative_volume_usd: volume,
                                volume_threshold_reached: false,
                                daily_buckets: [],
                            },
                            assets: [{ asset_id: 0, quantums: "100" }],
                            perps: [
                                {
                                    perpetual_id: 7,
                                    short_quantums: "0",
                                    long_quantums: "9007199254740993",
                                    margin_mode: 1,
                                    funding_index: "0",
                                    long_position_value: "1",
                                    short_position_value: "0",
                                    short_imr_quota: "0",
                                    long_imr_quota: "2",
                                    short_mmr_quota: "0",
                                    long_mmr_quota: "1",
                                    short_imr_close_fee: "0",
                                    long_imr_close_fee: "1",
                                },
                            ],
                            leverage_infos: [],
                            margin_modes: [],
                        },
                    ],
                },
                "cumulative_volume_usd",
                volume,
            );
        }
        assert.ok(url.endsWith(`/dex/orders/${orderId}`));
        return response(
            {
                owner: "00",
                subaccount_number: 0,
                symbol_id: 7,
                symbol_type: 2,
                side: 1,
                quantums: "9",
                subticks: "10",
                order_basic_type: 2,
                time_in_force: 4,
                condition_type: 0,
                operation: 1,
                timestamp: "11",
                target_order_id: "0",
                order_id: orderId,
                state: 0,
                remaining_quantums: "9",
                filled_quantums: "0",
                reduce_only: false,
                position_mode: 0,
                opening_fee: "0",
                closing_fee: "0",
                transaction_id: "00",
                slippage_tolerance_ppm: 100000,
                created_by: 1,
                canceled_by: 0,
                reject_reason: 0,
            },
            "order_id",
            orderId,
        );
    };
    const intention = new Intention(
        new IntentionConfig({ nodeUrl: "https://node.example/v1" }),
    );
    for (const encoding of ["number", "string"] as const) {
        const client = new DexAccountClient(intention, fetchWithEncoding(encoding));
        const account = await client.getAccount("0x1", subAddress);
        const order = await client.getOrder(9007199254740993n);

        assert.equal(account?.availableMargin, 42n);
        assert.equal(account?.parentVolumeInfo.cumulativeVolumeUsd, 9011943791664541n);
        assert.equal(account?.perps[0].longQuantums, 9007199254740993n);
        assert.equal(order.orderId, 9007199254740993n);
    }
});

test("RelayerOpenOrdersProvider filters symbol and preserves bigint order ids", async () => {
    const subAddress = "0x" + "11".repeat(32);
    const provider = new RelayerOpenOrdersProvider(
        new IntentionConfig({ relayerUrl: "https://relayer.example" }),
        async () =>
            new Response(
                JSON.stringify({
                    code: 0,
                    data: {
                        orders: [
                            {
                                id: "9007199254740993",
                                clobPairId: "7",
                                ticker: "BTC-USDC",
                                subAddress,
                            },
                            {
                                id: "2",
                                clobPairId: "8",
                                ticker: "ETH-USDC",
                                subAddress,
                            },
                        ],
                    },
                }),
            ),
    );
    const orders = await provider.getOpenOrders({
        address: "0x1",
        subAddress,
        symbolId: 7,
        symbol: "BTC-USDC",
    });
    assert.equal(orders.length, 1);
    assert.equal(orders[0].orderId, 9007199254740993n);
});

test("unified decoder recognizes AdjustIsolatedMarginEvent", () => {
    const bytes = new Uint8Array(32);
    bytes[31] = 1;
    const decoded = decodeDexEvent(
        "0x1::dex::AdjustIsolatedMarginEvent",
        `0x${Buffer.from(bytes).toString("hex")}`,
    );
    assert.equal(decoded?.eventType, "AdjustIsolatedMarginEvent");
    assert.equal(
        (decoded?.event as { subAddress: AccountAddress }).subAddress.toStringLong(),
        "0x" + "0".repeat(63) + "1",
    );
});

/** One market's delisting as the node renders it. */
function delistingJson(perpetualId: number, over: Record<string, unknown> = {}) {
    return {
        perpetual_id: perpetualId,
        symbol_id: 7,
        ticker: "AAPL-USDC",
        symbol_status: 5,
        phase: "SETTLING",
        prd_state: "SETTLING",
        plan: {
            plan_version: 2,
            t0_secs: 1700000000,
            reduce_only_lead_secs: 3600,
            twap_window_secs: 1800,
            max_cancel_per_block: 500,
            max_settle_per_block: 200,
            reduce_only_at_secs: 1699996400,
            window_start_secs: 1699998200,
        },
        indicative_price_subticks: 123450000,
        final_price_subticks: 123450000,
        runtime: {
            plan_version: 2,
            sample_weight_us: 3600000000,
            canceled_orders: 3,
            settled_accounts: 1,
            settled_quantums: "1000000",
            settled_quote_quantums: "1234500000",
            expected_total_pnl: "-1250000",
            realized_pnl_sum: "-50000000",
            shortfall_quote: "0",
        },
        ...over,
    };
}

function delistingClient(answer: (url: string) => Response) {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
        urls.push(String(input));
        return answer(String(input));
    };
    const intention = new Intention(new IntentionConfig({ nodeUrl: "https://node.example/v1/" }));
    return { client: new DexAccountClient(intention, fetchImpl), urls };
}

test("getDelistings reads every plan, signed totals and all", async () => {
    const { client, urls } = delistingClient(() => new Response(JSON.stringify({
        delistings: [
            delistingJson(40),
            delistingJson(41, {
                phase: "SCHEDULED",
                prd_state: "PRE_SETTLEMENT",
                symbol_status: 0,
                indicative_price_subticks: null,
                final_price_subticks: null,
                runtime: null,
            }),
        ],
    })));

    const delistings = await client.getDelistings();

    assert.deepEqual(urls, ["https://node.example/v1/dex/delistings"]);
    assert.deepStrictEqual(delistings[0], {
        perpetualId: 40,
        symbolId: 7,
        ticker: "AAPL-USDC",
        symbolStatus: 5,
        phase: "SETTLING",
        prdState: "SETTLING",
        plan: {
            planVersion: 2,
            t0Secs: 1_700_000_000n,
            reduceOnlyLeadSecs: 3600,
            twapWindowSecs: 1800,
            maxCancelPerBlock: 500,
            maxSettlePerBlock: 200,
            reduceOnlyAtSecs: 1_699_996_400n,
            windowStartSecs: 1_699_998_200n,
        },
        indicativePriceSubticks: 123_450_000n,
        finalPriceSubticks: 123_450_000n,
        runtime: {
            planVersion: 2,
            sampleWeightUs: 3_600_000_000n,
            canceledOrders: 3n,
            settledAccounts: 1n,
            settledQuantums: 1_000_000n,
            settledQuoteQuantums: 1_234_500_000n,
            expectedTotalPnl: -1_250_000n,
            realizedPnlSum: -50_000_000n,
            shortfallQuote: 0n,
        },
    });
    assert.equal(delistings[1].indicativePriceSubticks, null);
    assert.equal(delistings[1].runtime, null);
});

test("a market without a plan is null, a node without the route has none", async () => {
    const missing = delistingClient(() => new Response("{}", { status: 404 }));
    assert.equal(await missing.client.getDelisting(42), null);
    assert.deepEqual(await missing.client.getDelistings(), []);
    assert.deepEqual(missing.urls, [
        "https://node.example/v1/dex/delistings/42",
        "https://node.example/v1/dex/delistings",
    ]);

    const found = delistingClient(() => new Response(JSON.stringify(delistingJson(42))));
    assert.equal((await found.client.getDelisting(42))?.plan.planVersion, 2);
});

test("a failing node is an error, not an absent plan", async () => {
    const broken = delistingClient(() => new Response("boom", { status: 502 }));
    await assert.rejects(broken.client.getDelisting(42), /getDelisting failed: 502/);
    await assert.rejects(broken.client.getDelistings(), /getDelistings failed: 502/);
    await assert.rejects(broken.client.getDelisting(-1), /perpetualId must be a u32/);
    await assert.rejects(broken.client.getDelisting(1.5), /perpetualId must be a u32/);
});

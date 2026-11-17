// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    Account,
    AccountClient,
    AccountAddress,
    IntentionClient,
    IntentionWebSocketClient,
    OrderPositionMode,
    OrderType,
    SimpleMarketResolver,
    VaultClient,
} from "../src/index";
import type {
    PendingTransactionResponse,
    TransactionResponse,
} from "../src/api/client";

const HASH = `0x${"ab".repeat(32)}`;
const SUB_ADDRESS = AccountAddress.from(`0x${"11".repeat(32)}`);

function marketResolver(): SimpleMarketResolver {
    return new SimpleMarketResolver([
        {
            symbol: "BTC-USDC",
            clobPairId: 7,
            atomicResolution: -10,
            quantumConversionExponent: -9,
            stepBaseQuantums: 1_000_000,
            subticksPerTick: 100_000,
        },
    ]);
}

function committed(): TransactionResponse {
    return {
        type: "user_transaction",
        version: "1",
        hash: HASH,
        state_change_hash: "0x1",
        event_root_hash: "0x1",
        state_checkpoint_hash: "0x1",
        gas_used: "1",
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
    };
}

test("IntentionClient exposes domain namespaces without constructor I/O", () => {
    let websocketCreations = 0;
    const sdk = new IntentionClient({
        signer: Account.generate(),
        nodeUrl: "https://node.example/v1",
        relayerUrl: "https://relayer.example",
        wsUrl: "wss://relayer.example/ws",
        websocketOptions: {
            webSocketFactory: () => {
                websocketCreations += 1;
                throw new Error("not expected");
            },
        },
    });

    const trader = sdk.trader({ subAddress: SUB_ADDRESS });
    assert.ok(sdk.accounts instanceof AccountClient);
    assert.ok(sdk.vaults instanceof VaultClient);
    assert.ok(sdk.realtime instanceof IntentionWebSocketClient);
    assert.equal(trader.subAddress.toString(), SUB_ADDRESS.toString());
    assert.equal(websocketCreations, 0);
    sdk.close();
});

test("TraderClient lazily loads and caches market metadata plus position mode", async () => {
    const signer = Account.generate();
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/v1/perpetualMarkets")) {
            return new Response(
                JSON.stringify({
                    code: 0,
                    data: {
                        markets: {
                            "BTC-USDC": {
                                clobPairId: 7,
                                atomicResolution: -10,
                                quantumConversionExponent: -9,
                                stepBaseQuantums: 1_000_000,
                                subticksPerTick: 100_000,
                                status: "ACTIVE",
                            },
                        },
                    },
                }),
            );
        }
        return new Response(
            JSON.stringify({
                accounts: [
                    {
                        address: signer.accountAddress.toString(),
                        sub_address: SUB_ADDRESS.toString(),
                        name: "trading",
                        available_margin: "0",
                        position_mode: OrderPositionMode.Net,
                        taker_rate: 0,
                        maker_rate: 0,
                        parent_volume_info: {
                            type_: 0,
                            last_trade_timestamp_sec: "0",
                            cumulative_volume_usd: "0",
                            volume_threshold_reached: false,
                            daily_buckets: [],
                        },
                        assets: [],
                        perps: [],
                        leverage_infos: [],
                        margin_modes: [],
                    },
                ],
            }),
        );
    };

    try {
        const sdk = new IntentionClient({
            signer,
            nodeUrl: "https://node.example/v1",
            relayerUrl: "https://relayer.example",
        });
        const trader = sdk.trader({ subAddress: SUB_ADDRESS });
        assert.deepEqual(calls, []);

        await trader.prepare();
        await trader.prepare();
        assert.deepEqual(calls, [
            "https://relayer.example/v1/perpetualMarkets",
            `https://node.example/v1/dex/accounts/${signer.accountAddress.toString()}`,
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("TraderClient forwards the simple order path and waits by default", async () => {
    const sdk = new IntentionClient({
        signer: Account.generate(),
        nodeUrl: "https://node.example/v1",
    });
    let submitted = 0;
    let waited = 0;
    sdk.intention.submitDexOrders = async () => {
        submitted += 1;
        return { hash: HASH } as PendingTransactionResponse;
    };
    sdk.intention.waitForTransaction = async () => {
        waited += 1;
        return committed();
    };

    const trader = sdk.trader({
        subAddress: SUB_ADDRESS,
        positionMode: OrderPositionMode.Net,
        resolver: marketResolver(),
    });
    const result = await trader.placeOrder({
        symbol: "BTC-USDC",
        side: "BUY",
        type: OrderType.LIMIT,
        size: "0.1",
        price: 60_000,
    });

    assert.equal(result.hash, HASH);
    assert.equal(submitted, 1);
    assert.equal(waited, 1);
});

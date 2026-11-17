// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    IntentionConfig,
    IntentionWebSocketClient,
    SimpleMarketResolver,
    type WebSocketLike,
} from "../src/index";

class FakeSocket implements WebSocketLike {
    readyState = 0;
    sent: string[] = [];
    private listeners = new Map<string, Array<(event: never) => void>>();

    send(data: string): void {
        this.sent.push(data);
    }
    close(): void {
        this.readyState = 3;
        this.emit("close", {});
    }
    addEventListener(type: string, listener: (event: never) => void): void {
        const entries = this.listeners.get(type) ?? [];
        entries.push(listener);
        this.listeners.set(type, entries);
    }
    open(): void {
        this.readyState = 1;
        this.emit("open", {});
    }
    message(value: unknown): void {
        this.emit("message", { data: JSON.stringify(value) });
    }
    private emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event as never);
    }
}

test("IntentionWebSocketClient queues, routes and unsubscribes v1 channels", () => {
    const socket = new FakeSocket();
    const snapshots: unknown[] = [];
    const updates: unknown[] = [];
    const client = new IntentionWebSocketClient(
        new IntentionConfig({ wsUrl: "wss://relayer.example/ws" }),
        { webSocketFactory: () => socket },
    );
    const unsubscribe = client.subscribeOrderbook("BTC-USDC", {
        onSnapshot: (contents) => snapshots.push(contents),
        onUpdate: (contents) => updates.push(contents),
    });

    assert.equal(socket.sent.length, 0);
    socket.open();
    assert.deepEqual(JSON.parse(socket.sent[0]), {
        type: "subscribe",
        channel: "v1_orderbook",
        id: "BTC-USDC",
        batched: true,
    });
    socket.message({
        type: "subscribed",
        channel: "v1_orderbook",
        id: "BTC-USDC",
        contents: { bids: [] },
    });
    socket.message({
        type: "channel_batch_data",
        channel: "v1_orderbook",
        id: "BTC-USDC",
        contents: [{ bids: [1] }, { asks: [2] }],
    });
    assert.deepEqual(snapshots, [{ bids: [] }]);
    assert.deepEqual(updates, [{ bids: [1] }, { asks: [2] }]);

    unsubscribe();
    assert.deepEqual(JSON.parse(socket.sent[1]), {
        type: "unsubscribe",
        channel: "v1_orderbook",
        id: "BTC-USDC",
    });
    client.close();
});

test("IntentionWebSocketClient can keep SimpleMarketResolver current", () => {
    const socket = new FakeSocket();
    const resolver = new SimpleMarketResolver();
    const client = new IntentionWebSocketClient(
        new IntentionConfig({ wsUrl: "wss://relayer.example/ws" }),
        { webSocketFactory: () => socket },
    );
    client.bindMarketResolver(resolver);
    socket.open();
    socket.message({
        type: "subscribed",
        channel: "v1_markets",
        contents: {
            markets: {
                "BTC-USDC": {
                    clobPairId: 7,
                    atomicResolution: -10,
                    quantumConversionExponent: -9,
                    stepBaseQuantums: "1000000",
                    subticksPerTick: "100000",
                },
            },
        },
    });
    assert.equal(resolver.symbolId("BTC-USDC"), 7);
    client.close();
});

test("SimpleMarketResolver supports non-USDC Spot quote resolution", () => {
    const resolver = new SimpleMarketResolver([
        {
            symbol: "BTC-USDT",
            clobPairId: 9,
            atomicResolution: -8,
            quoteAtomicResolution: -8,
            quantumConversionExponent: -4,
            stepBaseQuantums: 1,
            subticksPerTick: 1,
        },
    ]);
    assert.equal(resolver.toQuantums("BTC-USDT", "0.01"), 1_000_000n);
    assert.equal(resolver.toSubticks("BTC-USDT", "60000"), 600_000_000n);
});

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/** Lightweight relayer WebSocket subscriptions with reconnect/resubscribe support. */

import type { AccountAddressInput } from "../core/accountAddress";
import { AccountAddress } from "../core/accountAddress";
import type { IntentionConfig } from "./intention";
import type { SimpleMarketResolver, WsMarketsMessage } from "../transactions/marketResolver";

export type IntentionWebSocketChannel =
    | "v1_markets"
    | "v1_orderbook"
    | "v1_trades"
    | "v1_subaccounts"
    | (string & {});

export interface IntentionWebSocketMessage<T = unknown> {
    type:
        | "connected"
        | "subscribed"
        | "unsubscribed"
        | "channel_data"
        | "channel_batch_data"
        | "error"
        | string;
    channel?: string;
    id?: string;
    contents?: T;
    message?: string;
    message_id?: number;
    [key: string]: unknown;
}

export interface WebSocketLike {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: "open", listener: (event: unknown) => void): void;
    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    addEventListener(type: "close", listener: (event: unknown) => void): void;
    addEventListener(type: "error", listener: (event: unknown) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WebSocketSubscriptionHandlers<T = unknown> {
    onSnapshot?: (contents: T, message: IntentionWebSocketMessage<T>) => void;
    onUpdate?: (contents: T, message: IntentionWebSocketMessage<T>) => void;
    onError?: (error: Error, message?: IntentionWebSocketMessage) => void;
}

export interface IntentionWebSocketClientOptions {
    webSocketFactory?: WebSocketFactory;
    /** Initial reconnect delay. Default 500ms. */
    reconnectDelayMs?: number;
    /** Reconnect-delay ceiling. Default 10s. */
    maxReconnectDelayMs?: number;
    /** Connect immediately. Default true. */
    autoConnect?: boolean;
}

interface Subscription {
    channel: IntentionWebSocketChannel;
    id?: string;
    batched: boolean;
    handlers: WebSocketSubscriptionHandlers<unknown>;
}

function defaultFactory(url: string): WebSocketLike {
    const Constructor = globalThis.WebSocket;
    if (Constructor == null) {
        throw new Error(
            "WebSocket is unavailable in this runtime; pass IntentionWebSocketClientOptions.webSocketFactory",
        );
    }
    return new Constructor(url) as unknown as WebSocketLike;
}

function key(channel: string, id?: string): string {
    return `${channel}\u0000${id ?? ""}`;
}

function parseMessage(data: unknown): IntentionWebSocketMessage {
    if (typeof data === "string") return JSON.parse(data) as IntentionWebSocketMessage;
    if (data instanceof ArrayBuffer) {
        return JSON.parse(new TextDecoder().decode(data)) as IntentionWebSocketMessage;
    }
    if (ArrayBuffer.isView(data)) {
        return JSON.parse(
            new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
        ) as IntentionWebSocketMessage;
    }
    if (typeof data === "object" && data !== null) return data as IntentionWebSocketMessage;
    throw new Error("Unsupported WebSocket message payload");
}

function address(value: AccountAddressInput): string {
    return AccountAddress.from(value, { maxMissingChars: 64 }).toString();
}

/**
 * Dependency-free transport for the relayer's v1 channels. Subscriptions made
 * before open are queued and every active subscription is replayed after reconnect.
 */
export class IntentionWebSocketClient {
    private socket?: WebSocketLike;
    private readonly subscriptions = new Map<string, Subscription>();
    private readonly factory: WebSocketFactory;
    private readonly reconnectDelayMs: number;
    private readonly maxReconnectDelayMs: number;
    private currentReconnectDelayMs: number;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private stopped = false;

    constructor(
        private readonly config: IntentionConfig,
        options: IntentionWebSocketClientOptions = {},
    ) {
        this.factory = options.webSocketFactory ?? defaultFactory;
        this.reconnectDelayMs = options.reconnectDelayMs ?? 500;
        this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 10_000;
        this.currentReconnectDelayMs = this.reconnectDelayMs;
        if (options.autoConnect ?? true) this.connect();
    }

    connect(): void {
        if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;
        if (!this.config.wsUrl) throw new Error("IntentionConfig.wsUrl is required");
        this.stopped = false;
        const socket = this.factory(this.config.wsUrl);
        this.socket = socket;
        socket.addEventListener("open", () => {
            if (this.socket !== socket) return;
            this.currentReconnectDelayMs = this.reconnectDelayMs;
            for (const subscription of this.subscriptions.values()) this.sendSubscribe(subscription);
        });
        socket.addEventListener("message", (event) => this.handleMessage(event.data));
        socket.addEventListener("error", () => {
            const error = new Error("WebSocket transport error");
            for (const subscription of this.subscriptions.values()) {
                subscription.handlers.onError?.(error);
            }
        });
        socket.addEventListener("close", () => {
            if (this.socket === socket) this.socket = undefined;
            if (!this.stopped) this.scheduleReconnect();
        });
    }

    close(code = 1000, reason = "client closed"): void {
        this.stopped = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
        this.socket?.close(code, reason);
        this.socket = undefined;
    }

    subscribe<T>(args: {
        channel: IntentionWebSocketChannel;
        id?: string;
        batched?: boolean;
        handlers: WebSocketSubscriptionHandlers<T>;
    }): () => void {
        const subscriptionKey = key(args.channel, args.id);
        if (this.subscriptions.has(subscriptionKey)) {
            throw new Error(`Already subscribed to ${args.channel}${args.id ? `/${args.id}` : ""}`);
        }
        const subscription: Subscription = {
            channel: args.channel,
            id: args.id,
            batched: args.batched ?? true,
            handlers: args.handlers as WebSocketSubscriptionHandlers<unknown>,
        };
        this.subscriptions.set(subscriptionKey, subscription);
        if (!this.socket) this.connect();
        if (this.socket?.readyState === 1) this.sendSubscribe(subscription);
        return () => {
            if (!this.subscriptions.delete(subscriptionKey)) return;
            if (this.socket?.readyState === 1) {
                this.socket.send(
                    JSON.stringify({ type: "unsubscribe", channel: args.channel, id: args.id }),
                );
            }
        };
    }

    subscribeMarkets(handlers: WebSocketSubscriptionHandlers<WsMarketsMessage>): () => void {
        return this.subscribe({ channel: "v1_markets", handlers });
    }

    /** Keep a resolver updated from both the initial market snapshot and incremental pushes. */
    bindMarketResolver(
        resolver: SimpleMarketResolver,
        onError?: WebSocketSubscriptionHandlers<WsMarketsMessage>["onError"],
    ): () => void {
        return this.subscribeMarkets({
            onSnapshot: (contents) => resolver.applyWsMessage(contents),
            onUpdate: (contents) => resolver.applyWsMessage(contents),
            onError,
        });
    }

    subscribeOrderbook<T = unknown>(
        symbol: string,
        handlers: WebSocketSubscriptionHandlers<T>,
    ): () => void {
        return this.subscribe({ channel: "v1_orderbook", id: symbol, handlers });
    }

    subscribeTrades<T = unknown>(
        symbol: string,
        handlers: WebSocketSubscriptionHandlers<T>,
    ): () => void {
        return this.subscribe({ channel: "v1_trades", id: symbol, handlers });
    }

    subscribeSubaccount<T = unknown>(args: {
        address: AccountAddressInput;
        subAddress?: AccountAddressInput;
        handlers: WebSocketSubscriptionHandlers<T>;
    }): () => void {
        const master = address(args.address);
        const sub =
            args.subAddress == null
                ? undefined
                : AccountAddress.from(args.subAddress, { maxMissingChars: 64 });
        const id =
            sub == null || sub.data.every((byte) => byte === 0)
                ? master
                : `${master}/${sub.toString()}`;
        return this.subscribe({ channel: "v1_subaccounts", id, handlers: args.handlers });
    }

    private sendSubscribe(subscription: Subscription): void {
        this.socket?.send(
            JSON.stringify({
                type: "subscribe",
                channel: subscription.channel,
                id: subscription.id,
                batched: subscription.batched,
            }),
        );
    }

    private handleMessage(data: unknown): void {
        let message: IntentionWebSocketMessage;
        try {
            message = parseMessage(data);
        } catch (error) {
            const parsed = error instanceof Error ? error : new Error(String(error));
            for (const subscription of this.subscriptions.values()) {
                subscription.handlers.onError?.(parsed);
            }
            return;
        }
        if (!message.channel) return;
        const subscription = this.subscriptions.get(key(message.channel, message.id));
        if (!subscription) return;
        if (message.type === "error") {
            subscription.handlers.onError?.(new Error(message.message ?? "WebSocket API error"), message);
        } else if (message.type === "subscribed") {
            subscription.handlers.onSnapshot?.(message.contents, message);
        } else if (message.type === "channel_data") {
            subscription.handlers.onUpdate?.(message.contents, message);
        } else if (message.type === "channel_batch_data") {
            const contents = Array.isArray(message.contents) ? message.contents : [message.contents];
            for (const update of contents) subscription.handlers.onUpdate?.(update, message);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer || this.stopped) return;
        const delay = this.currentReconnectDelayMs;
        this.currentReconnectDelayMs = Math.min(delay * 2, this.maxReconnectDelayMs);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            try {
                this.connect();
            } catch (error) {
                const parsed = error instanceof Error ? error : new Error(String(error));
                for (const subscription of this.subscriptions.values()) {
                    subscription.handlers.onError?.(parsed);
                }
                this.scheduleReconnect();
            }
        }, delay);
    }
}

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Runtime market data used by high-level order preflight checks.
 *
 * The default provider intentionally uses one-shot REST requests. Trading apps
 * that already maintain `v1_markets`, `v1_orderbook`, and `v1_trades` WebSocket
 * caches can implement {@link OrderPreflightDataProvider} and inject it into
 * `OrderClient` to avoid additional network round trips.
 */

import type { IntentionConfig } from "../api/intention";

export type PreflightDecimal = number | string;

export interface OrderPreflightRequirements {
    markPrice?: boolean;
    lastPrice?: boolean;
    midPrice?: boolean;
    tradingPolicy?: boolean;
}

export interface OrderPreflightPriceTimestamps {
    markPrice?: number;
    lastPrice?: number;
    midPrice?: number;
}

/** One market snapshot; decimal values remain strings until resolved to subticks. */
export interface OrderPreflightMarketSnapshot {
    symbol: string;
    markPrice?: PreflightDecimal;
    lastPrice?: PreflightDecimal;
    /** A provider may supply mid directly or supply both top-of-book prices. */
    midPrice?: PreflightDecimal;
    bestBidPrice?: PreflightDecimal;
    bestAskPrice?: PreflightDecimal;
    triggerProtectPpm?: number;
    conditionPriceDeviationPpm?: number;
    fetchedAtMs: number;
    timestamps?: OrderPreflightPriceTimestamps;
}

export interface OrderPreflightDataRequest {
    symbol: string;
    symbolId: number;
    requirements: OrderPreflightRequirements;
}

/** Injectable data source, suitable for either REST or an application WS cache. */
export interface OrderPreflightDataProvider {
    getMarketSnapshot(
        request: OrderPreflightDataRequest,
    ): Promise<OrderPreflightMarketSnapshot>;
}

interface RelayerEnvelope<T> {
    code?: number;
    message?: string;
    data?: T;
}

interface MarkPriceEntry {
    symbol_id?: number;
    ticker?: string;
    mark_price?: string;
    timestamp?: number | string;
}

interface OrderbookLevel {
    price?: string | number;
}

interface RecentTrade {
    price?: string | number;
    createdAt?: number | string;
}

function appendPath(base: string, path: string): string {
    return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function finiteNumber(value: unknown): number | undefined {
    const result = typeof value === "number" ? value : Number(value);
    return Number.isFinite(result) ? result : undefined;
}

/** REST implementation backed by fullnode + relayer endpoints. */
export class RelayerOrderPreflightDataProvider implements OrderPreflightDataProvider {
    private readonly fetchImpl: typeof fetch;

    constructor(
        private readonly config: IntentionConfig,
        fetchImpl: typeof fetch = fetch,
    ) {
        this.fetchImpl = fetchImpl;
    }

    private async requestJson<T>(url: string, allowNotFound = false): Promise<T | undefined> {
        const response = await this.fetchImpl(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (allowNotFound && response.status === 404) {
            return undefined;
        }
        if (!response.ok) {
            throw new Error(`Order preflight request failed: ${response.status} ${response.statusText} (${url})`);
        }
        return response.json() as Promise<T>;
    }

    private async relayerData<T>(path: string): Promise<T> {
        const base = this.config.relayerUrl ?? this.config.dexRestUrl;
        if (!base) {
            throw new Error("Order preflight requires IntentionConfig.relayerUrl");
        }
        const body = await this.requestJson<RelayerEnvelope<T>>(appendPath(base, path));
        if (!body || (body.code != null && body.code !== 0) || body.data == null) {
            throw new Error(`Order preflight relayer error: ${body?.message ?? body?.code ?? "missing data"}`);
        }
        return body.data;
    }

    private async fetchMarkPrice(
        symbol: string,
        symbolId: number,
    ): Promise<{ price?: PreflightDecimal; timestampMs?: number }> {
        if (!this.config.nodeUrl) {
            throw new Error("Order preflight requires IntentionConfig.nodeUrl");
        }
        const body = await this.requestJson<{ prices?: MarkPriceEntry[] }>(
            appendPath(this.config.nodeUrl, "dex/mark_prices"),
        );
        const entry = body?.prices?.find(
            (price) => price.ticker === symbol || price.symbol_id === symbolId,
        );
        const timestampUs = finiteNumber(entry?.timestamp);
        return {
            price: entry?.mark_price,
            timestampMs: timestampUs == null ? undefined : Math.floor(timestampUs / 1_000),
        };
    }

    private async fetchLastPrice(
        symbol: string,
    ): Promise<{ price?: PreflightDecimal; timestampMs?: number }> {
        const data = await this.relayerData<{ trades?: RecentTrade[] }>(
            `v1/trades/perpetualMarket/${encodeURIComponent(symbol)}?limit=1&page=1`,
        );
        const trade = data.trades?.[0];
        return { price: trade?.price, timestampMs: finiteNumber(trade?.createdAt) };
    }

    private async fetchMidPrice(
        symbol: string,
    ): Promise<{ bestBidPrice?: PreflightDecimal; bestAskPrice?: PreflightDecimal; timestampMs?: number }> {
        const data = await this.relayerData<{
            bids?: OrderbookLevel[];
            asks?: OrderbookLevel[];
            timestamp?: number | string;
        }>(`v1/orderbooks/perpetualMarket/${encodeURIComponent(symbol)}`);
        return {
            bestBidPrice: data.bids?.[0]?.price,
            bestAskPrice: data.asks?.[0]?.price,
            timestampMs: finiteNumber(data.timestamp),
        };
    }

    private async fetchTradingPolicy(symbolId: number): Promise<{
        triggerProtectPpm?: number;
        conditionPriceDeviationPpm?: number;
    }> {
        if (!this.config.nodeUrl) {
            throw new Error("Order preflight requires IntentionConfig.nodeUrl");
        }
        const policy = await this.requestJson<{
            trigger_protect_ppm?: number;
            condition_price_deviation_ppm?: number;
        }>(appendPath(this.config.nodeUrl, `dex/trading_policy/${symbolId}`), true);
        if (!policy) {
            // Before a symbol policy overlay exists, the per-market endpoint
            // still exposes the effective create-time condition deviation.
            const perpetual = await this.requestJson<{
                condition_price_deviation_ppm?: number;
            }>(appendPath(this.config.nodeUrl, `dex/perpetuals/${symbolId}`));
            return {
                triggerProtectPpm: 0,
                conditionPriceDeviationPpm: finiteNumber(
                    perpetual?.condition_price_deviation_ppm,
                ),
            };
        }
        return {
            triggerProtectPpm: finiteNumber(policy?.trigger_protect_ppm),
            conditionPriceDeviationPpm: finiteNumber(policy?.condition_price_deviation_ppm),
        };
    }

    async getMarketSnapshot(
        request: OrderPreflightDataRequest,
    ): Promise<OrderPreflightMarketSnapshot> {
        const { requirements } = request;
        const [mark, last, mid, policy] = await Promise.all([
            requirements.markPrice
                ? this.fetchMarkPrice(request.symbol, request.symbolId)
                : Promise.resolve(undefined),
            requirements.lastPrice
                ? this.fetchLastPrice(request.symbol)
                : Promise.resolve(undefined),
            requirements.midPrice
                ? this.fetchMidPrice(request.symbol)
                : Promise.resolve(undefined),
            requirements.tradingPolicy
                ? this.fetchTradingPolicy(request.symbolId)
                : Promise.resolve(undefined),
        ]);
        return {
            symbol: request.symbol,
            markPrice: mark?.price,
            lastPrice: last?.price,
            bestBidPrice: mid?.bestBidPrice,
            bestAskPrice: mid?.bestAskPrice,
            triggerProtectPpm: policy?.triggerProtectPpm,
            conditionPriceDeviationPpm: policy?.conditionPriceDeviationPpm,
            fetchedAtMs: Date.now(),
            timestamps: {
                markPrice: mark?.timestampMs,
                lastPrice: last?.timestampMs,
                midPrice: mid?.timestampMs,
            },
        };
    }
}

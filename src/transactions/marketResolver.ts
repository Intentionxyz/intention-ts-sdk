// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Concrete {@link MarketResolver} backed by cached perpetual listing config.
 *
 * Converts human order values to on-chain wire values, matching trading-web's
 * `placeOrderBuilder.ts` and the engine price-conversion math:
 *
 *   quantumMultiplier = 10^(-base_atomic_resolution)
 *   quantums          = floor(size  * quantumMultiplier)   , aligned to step_base_quantums
 *   subtickMultiplier = 10^(-quantum_conversion_exponent + base_atomic_resolution - QUOTE_ATOMIC_RESOLUTION)
 *   subticks          = floor(price * subtickMultiplier)   , aligned to subticks_per_tick
 *   symbol_id         = clobPairId (== perpetual_id)
 *
 * All scaling is done with bigint to avoid float precision loss on large
 * quantums (e.g. BTC size * 10^10 can exceed Number.MAX_SAFE_INTEGER).
 *
 * Data source: populate from the DEX REST `GET /v1/perpetualMarkets` or the
 * `v1_markets` WebSocket channel (fields: clobPairId, atomicResolution,
 * quantumConversionExponent, stepBaseQuantums, subticksPerTick).
 */

import type { MarketResolver } from "./orderIntents";

/** USDC quote decimals - fixed system-wide. */
export const QUOTE_ATOMIC_RESOLUTION = -6;

/** Raw per-market listing fields (as returned by DEX REST/WS market objects). */
export interface MarketInput {
    /** Cache key used as `OrderInput.symbol` (e.g. "BTC-USDC"). */
    symbol: string;
    /** On-chain order `symbol_id` (== clobPairId == perpetual_id). */
    clobPairId: number | string;
    /** `base_atomic_resolution` (negative exponent, e.g. -10 for BTC). */
    atomicResolution: number;
    /** `quantum_conversion_exponent` (e.g. -9). */
    quantumConversionExponent: number;
    /** `step_base_quantums` (engine `step_size`). */
    stepBaseQuantums: number | string;
    /** `subticks_per_tick` (engine `tick_size`). */
    subticksPerTick: number | string;
    /** Quote-asset exponent. Defaults to USDC's -6; set explicitly for non-USDC Spot pairs. */
    quoteAtomicResolution?: number;
}

/** Perpetual market metadata (backward-compatible name). */
export type PerpMarketInput = MarketInput;

/** Spot market metadata. The conversion math is shared with perpetual markets. */
export type SpotMarketInput = MarketInput;

interface DerivedConfig {
    symbolId: number;
    /** exponent for size->quantums: `-base_atomic_resolution`. */
    quantumExp: number;
    /** exponent for price->subticks: `-qce + base_atomic_resolution - QUOTE_ATOMIC_RESOLUTION`. */
    subtickExp: number;
    stepBaseQuantums: bigint;
    subticksPerTick: bigint;
}

function deriveConfig(m: MarketInput): DerivedConfig {
    return {
        symbolId: Number(m.clobPairId),
        quantumExp: -m.atomicResolution,
        subtickExp:
            -m.quantumConversionExponent +
            m.atomicResolution -
            (m.quoteAtomicResolution ?? QUOTE_ATOMIC_RESOLUTION),
        stepBaseQuantums: BigInt(m.stepBaseQuantums),
        subticksPerTick: BigInt(m.subticksPerTick),
    };
}

/**
 * Convert a JS number to a plain decimal string (no exponential notation),
 * preserving the shortest round-trip value from `String(n)`. Expansion is done
 * by digit-shifting (NOT `toFixed`, which reintroduces float imprecision, e.g.
 * `(1e-7).toFixed(27)` yields `0.0000000999...`).
 */
function numberToPlainString(n: number): string {
    if (!Number.isFinite(n)) {
        throw new Error(`non-finite number: ${n}`);
    }
    const s = String(n);
    if (!/[eE]/.test(s)) {
        return s;
    }
    const neg = s[0] === "-";
    const unsigned = neg ? s.slice(1) : s;
    const [mantissa, expStr] = unsigned.split(/[eE]/);
    const exp = parseInt(expStr, 10);
    const [intPart, fracPart = ""] = mantissa.split(".");
    const digits = intPart + fracPart;
    const pointPos = intPart.length + exp; // decimal point index within `digits`
    let out: string;
    if (pointPos <= 0) {
        out = "0." + "0".repeat(-pointPos) + digits;
    } else if (pointPos >= digits.length) {
        out = digits + "0".repeat(pointPos - digits.length);
    } else {
        out = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
    }
    return neg ? `-${out}` : out;
}

/**
 * Compute `floor(value * 10^exp10)` exactly using bigint. Handles decimal input
 * and negative `exp10`. Assumes non-negative `value` (sign is applied elsewhere
 * via `encodeLegSelection`).
 */
export function floorScaleToBigInt(value: number | string, exp10: number): bigint {
    const raw = typeof value === "number" ? numberToPlainString(value) : value.trim();
    const neg = raw.startsWith("-");
    const body = neg ? raw.slice(1) : raw;
    if (!/^\d*(\.\d*)?$/.test(body) || body === "" || body === ".") {
        throw new Error(`invalid decimal value: ${JSON.stringify(value)}`);
    }
    const [intPart, fracPart = ""] = body.split(".");
    const digitsStr = (intPart === "" ? "0" : intPart) + fracPart;
    const digits = BigInt(digitsStr === "" ? "0" : digitsStr);
    const shift = exp10 - fracPart.length;
    let result: bigint;
    if (shift >= 0) {
        result = digits * 10n ** BigInt(shift);
    } else {
        // truncation toward zero == floor for non-negative digits
        result = digits / 10n ** BigInt(-shift);
    }
    return neg ? -result : result;
}

/** Fields carried by a `v1_markets` WS market object (subset we consume). */
export type MarketFields = Omit<MarketInput, "symbol">;

/**
 * A `v1_markets` WS message. Initial snapshot uses `markets` (full configs);
 * incremental pushes use `trading` (partial per-market updates). Extra dynamic
 * fields (price / funding / OI) are ignored.
 */
export interface WsMarketsMessage {
    markets?: Record<string, Partial<MarketFields>>;
    trading?: Record<string, Partial<MarketFields>>;
}

const REQUIRED_FIELDS: Array<keyof MarketFields> = [
    "clobPairId",
    "atomicResolution",
    "quantumConversionExponent",
    "stepBaseQuantums",
    "subticksPerTick",
];

/**
 * In-memory {@link MarketResolver}. Construct from a list of perpetual markets
 * (fetched from DEX REST), then keep fresh from live WS `v1_markets` updates via
 * {@link SimpleMarketResolver.applyWsMessage}.
 *
 * NOTE: listing config (symbol_id / atomic resolution / exponents / step / tick)
 * is effectively static per market; WS mainly matters for markets listed at
 * runtime and rare re-config. Use `IntentionWebSocketClient.bindMarketResolver`
 * or feed messages from another transport into `applyWsMessage`.
 */
export class SimpleMarketResolver implements MarketResolver {
    /** Stores raw fields (for partial-merge) + derived config (for hot path). */
    private readonly entries = new Map<string, { raw: MarketInput; cfg: DerivedConfig }>();

    constructor(markets: MarketInput[] = []) {
        for (const m of markets) {
            this.upsert(m);
        }
    }

    /** Add / replace a market with a COMPLETE config. */
    upsert(market: MarketInput): void {
        this.entries.set(market.symbol, { raw: market, cfg: deriveConfig(market) });
    }

    /**
     * Merge a PARTIAL update into an existing market (WS `trading` push), or
     * create it if the partial is actually complete. Unknown symbol with an
     * incomplete partial is ignored (returns false).
     */
    upsertPartial(symbol: string, partial: Partial<MarketFields>): boolean {
        const existing = this.entries.get(symbol);
        const merged: MarketInput = existing
            ? { ...existing.raw, ...partial, symbol }
            : ({ symbol, ...partial } as MarketInput);
        for (const f of REQUIRED_FIELDS) {
            if (merged[f] == null) {
                return false; // incomplete new market - skip until a full snapshot arrives
            }
        }
        this.entries.set(symbol, { raw: merged, cfg: deriveConfig(merged) });
        return true;
    }

    /**
     * Apply a `v1_markets` WS message: `markets` (snapshot, full) then `trading`
     * (incremental, partial-merge). Returns the number of markets touched.
     */
    applyWsMessage(message: WsMarketsMessage): number {
        let touched = 0;
        if (message.markets) {
            for (const [symbol, m] of Object.entries(message.markets)) {
                if (this.upsertPartial(symbol, m)) touched += 1;
            }
        }
        if (message.trading) {
            for (const [symbol, m] of Object.entries(message.trading)) {
                if (this.upsertPartial(symbol, m)) touched += 1;
            }
        }
        return touched;
    }

    has(symbol: string): boolean {
        return this.entries.has(symbol);
    }

    /** All known market symbols. */
    symbols(): string[] {
        return [...this.entries.keys()];
    }

    private get(symbol: string): DerivedConfig {
        const entry = this.entries.get(symbol);
        if (!entry) {
            throw new Error(
                `unknown market ${JSON.stringify(symbol)} - populate SimpleMarketResolver from market metadata or WS v1_markets`,
            );
        }
        return entry.cfg;
    }

    symbolId(symbol: string): number {
        return this.get(symbol).symbolId;
    }

    toQuantums(symbol: string, size: number | string): bigint {
        const cfg = this.get(symbol);
        let q = floorScaleToBigInt(size, cfg.quantumExp);
        if (cfg.stepBaseQuantums > 0n) {
            q -= q % cfg.stepBaseQuantums; // align down to step_size (engine rejects non-multiples)
        }
        return q;
    }

    toSubticks(symbol: string, price: number | string): bigint {
        const cfg = this.get(symbol);
        let s = floorScaleToBigInt(price, cfg.subtickExp);
        if (cfg.subticksPerTick > 0n) {
            s -= s % cfg.subticksPerTick; // align down to tick_size (engine rejects non-multiples)
        }
        return s;
    }
}

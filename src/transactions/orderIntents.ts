// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * High-level, intent-based order API.
 *
 * What it gives you over the wire types:
 *
 *  - **single vs multi** placement through explicit intent methods, instead of
 *    hand-assembling the 17-positional-argument `DexPlaceOrder` chain.
 *  - one `type` enum (`OrderType`) instead of `order_basic_type` x `condition_type`.
 *  - an explicit `positionSide` for a hedge-mode close, translated into the
 *    engine's existing signed-`quantums` / zero-close-side convention, so no
 *    on-chain change is involved.
 *  - place / close / cancel / modify are **all single/multi symmetric**.
 *
 * Current scope: place, cancel, ordinary replace and conditional replace.
 * Conditional replace uses the dedicated `DexConditionReplaceOrder` wire.
 *
 * Not supported yet: several brackets in one transaction. That needs a per-order
 * `group_role` and `parent_index` on the wire, which has to land on chain and in
 * the producer and every language SDK before this layer can express it.
 *
 * Market-metadata resolution (symbol -> symbol_id, human size -> quantums,
 * human price -> subticks) is abstracted behind {@link MarketResolver}.
 * {@link OrderIntents} remains the pure builder layer; {@link OrderClient}
 * provides submit-only and submit->confirm->decode orchestration.
 */

import { AccountAddress } from "../core/accountAddress";
import {
    Side,
    OrderBasicType,
    TimeInForce,
    ConditionType,
    TriggerPriceType,
    SymbolType,
    OrderPositionMode,
    Grouping,
    StpMode,
    CreatedBy,
    DexOrdersVariant,
} from "../types/enums";
import {
    DexPlaceOrder,
    DexPlaceOrders,
    DexCancelOrder,
    DexReplaceOrder,
    DexConditionReplaceOrder,
    DexOrders,
    DexTx,
    cancelByOrderId,
    cancelByClientOrderId,
    replaceByOrderId,
    replaceByOrderIdWithContext,
    replaceByClientOrderId,
} from "./dexPayloads";
import type { DexCancelTarget, DexReplaceTarget } from "./dexPayloads";
import type { Account } from "../core/account";
import type { Intention } from "../api/intention";
import {
    DexAccountClient,
    RelayerOpenOrdersProvider,
    type DexAccountProvider,
    type DexAccountSnapshot,
    type OpenOrdersProvider,
} from "../api/dexAccountClient";
import type { PendingTransactionResponse, TransactionResponse } from "../api/client";
import {
    RelayerOrderPreflightDataProvider,
    type OrderPreflightDataProvider,
    type OrderPreflightMarketSnapshot,
    type OrderPreflightRequirements,
} from "./orderPreflight";
import {
    decodeTransactionEvents,
    type DecodedDexEvent,
} from "../events/dexEventDecoder";

const DEFAULT_SLIPPAGE_TOLERANCE_PPM = 100_000;

// ============================================================================
// User-facing intent types
// ============================================================================

/** Single-enum order type; maps to `order_basic_type` x `condition_type`. */
export enum OrderType {
    LIMIT = "LIMIT",
    MARKET = "MARKET",
    STOP_LIMIT = "STOP_LIMIT",
    STOP_MARKET = "STOP_MARKET",
    TAKE_PROFIT_LIMIT = "TAKE_PROFIT_LIMIT",
    TAKE_PROFIT_MARKET = "TAKE_PROFIT_MARKET",
}

export type TriggerPriceKind = "MARK_PRICE" | "LAST_PRICE";
export type SizeMode = "fixed" | "close_position";
export type PositionSide = "LONG" | "SHORT";
export type IntentSide = "BUY" | "SELL";
/** Time-in-force values currently supported by the high-level order API. */
export type OrderTimeInForce = TimeInForce.Gtc | TimeInForce.Ioc | TimeInForce.Alo;

/** Human-friendly order input; resolved to wire numerics via {@link MarketResolver}. */
export interface OrderInput {
    symbol: string;
    side: IntentSide;
    type: OrderType;
    /** Base size. Optional for `close_position` sentinel legs. */
    size?: number | string | bigint;
    /** Limit price. Required for `*_LIMIT`. */
    price?: number | string;
    /** Trigger price. Required for `STOP_*` / `TAKE_PROFIT_*`. */
    triggerPrice?: number | string;
    /** Defaults to `MARK_PRICE`. */
    triggerPriceType?: TriggerPriceKind;
    reduceOnly?: boolean;
    /** Defaults per `type` (MARKET -> IOC, others -> GTC). */
    timeInForce?: OrderTimeInForce;
    /** Maker-only limit order. Equivalent to `timeInForce: TimeInForce.Alo`. */
    postOnly?: boolean;
    /** Hedge mode: required (selects long/short leg). Net mode: ignored. */
    positionSide?: PositionSide;
    /** Optional (tracking / idempotency / cancel-by-coid). Never required for grouping. */
    clientOrderId?: string | null;
}

/** A take-profit / stop-loss child leg attached to an entry or a position. */
export interface TpSlLeg {
    type:
        | OrderType.TAKE_PROFIT_MARKET
        | OrderType.STOP_MARKET
        | OrderType.TAKE_PROFIT_LIMIT
        | OrderType.STOP_LIMIT;
    triggerPrice: number | string;
    triggerPriceType?: TriggerPriceKind;
    /** Only for `*_LIMIT`. Attached entry TP/SL uses market execution. */
    price?: number | string;
    clientOrderId?: string | null;
}

/** Reference an existing order for cancel / modify. */
export type OrderRef = { orderId: bigint } | { clientOrderId: string };

/**
 * Modify changes. NOTE: the on-chain `DexReplaceOrder` only supports
 * `quantums` (size) / `subticks` (price) / `new_client_order_id`. Changing
 * trigger price/type is NOT expressible via replace - do cancel+new instead.
 */
export interface ModifyChanges {
    /** Market symbol used to resolve human-readable size/price into wire units. */
    symbol: string;
    price?: number | string;
    size?: number | string;
    newClientOrderId?: string;
}

export interface ClosePositionInput {
    symbol: string;
    positionSide?: PositionSide;
    /** Omit or use `"ALL"` to let {@link OrderClient} load exact on-chain quantums. */
    size?: number | string | bigint | "ALL";
    type?: "MARKET" | "LIMIT";
    price?: number | string;
    clientOrderId?: string | null;
}

export type ClosePositionsInput = Array<ClosePositionInput>;

/**
 * Full-spec conditional order modification.
 *
 * This maps to the chain-side `DexConditionReplaceOrder`, not the ordinary
 * `DexReplaceOrder`. It is intentionally a full spec: callers that want a
 * partial UX should first load the current condition order and fill unchanged
 * fields before submitting.
 */
export interface ModifyConditionChanges {
    symbol: string;
    type:
        | OrderType.STOP_MARKET
        | OrderType.STOP_LIMIT
        | OrderType.TAKE_PROFIT_MARKET
        | OrderType.TAKE_PROFIT_LIMIT;
    /** `fixed` requires `size`; `close_position` emits quantums=0 for whole-position targets. */
    sizeMode?: SizeMode;
    size?: number | string | bigint;
    /** Required for `*_LIMIT`; rejected for `*_MARKET`. */
    price?: number | string | bigint;
    triggerPrice: number | string | bigint;
    triggerPriceType?: TriggerPriceKind;
    newClientOrderId?: string | null;
    /** Current target mode, when known. A condition replace cannot change this mode. */
    currentSizeMode?: SizeMode;
}

/** A group for `placeOrders` (batch / multi). */
export type OrderGroup =
    | { kind: "single"; order: OrderInput }
    | { kind: "bracket"; entry: OrderInput; tp?: TpSlLeg; sl?: TpSlLeg }
    | {
          kind: "positionTpSl";
          symbol: string;
          positionSide?: PositionSide;
          sizeMode: SizeMode;
          configAmount?: number | string;
          tp?: TpSlLeg;
          sl?: TpSlLeg;
      };

/**
 * Market-metadata resolver. The SDK/caller injects this (needs listing config:
 * tick size, step size, symbol ids). Kept as an interface so this module stays
 * pure + testable and does not couple to any specific metadata source.
 */
export interface MarketResolver {
    symbolId(symbol: string): number;
    /** Human base size -> absolute quantums (sign applied by {@link encodeLegSelection}). */
    toQuantums(symbol: string, size: number | string): bigint;
    /** Human price -> subticks. */
    toSubticks(symbol: string, price: number | string): bigint;
}

/** Context for the intent builder. */
export interface OrderIntentsContext {
    subAddress: AccountAddress;
    positionMode: OrderPositionMode;
    resolver: MarketResolver;
    /** Defaults to `SymbolType.Perpetual`. */
    symbolType?: SymbolType;
    /** Market-order slippage tolerance (ppm). Defaults to chain default 100_000. */
    slippageTolerancePpm?: number;
    /** Defaults to `StpMode.ExpireMaker`. */
    stpMode?: StpMode;
}

export type OrderValidationSeverity = "error" | "warning";

export type OrderValidationCode =
    | "UNKNOWN_MARKET"
    | "REQUIRED_POSITION_SIDE"
    | "REQUIRED_SIZE"
    | "INVALID_SIZE"
    | "SIZE_MUST_BE_POSITIVE"
    | "REQUIRED_LIMIT_PRICE"
    | "REQUIRED_TRIGGER_PRICE"
    | "INVALID_PRICE"
    | "PRICE_MUST_BE_POSITIVE"
    | "UNEXPECTED_LIMIT_PRICE"
    | "UNEXPECTED_TRIGGER_PRICE"
    | "INVALID_TP_ORDER_TYPE"
    | "INVALID_SL_ORDER_TYPE"
    | "CANNOT_SET_TP_LIMIT_WITHOUT_TP"
    | "CANNOT_SET_SL_LIMIT_WITHOUT_SL"
    | "TPSL_LIMIT_NOT_SUPPORTED"
    | "INVALID_BRACKET_ENTRY"
    | "REDUCE_ONLY_CANNOT_HAVE_TPSL"
    | "REQUIRED_TPSL"
    | "TAKE_PROFIT_PRICE_MUST_ABOVE_REF"
    | "TAKE_PROFIT_PRICE_MUST_BELOW_REF"
    | "STOP_ORDER_PRICE_MUST_ABOVE_REF"
    | "STOP_ORDER_PRICE_MUST_BELOW_REF"
    | "CONDITION_LIMIT_PRICE_DEVIATION"
    | "REFERENCE_PRICE_UNAVAILABLE"
    | "REFERENCE_PRICE_STALE"
    | "PREFLIGHT_PROVIDER_UNAVAILABLE"
    | "PREFLIGHT_DATA_UNAVAILABLE"
    | "POST_ONLY_REQUIRES_LIMIT"
    | "POST_ONLY_TIF_CONFLICT";

/** Stable SDK-level validation result; UI clients may localize it by `code`. */
export interface OrderValidationIssue {
    code: OrderValidationCode;
    severity: OrderValidationSeverity;
    message: string;
    field?: string;
    groupIndex?: number;
    symbol?: string;
    actual?: string;
    expected?: string;
    referencePriceType?: "MARK_PRICE" | "LAST_PRICE" | "MID_PRICE" | "LIMIT_PRICE";
    referencePrice?: string;
}

/** One or more order checks failed before transaction submission. */
export class OrderPreflightError extends Error {
    constructor(public readonly issues: OrderValidationIssue[]) {
        super(issues[0]?.message ?? "Order preflight failed");
        this.name = "OrderPreflightError";
    }
}

function validationIssue(
    code: OrderValidationCode,
    message: string,
    details: Omit<OrderValidationIssue, "code" | "severity" | "message"> = {},
): OrderValidationIssue {
    return { code, severity: "error", message, ...details };
}

function isConditionalOrderType(type: OrderType): boolean {
    return (
        type === OrderType.STOP_LIMIT ||
        type === OrderType.STOP_MARKET ||
        type === OrderType.TAKE_PROFIT_LIMIT ||
        type === OrderType.TAKE_PROFIT_MARKET
    );
}

function isLimitOrderType(type: OrderType): boolean {
    return (
        type === OrderType.LIMIT ||
        type === OrderType.STOP_LIMIT ||
        type === OrderType.TAKE_PROFIT_LIMIT
    );
}

function isTakeProfitOrderType(type: OrderType): boolean {
    return type === OrderType.TAKE_PROFIT_LIMIT || type === OrderType.TAKE_PROFIT_MARKET;
}

function isStopLossOrderType(type: OrderType): boolean {
    return type === OrderType.STOP_LIMIT || type === OrderType.STOP_MARKET;
}

function withGroupIndex(
    issues: OrderValidationIssue[],
    groupIndex: number,
): OrderValidationIssue[] {
    return issues.map((issue) => ({ ...issue, groupIndex }));
}

// ============================================================================
// Pure mapping helpers (fully implemented - unit-testable, no I/O)
// ============================================================================

/** `type` single-enum -> engine `order_basic_type` x `condition_type`. */
export function orderTypeToBasics(t: OrderType): {
    basicType: OrderBasicType;
    conditionType: ConditionType;
} {
    switch (t) {
        case OrderType.LIMIT:
            return { basicType: OrderBasicType.Limit, conditionType: ConditionType.Unspecified };
        case OrderType.MARKET:
            return { basicType: OrderBasicType.Market, conditionType: ConditionType.Unspecified };
        case OrderType.STOP_LIMIT:
            return { basicType: OrderBasicType.Limit, conditionType: ConditionType.StopLoss };
        case OrderType.STOP_MARKET:
            return { basicType: OrderBasicType.Market, conditionType: ConditionType.StopLoss };
        case OrderType.TAKE_PROFIT_LIMIT:
            return { basicType: OrderBasicType.Limit, conditionType: ConditionType.TakeProfit };
        case OrderType.TAKE_PROFIT_MARKET:
            return { basicType: OrderBasicType.Market, conditionType: ConditionType.TakeProfit };
        default: {
            const _exhaustive: never = t;
            throw new Error(`unknown OrderType: ${String(_exhaustive)}`);
        }
    }
}

/**
 * The unification point: translate an intent (side / positionSide) + absolute
 * quantums into the engine's `Side` + signed `quantums` convention. This mirrors
 * the on-chain `fill_direction` and the trading-web `closePositionDirection`
 * logic (deduped into one place for all-language SDK reuse).
 *
 * - Hedge: side = reduceOnly ? Sell : Buy; quantums sign = LONG ? + : - .
 *   For whole-position close sentinels (`quantums=0`), sign cannot carry leg
 *   selection, so the chain uses side instead: Sell = close long, Buy = close short.
 * - Net:   side by direction; quantums positive.
 */
export function encodeLegSelection(args: {
    positionMode: OrderPositionMode;
    intentSide: IntentSide;
    reduceOnly: boolean;
    positionSide?: PositionSide;
    absQuantums: bigint;
}): { side: Side; quantums: bigint } {
    const abs = args.absQuantums < 0n ? -args.absQuantums : args.absQuantums;
    if (args.positionMode === OrderPositionMode.Hedge) {
        if (!args.positionSide) {
            throw new Error("Hedge mode requires positionSide ('LONG' | 'SHORT')");
        }
        const side =
            args.reduceOnly && abs === 0n && args.positionSide === "SHORT"
                ? Side.Buy
                : args.reduceOnly
                  ? Side.Sell
                  : Side.Buy;
        const quantums = args.positionSide === "LONG" ? abs : -abs;
        return { side, quantums };
    }
    return { side: args.intentSide === "BUY" ? Side.Buy : Side.Sell, quantums: abs };
}

/** Default TIF by `type` unless explicitly overridden. */
export function resolveTimeInForce(
    type: OrderType,
    tif?: OrderTimeInForce,
    postOnly = false,
): TimeInForce {
    if (tif != null && typeof tif !== "number") {
        throw new Error("timeInForce must use the TimeInForce enum");
    }
    if (
        tif != null &&
        tif !== TimeInForce.Gtc &&
        tif !== TimeInForce.Ioc &&
        tif !== TimeInForce.Alo
    ) {
        throw new Error("high-level order API supports only GTC, IOC, and ALO");
    }
    if (postOnly && tif === TimeInForce.Ioc) {
        throw new Error("postOnly cannot be combined with IOC");
    }
    if (
        (postOnly || tif === TimeInForce.Alo) &&
        orderTypeToBasics(type).basicType !== OrderBasicType.Limit
    ) {
        throw new Error("postOnly/ALO is only supported for limit orders");
    }
    if (postOnly || tif === TimeInForce.Alo) return TimeInForce.Alo;
    if (tif != null) return tif;
    return orderTypeToBasics(type).basicType === OrderBasicType.Market
        ? TimeInForce.Ioc
        : TimeInForce.Gtc;
}

function toTriggerPriceType(kind?: TriggerPriceKind): TriggerPriceType {
    return (kind ?? "MARK_PRICE") === "MARK_PRICE"
        ? TriggerPriceType.MarkPrice
        : TriggerPriceType.LastPrice;
}

function resolveIntentQuantums(
    resolver: MarketResolver,
    symbol: string,
    size: number | string | bigint,
): bigint {
    return typeof size === "bigint" ? size : resolver.toQuantums(symbol, size);
}

function resolveIntentSubticks(
    resolver: MarketResolver,
    symbol: string,
    price: number | string | bigint,
): bigint {
    return typeof price === "bigint" ? price : resolver.toSubticks(symbol, price);
}

/** `OrderRef` -> cancel target (order_id or client_order_id). */
export function cancelTargetFromRef(ref: OrderRef): DexCancelTarget {
    return "orderId" in ref ? cancelByOrderId(ref.orderId) : cancelByClientOrderId(ref.clientOrderId);
}

/** `OrderRef` -> replace target. */
export function replaceTargetFromRef(
    ref: OrderRef,
    symbolId?: number,
    symbolType: SymbolType = SymbolType.Perpetual,
): DexReplaceTarget {
    return "orderId" in ref
        ? symbolId === undefined
            ? replaceByOrderId(ref.orderId)
            : replaceByOrderIdWithContext(ref.orderId, symbolId, symbolType)
        : replaceByClientOrderId(ref.clientOrderId);
}

// ============================================================================
// OrderIntents - high-level intent methods (return wire-ready DexOrders)
// ============================================================================

/**
 * Builds wire-ready `DexOrders` from high-level intents. Pure (no network):
 * wrap the result in `DexTx` via {@link toDexTx} then sign+submit with the
 * existing `Intention.transaction` helpers.
 */
export class OrderIntents {
    private readonly ctx: OrderIntentsContext;

    constructor(ctx: OrderIntentsContext) {
        this.ctx = ctx;
    }

    private get symbolType(): SymbolType {
        return this.ctx.symbolType ?? SymbolType.Perpetual;
    }

    private get slippagePpm(): number {
        return this.ctx.slippageTolerancePpm ?? DEFAULT_SLIPPAGE_TOLERANCE_PPM;
    }

    private get stpMode(): StpMode {
        return this.ctx.stpMode ?? StpMode.ExpireMaker;
    }

    // ---- local preflight ---------------------------------------------------

    private validateKnownSymbol(symbol: string): OrderValidationIssue[] {
        try {
            this.ctx.resolver.symbolId(symbol);
            return [];
        } catch (error) {
            return [
                validationIssue(
                    "UNKNOWN_MARKET",
                    error instanceof Error ? error.message : `Unknown market ${symbol}`,
                    { field: "symbol", symbol, actual: symbol },
                ),
            ];
        }
    }

    private validatePositiveSize(
        symbol: string,
        size: number | string | bigint | undefined,
        field = "size",
    ): OrderValidationIssue[] {
        if (size == null || (typeof size === "string" && size.trim() === "")) {
            return [
                validationIssue("REQUIRED_SIZE", "Order size is required", {
                    field,
                    symbol,
                }),
            ];
        }
        try {
            if (resolveIntentQuantums(this.ctx.resolver, symbol, size) <= 0n) {
                return [
                    validationIssue("SIZE_MUST_BE_POSITIVE", "Order size must be positive", {
                        field,
                        symbol,
                        actual: String(size),
                        expected: "> 0",
                    }),
                ];
            }
        } catch (error) {
            return [
                validationIssue(
                    "INVALID_SIZE",
                    error instanceof Error ? error.message : "Invalid order size",
                    { field, symbol, actual: String(size) },
                ),
            ];
        }
        return [];
    }

    private validatePositivePrice(
        symbol: string,
        price: number | string | undefined,
        field: string,
        missingCode: OrderValidationCode,
        missingMessage: string,
    ): OrderValidationIssue[] {
        if (price == null || (typeof price === "string" && price.trim() === "")) {
            return [validationIssue(missingCode, missingMessage, { field, symbol })];
        }
        try {
            if (this.ctx.resolver.toSubticks(symbol, price) <= 0n) {
                return [
                    validationIssue("PRICE_MUST_BE_POSITIVE", "Price must be positive", {
                        field,
                        symbol,
                        actual: String(price),
                        expected: "> 0",
                    }),
                ];
            }
        } catch (error) {
            return [
                validationIssue(
                    "INVALID_PRICE",
                    error instanceof Error ? error.message : "Invalid price",
                    { field, symbol, actual: String(price) },
                ),
            ];
        }
        return [];
    }

    private validateOrderInput(order: OrderInput): OrderValidationIssue[] {
        const issues = this.validateKnownSymbol(order.symbol);
        if (issues.length > 0) return issues;

        if (this.ctx.positionMode === OrderPositionMode.Hedge && order.positionSide == null) {
            issues.push(
                validationIssue(
                    "REQUIRED_POSITION_SIDE",
                    "Hedge mode requires positionSide ('LONG' | 'SHORT')",
                    { field: "positionSide", symbol: order.symbol },
                ),
            );
        }
        issues.push(...this.validatePositiveSize(order.symbol, order.size));

        if (
            (order.postOnly || order.timeInForce === TimeInForce.Alo) &&
            orderTypeToBasics(order.type).basicType !== OrderBasicType.Limit
        ) {
            issues.push(
                validationIssue(
                    "POST_ONLY_REQUIRES_LIMIT",
                    "postOnly/ALO is only supported for limit orders",
                    { field: order.postOnly ? "postOnly" : "timeInForce", symbol: order.symbol },
                ),
            );
        }
        if (order.postOnly && order.timeInForce === TimeInForce.Ioc) {
            issues.push(
                validationIssue(
                    "POST_ONLY_TIF_CONFLICT",
                    "postOnly cannot be combined with IOC",
                    { field: "timeInForce", symbol: order.symbol },
                ),
            );
        }

        if (isLimitOrderType(order.type)) {
            issues.push(
                ...this.validatePositivePrice(
                    order.symbol,
                    order.price,
                    "price",
                    "REQUIRED_LIMIT_PRICE",
                    "Limit order price is required",
                ),
            );
        }

        if (isConditionalOrderType(order.type)) {
            const missingTrigger =
                order.triggerPrice == null ||
                (typeof order.triggerPrice === "string" && order.triggerPrice.trim() === "");
            if (missingTrigger && isLimitOrderType(order.type) && order.price != null) {
                const takeProfit = isTakeProfitOrderType(order.type);
                issues.push(
                    validationIssue(
                        takeProfit
                            ? "CANNOT_SET_TP_LIMIT_WITHOUT_TP"
                            : "CANNOT_SET_SL_LIMIT_WITHOUT_SL",
                        `Cannot set ${takeProfit ? "TP" : "SL"} limit price without setting the trigger condition`,
                        { field: "triggerPrice", symbol: order.symbol },
                    ),
                );
            } else {
                issues.push(
                    ...this.validatePositivePrice(
                        order.symbol,
                        order.triggerPrice,
                        "triggerPrice",
                        "REQUIRED_TRIGGER_PRICE",
                        "Trigger price is required",
                    ),
                );
            }
            if (!isLimitOrderType(order.type) && order.price != null) {
                issues.push(
                    validationIssue(
                        "UNEXPECTED_LIMIT_PRICE",
                        "Conditional market orders cannot set a limit price",
                        { field: "price", symbol: order.symbol, actual: String(order.price) },
                    ),
                );
            }
        } else if (order.triggerPrice != null) {
            issues.push(
                validationIssue(
                    "UNEXPECTED_TRIGGER_PRICE",
                    "Non-conditional orders cannot set triggerPrice",
                    {
                        field: "triggerPrice",
                        symbol: order.symbol,
                        actual: String(order.triggerPrice),
                    },
                ),
            );
        }
        return issues;
    }

    private validateTpSlLeg(
        symbol: string,
        kind: "tp" | "sl",
        leg: TpSlLeg,
        allowLimit: boolean,
    ): OrderValidationIssue[] {
        const issues: OrderValidationIssue[] = [];
        const typeMatches =
            kind === "tp" ? isTakeProfitOrderType(leg.type) : isStopLossOrderType(leg.type);
        if (!typeMatches) {
            issues.push(
                validationIssue(
                    kind === "tp" ? "INVALID_TP_ORDER_TYPE" : "INVALID_SL_ORDER_TYPE",
                    `${kind.toUpperCase()} leg has an incompatible order type`,
                    { field: `${kind}.type`, symbol, actual: leg.type },
                ),
            );
        }
        const missingTrigger =
            leg.triggerPrice == null ||
            (typeof leg.triggerPrice === "string" && leg.triggerPrice.trim() === "");
        if (missingTrigger && leg.price != null) {
            issues.push(
                validationIssue(
                    kind === "tp"
                        ? "CANNOT_SET_TP_LIMIT_WITHOUT_TP"
                        : "CANNOT_SET_SL_LIMIT_WITHOUT_SL",
                    `Cannot set ${kind.toUpperCase()} limit price without setting the trigger condition`,
                    { field: `${kind}.triggerPrice`, symbol },
                ),
            );
        } else {
            issues.push(
                ...this.validatePositivePrice(
                    symbol,
                    leg.triggerPrice,
                    `${kind}.triggerPrice`,
                    "REQUIRED_TRIGGER_PRICE",
                    `${kind.toUpperCase()} trigger price is required`,
                ),
            );
        }
        if (isLimitOrderType(leg.type)) {
            if (!allowLimit) {
                issues.push(
                    validationIssue(
                        "TPSL_LIMIT_NOT_SUPPORTED",
                        "Attached order TP/SL supports market legs only",
                        { field: `${kind}.type`, symbol, actual: leg.type },
                    ),
                );
            }
            issues.push(
                ...this.validatePositivePrice(
                    symbol,
                    leg.price,
                    `${kind}.price`,
                    "REQUIRED_LIMIT_PRICE",
                    `${kind.toUpperCase()} limit price is required`,
                ),
            );
        } else if (leg.price != null) {
            issues.push(
                validationIssue(
                    "UNEXPECTED_LIMIT_PRICE",
                    `Cannot set ${kind.toUpperCase()} limit price for a market leg`,
                    { field: `${kind}.price`, symbol, actual: String(leg.price) },
                ),
            );
        }
        return issues;
    }

    private entryOpensLong(entry: OrderInput): boolean {
        if (this.ctx.positionMode === OrderPositionMode.Hedge && entry.positionSide != null) {
            return entry.positionSide === "LONG";
        }
        return entry.side === "BUY";
    }

    private validateLegAgainstReference(args: {
        symbol: string;
        kind: "tp" | "sl";
        triggerPrice: number | string;
        referencePrice: number | string;
        referencePriceType: "LIMIT_PRICE" | "MID_PRICE";
        opensLong: boolean;
    }): OrderValidationIssue[] {
        let trigger: bigint;
        let reference: bigint;
        try {
            trigger = this.ctx.resolver.toSubticks(args.symbol, args.triggerPrice);
            reference = this.ctx.resolver.toSubticks(args.symbol, args.referencePrice);
        } catch {
            return [];
        }
        const valid =
            args.kind === "tp"
                ? args.opensLong
                    ? trigger >= reference
                    : trigger <= reference
                : args.opensLong
                  ? trigger <= reference
                  : trigger >= reference;
        if (valid) return [];
        const direction =
            args.kind === "tp"
                ? args.opensLong
                    ? "higher than or equal to"
                    : "lower than or equal to"
                : args.opensLong
                  ? "lower than or equal to"
                  : "higher than or equal to";
        return [
            validationIssue(
                args.kind === "tp"
                    ? args.opensLong
                        ? "TAKE_PROFIT_PRICE_MUST_ABOVE_REF"
                        : "TAKE_PROFIT_PRICE_MUST_BELOW_REF"
                    : args.opensLong
                      ? "STOP_ORDER_PRICE_MUST_BELOW_REF"
                      : "STOP_ORDER_PRICE_MUST_ABOVE_REF",
                `${args.kind.toUpperCase()} trigger price must be ${direction} the reference price`,
                {
                    field: `${args.kind}.triggerPrice`,
                    symbol: args.symbol,
                    actual: String(args.triggerPrice),
                    expected: `${direction} ${String(args.referencePrice)}`,
                    referencePriceType: args.referencePriceType,
                    referencePrice: String(args.referencePrice),
                },
            ),
        ];
    }

    /** Validate one standalone order without performing network requests. */
    validateOrder(order: OrderInput): OrderValidationIssue[] {
        return this.validateOrderInput(order);
    }

    /** Validate an entry + attached TP/SL without performing network requests. */
    validateOrderWithTpSl(
        entry: OrderInput,
        tpsl: { tp?: TpSlLeg; sl?: TpSlLeg },
    ): OrderValidationIssue[] {
        const issues = this.validateOrderInput(entry);
        if (isConditionalOrderType(entry.type)) {
            issues.push(
                validationIssue(
                    "INVALID_BRACKET_ENTRY",
                    "Attached TP/SL requires a LIMIT or MARKET entry order",
                    { field: "type", symbol: entry.symbol, actual: entry.type },
                ),
            );
        }
        if (entry.reduceOnly) {
            issues.push(
                validationIssue(
                    "REDUCE_ONLY_CANNOT_HAVE_TPSL",
                    "Reduce-only entry orders cannot have attached TP/SL",
                    { field: "reduceOnly", symbol: entry.symbol },
                ),
            );
        }
        if (!tpsl.tp && !tpsl.sl) {
            issues.push(
                validationIssue("REQUIRED_TPSL", "At least one TP or SL leg is required", {
                    symbol: entry.symbol,
                }),
            );
        }
        if (tpsl.tp) issues.push(...this.validateTpSlLeg(entry.symbol, "tp", tpsl.tp, false));
        if (tpsl.sl) issues.push(...this.validateTpSlLeg(entry.symbol, "sl", tpsl.sl, false));

        if (entry.type === OrderType.LIMIT && entry.price != null) {
            const opensLong = this.entryOpensLong(entry);
            if (tpsl.tp) {
                issues.push(
                    ...this.validateLegAgainstReference({
                        symbol: entry.symbol,
                        kind: "tp",
                        triggerPrice: tpsl.tp.triggerPrice,
                        referencePrice: entry.price,
                        referencePriceType: "LIMIT_PRICE",
                        opensLong,
                    }),
                );
            }
            if (tpsl.sl) {
                issues.push(
                    ...this.validateLegAgainstReference({
                        symbol: entry.symbol,
                        kind: "sl",
                        triggerPrice: tpsl.sl.triggerPrice,
                        referencePrice: entry.price,
                        referencePriceType: "LIMIT_PRICE",
                        opensLong,
                    }),
                );
            }
        }
        return issues;
    }

    /** Validate position TP/SL shape without performing network requests. */
    validatePositionTpSl(args: {
        symbol: string;
        positionSide?: PositionSide;
        sizeMode: SizeMode;
        configAmount?: number | string;
        tp?: TpSlLeg;
        sl?: TpSlLeg;
    }): OrderValidationIssue[] {
        const issues = this.validateKnownSymbol(args.symbol);
        if (issues.length > 0) return issues;
        if (this.ctx.positionMode === OrderPositionMode.Hedge && args.positionSide == null) {
            issues.push(
                validationIssue(
                    "REQUIRED_POSITION_SIDE",
                    "Hedge mode requires positionSide ('LONG' | 'SHORT')",
                    { field: "positionSide", symbol: args.symbol },
                ),
            );
        }
        if (args.sizeMode === "fixed") {
            issues.push(
                ...this.validatePositiveSize(args.symbol, args.configAmount, "configAmount"),
            );
        }
        if (!args.tp && !args.sl) {
            issues.push(
                validationIssue("REQUIRED_TPSL", "At least one TP or SL leg is required", {
                    symbol: args.symbol,
                }),
            );
        }
        if (args.tp) issues.push(...this.validateTpSlLeg(args.symbol, "tp", args.tp, true));
        if (args.sl) issues.push(...this.validateTpSlLeg(args.symbol, "sl", args.sl, true));
        return issues;
    }

    /** Validate all groups and annotate issues with their group index. */
    validateOrders(groups: OrderGroup[]): OrderValidationIssue[] {
        return groups.flatMap((group, groupIndex) => {
            const issues =
                group.kind === "single"
                    ? this.validateOrder(group.order)
                    : group.kind === "bracket"
                      ? this.validateOrderWithTpSl(group.entry, group)
                      : this.validatePositionTpSl(group);
            return withGroupIndex(issues, groupIndex);
        });
    }

    private assertValid(issues: OrderValidationIssue[]): void {
        if (issues.length > 0) throw new OrderPreflightError(issues);
    }

    // ---- internal builders -------------------------------------------------

    /** Resolve one `OrderInput` into a `DexPlaceOrder`. */
    private buildPlaceOrder(order: OrderInput, forceReduceOnly?: boolean): DexPlaceOrder {
        const { basicType, conditionType } = orderTypeToBasics(order.type);
        const symbolId = this.ctx.resolver.symbolId(order.symbol);
        const absQuantums =
            order.size != null ? resolveIntentQuantums(this.ctx.resolver, order.symbol, order.size) : 0n;
        const subticks =
            order.price != null ? this.ctx.resolver.toSubticks(order.symbol, order.price) : 0n;
        const triggerSubticks =
            order.triggerPrice != null
                ? this.ctx.resolver.toSubticks(order.symbol, order.triggerPrice)
                : 0n;
        const reduceOnly = forceReduceOnly ?? order.reduceOnly ?? false;
        const { side, quantums } = encodeLegSelection({
            positionMode: this.ctx.positionMode,
            intentSide: order.side,
            reduceOnly,
            positionSide: order.positionSide,
            absQuantums,
        });

        return new DexPlaceOrder(
            this.ctx.subAddress,
            symbolId,
            this.symbolType,
            side,
            quantums,
            subticks,
            triggerSubticks,
            basicType,
            resolveTimeInForce(order.type, order.timeInForce, order.postOnly),
            conditionType,
            toTriggerPriceType(order.triggerPriceType),
            0n, // target_order_id - unused for TP/SL linking on this wire
            reduceOnly,
            this.ctx.positionMode,
            this.slippagePpm,
            order.clientOrderId ?? null,
            this.stpMode,
        );
    }

    /** Build a TP/SL child leg that closes `entry`'s position (RO, reversed side). */
    private buildChildLeg(entry: OrderInput, leg: TpSlLeg): DexPlaceOrder {
        const childSide: IntentSide = entry.side === "BUY" ? "SELL" : "BUY";
        return this.buildPlaceOrder(
            {
                symbol: entry.symbol,
                side: childSide,
                type: leg.type,
                // Attached TP/SL nominal size equals the entry input size.
                size: entry.size,
                price: leg.price,
                triggerPrice: leg.triggerPrice,
                triggerPriceType: leg.triggerPriceType,
                positionSide: entry.positionSide,
                clientOrderId: leg.clientOrderId ?? null,
            },
            /* forceReduceOnly */ true,
        );
    }

    /** Build a position-area TP/SL leg (standalone OCO; sentinel/close_position). */
    private buildPositionLeg(
        symbol: string,
        positionSide: PositionSide | undefined,
        sizeMode: SizeMode,
        configAmount: number | string | undefined,
        leg: TpSlLeg,
    ): DexPlaceOrder {
        // close_position -> quantums=0 sentinel (engine resolves at trigger).
        // In zero-close mode, side selects the leg because zero has no sign.
        // fixed          -> configAmount.
        const size = sizeMode === "fixed" ? configAmount : undefined;
        const side: IntentSide =
            positionSide === "SHORT" ? "BUY" : "SELL";
        return this.buildPlaceOrder(
            {
                symbol,
                side,
                type: leg.type,
                size,
                price: leg.price,
                triggerPrice: leg.triggerPrice,
                triggerPriceType: leg.triggerPriceType,
                positionSide,
                clientOrderId: leg.clientOrderId ?? null,
            },
            /* forceReduceOnly */ true,
        );
    }

    private buildGroup(group: OrderGroup): DexPlaceOrders {
        switch (group.kind) {
            case "single":
                return new DexPlaceOrders([this.buildPlaceOrder(group.order)], Grouping.NA);
            case "bracket": {
                const orders: DexPlaceOrder[] = [this.buildPlaceOrder(group.entry)];
                if (group.tp) orders.push(this.buildChildLeg(group.entry, group.tp));
                if (group.sl) orders.push(this.buildChildLeg(group.entry, group.sl));
                return new DexPlaceOrders(orders, Grouping.NormalTPSL);
            }
            case "positionTpSl": {
                const orders: DexPlaceOrder[] = [];
                if (group.tp)
                    orders.push(
                        this.buildPositionLeg(
                            group.symbol,
                            group.positionSide,
                            group.sizeMode,
                            group.configAmount,
                            group.tp,
                        ),
                    );
                if (group.sl)
                    orders.push(
                        this.buildPositionLeg(
                            group.symbol,
                            group.positionSide,
                            group.sizeMode,
                            group.configAmount,
                            group.sl,
                        ),
                    );
                return new DexPlaceOrders(orders, Grouping.PositionTPSL);
            }
            default: {
                const _exhaustive: never = group;
                throw new Error(`unknown OrderGroup: ${String(_exhaustive)}`);
            }
        }
    }

    // ---- Place -------------------------------------------------------------

    /** Single order or standalone conditional order. */
    placeOrder(order: OrderInput): DexOrders {
        this.assertValid(this.validateOrder(order));
        return new DexOrders(DexOrdersVariant.Place, [
            new DexPlaceOrders([this.buildPlaceOrder(order)], Grouping.NA),
        ]);
    }

    /** Entry order with an attached TP/SL bracket. */
    placeOrderWithTpSl(entry: OrderInput, tpsl: { tp?: TpSlLeg; sl?: TpSlLeg }): DexOrders {
        this.assertValid(this.validateOrderWithTpSl(entry, tpsl));
        return new DexOrders(DexOrdersVariant.Place, [
            this.buildGroup({ kind: "bracket", entry, tp: tpsl.tp, sl: tpsl.sl }),
        ]);
    }

    /** Whole-position or fixed-size TP/SL; both legs form an OCO pair. */
    placePositionTpSl(args: {
        symbol: string;
        positionSide?: PositionSide;
        sizeMode: SizeMode;
        configAmount?: number | string;
        tp?: TpSlLeg;
        sl?: TpSlLeg;
    }): DexOrders {
        this.assertValid(this.validatePositionTpSl(args));
        return new DexOrders(DexOrdersVariant.Place, [
            this.buildGroup({ kind: "positionTpSl", ...args }),
        ]);
    }

    /**
     * Batch / multi-group placement: one bracket or position group per
     * `OrderGroup`, using the existing grouping. Several brackets in one
     * transaction would need a per-order group_role and parent_index on the wire.
     */
    placeOrders(groups: OrderGroup[]): DexOrders {
        this.assertValid(this.validateOrders(groups));
        return new DexOrders(
            DexOrdersVariant.Place,
            groups.map((g) => this.buildGroup(g)),
        );
    }

    // ---- Close (Hedge-aware via positionSide) ------------------------------

    /** Close a position (Net or Hedge). Hedge requires `positionSide`. */
    closePosition(args: ClosePositionInput): DexOrders {
        const isFull = args.size == null || args.size === "ALL";
        if (isFull) {
            throw new Error(
                "Full close requires current position quantums; use OrderClient.closePosition() or pass an explicit size",
            );
        }
        // Net close side: LONG -> SELL, SHORT -> BUY. Hedge: side forced to SELL by encodeLegSelection.
        const intentSide: IntentSide = args.positionSide === "SHORT" ? "BUY" : "SELL";
        const order: OrderInput = {
            symbol: args.symbol,
            side: intentSide,
            type: (args.type ?? "MARKET") === "LIMIT" ? OrderType.LIMIT : OrderType.MARKET,
            size: args.size as number | string | bigint,
            price: args.price,
            positionSide: args.positionSide,
            reduceOnly: true,
            clientOrderId: args.clientOrderId ?? null,
        };
        return new DexOrders(DexOrdersVariant.Place, [
            new DexPlaceOrders([this.buildPlaceOrder(order, /* forceReduceOnly */ true)], Grouping.NA),
        ]);
    }

    /** Batch close (e.g. close-all across positions). */
    closePositions(list: ClosePositionsInput): DexOrders {
        const groups = list.map((c) => {
            const isFull = c.size == null || c.size === "ALL";
            if (isFull) {
                throw new Error(
                    "Full close requires current position quantums; use OrderClient.closePositions() or pass explicit sizes",
                );
            }
            const intentSide: IntentSide = c.positionSide === "SHORT" ? "BUY" : "SELL";
            const order: OrderInput = {
                symbol: c.symbol,
                side: intentSide,
                type: (c.type ?? "MARKET") === "LIMIT" ? OrderType.LIMIT : OrderType.MARKET,
                size: c.size as number | string | bigint,
                price: c.price,
                positionSide: c.positionSide,
                reduceOnly: true,
            };
            return new DexPlaceOrders([this.buildPlaceOrder(order, true)], Grouping.NA);
        });
        return new DexOrders(DexOrdersVariant.Place, groups);
    }

    // ---- Cancel (single / multi symmetric) ---------------------------------

    cancelOrder(ref: OrderRef): DexOrders {
        return new DexOrders(DexOrdersVariant.Cancel, [
            new DexCancelOrder(this.ctx.subAddress, cancelTargetFromRef(ref), this.symbolType),
        ]);
    }

    cancelOrders(refs: OrderRef[]): DexOrders {
        return new DexOrders(
            DexOrdersVariant.Cancel,
            refs.map(
                (r) => new DexCancelOrder(this.ctx.subAddress, cancelTargetFromRef(r), this.symbolType),
            ),
        );
    }

    /**
     * Cancel all open orders.
     *
     * There is no single "cancel-all" operation on this wire, so the refs have
     * to be discovered first and expanded into a `cancelOrders(refs)` batch.
     * This builder layer takes the prefetched refs; `OrderClient.cancelAll()`
     * does the discovery for you.
     */
    cancelAll(openOrderRefs: OrderRef[]): DexOrders {
        return this.cancelOrders(openOrderRefs);
    }

    /**
     * Same as {@link cancelAll}, for callers that discovered the refs of one
     * symbol. `symbol` is accepted for call-site clarity only: the refs passed
     * in are already the ones to cancel. `OrderClient.cancelAllForSymbol()`
     * filters during discovery.
     */
    cancelAllForSymbol(_symbol: string, openOrderRefs: OrderRef[]): DexOrders {
        return this.cancelOrders(openOrderRefs);
    }

    // ---- Modify (single / multi symmetric) ---------------------------------

    /**
     * Modify an order (price/size/new coid). NOTE: trigger price/type changes are
     * handled by `modifyConditionOrder`, which uses a separate chain wire.
     */
    modifyOrder(ref: OrderRef, changes: ModifyChanges): DexOrders {
        return new DexOrders(DexOrdersVariant.Replace, [this.buildReplace(ref, changes)]);
    }

    modifyOrders(list: Array<{ ref: OrderRef; changes: ModifyChanges }>): DexOrders {
        return new DexOrders(
            DexOrdersVariant.Replace,
            list.map((m) => this.buildReplace(m.ref, m.changes)),
        );
    }

    private buildReplace(ref: OrderRef, changes: ModifyChanges): DexReplaceOrder {
        const quantums =
            changes.size == null
                ? undefined
                : resolveIntentQuantums(this.ctx.resolver, changes.symbol, changes.size);
        const subticks =
            changes.price == null
                ? undefined
                : resolveIntentSubticks(this.ctx.resolver, changes.symbol, changes.price);
        return new DexReplaceOrder(
            this.ctx.subAddress,
            replaceTargetFromRef(
                ref,
                this.ctx.resolver.symbolId(changes.symbol),
                this.symbolType,
            ),
            quantums,
            subticks,
            changes.newClientOrderId ?? null,
        );
    }

    /**
     * Modify a pre-trigger conditional order using the dedicated full-spec wire.
     *
     * The target must still live in the chain conditional store. Triggered limit
     * orders become ordinary book orders and should use `modifyOrder` instead.
     */
    modifyConditionOrder(ref: OrderRef, changes: ModifyConditionChanges): DexOrders {
        return new DexOrders(DexOrdersVariant.ReplaceCondition, [
            this.buildConditionReplace(ref, changes),
        ]);
    }

    modifyConditionOrders(
        list: Array<{ ref: OrderRef; changes: ModifyConditionChanges }>,
    ): DexOrders {
        return new DexOrders(
            DexOrdersVariant.ReplaceCondition,
            list.map((m) => this.buildConditionReplace(m.ref, m.changes)),
        );
    }

    private buildConditionReplace(
        ref: OrderRef,
        changes: ModifyConditionChanges,
    ): DexConditionReplaceOrder {
        const { basicType, conditionType } = orderTypeToBasics(changes.type);
        if (conditionType === ConditionType.Unspecified) {
            throw new Error("modifyConditionOrder requires a STOP_* or TAKE_PROFIT_* type");
        }

        let subticks = 0n;
        if (basicType === OrderBasicType.Limit) {
            if (changes.price == null) {
                throw new Error("modifyConditionOrder limit execution requires price");
            }
            subticks = resolveIntentSubticks(this.ctx.resolver, changes.symbol, changes.price);
        } else if (changes.price != null) {
            throw new Error("modifyConditionOrder market execution must not include price");
        }

        const triggerSubticks = resolveIntentSubticks(
            this.ctx.resolver,
            changes.symbol,
            changes.triggerPrice,
        );
        const sizeMode = changes.sizeMode ?? "fixed";
        if (sizeMode !== "fixed" && sizeMode !== "close_position") {
            throw new Error("modifyConditionOrder sizeMode is invalid");
        }
        if (
            changes.currentSizeMode != null &&
            changes.currentSizeMode !== "fixed" &&
            changes.currentSizeMode !== "close_position"
        ) {
            throw new Error("modifyConditionOrder currentSizeMode is invalid");
        }
        if (changes.currentSizeMode != null && changes.currentSizeMode !== sizeMode) {
            throw new Error("modifyConditionOrder cannot change condition size mode");
        }
        let quantums: bigint;
        if (sizeMode === "close_position") {
            if (changes.size != null) {
                throw new Error(
                    "modifyConditionOrder whole-position condition cannot specify size",
                );
            }
            quantums = 0n;
        } else {
            if (changes.size == null) {
                throw new Error("modifyConditionOrder fixed size requires size");
            }
            quantums = resolveIntentQuantums(this.ctx.resolver, changes.symbol, changes.size);
        }

        return new DexConditionReplaceOrder(
            this.ctx.subAddress,
            replaceTargetFromRef(
                ref,
                this.ctx.resolver.symbolId(changes.symbol),
                this.symbolType,
            ),
            quantums,
            subticks,
            triggerSubticks,
            basicType,
            conditionType,
            toTriggerPriceType(changes.triggerPriceType),
            changes.newClientOrderId ?? null,
        );
    }

    // ---- Submit glue -------------------------------------------------------

    /**
     * Wrap wire-ready `DexOrders` into a `DexTx` (then sign+submit via the
     * existing `Intention.transaction` helpers). `created_by` defaults to User.
     */
    toDexTx(
        orders: DexOrders,
        nonce: bigint,
        createdBy: CreatedBy = CreatedBy.User,
        onBehalfOf?: AccountAddress,
    ): DexTx {
        return new DexTx(nonce, orders, createdBy, onBehalfOf);
    }
}

// ============================================================================
// OrderClient - async orchestration (build via OrderIntents + sign + submit)
// ============================================================================

export interface OrderClientContext extends OrderIntentsContext {
    /** Live Intention client (provides `submitDexOrders` + chain info). */
    intention: Intention;
    /** Transaction signer (tx sender = `signer.accountAddress`). */
    signer: Account;
    /** Defaults to `CreatedBy.User`. */
    createdBy?: CreatedBy;
    /** On-behalf-of sender (optional). */
    onBehalfOf?: AccountAddress;
    /** Orderless tx gas / expiration overrides. */
    submitOptions?: {
        maxGasAmount?: bigint;
        gasUnitPrice?: bigint;
        expirationTimestampSecs?: bigint;
    };
    /**
     * Live market data source for dynamic preflight. When omitted, OrderClient
     * creates a REST provider if `intention.config.relayerUrl` is configured.
     * Pass `null` to force local-only preflight.
     */
    preflightProvider?: OrderPreflightDataProvider | null;
    /** Account snapshot source used to resolve exact quantums for full-position closes. */
    accountProvider?: DexAccountProvider | null;
    /** Open-order source used by true `cancelAll()` discovery. */
    openOrdersProvider?: OpenOrdersProvider | null;
}

export type OrderPreflightMode = "auto" | "local" | "full";

export interface OrderPreflightOptions {
    /** `auto`: full when a provider is configured, otherwise local. */
    preflight?: OrderPreflightMode;
    /** Optional maximum age for a reference price that carries a timestamp. */
    maxPriceAgeMs?: number;
}

/** Confirmation behavior for the high-level `place*` methods. */
export interface OrderExecutionOptions extends OrderPreflightOptions {
    /** Maximum time to wait for on-chain confirmation. Default: 30 seconds. */
    timeoutSecs?: number;
    /** REST polling interval while the transaction is pending. Default: 1000ms. */
    pollIntervalMs?: number;
    /** Throw {@link OrderRejectedError} when any order is rejected. Default: false. */
    throwOnOrderReject?: boolean;
}

/** Preflight behavior for the submit-only fast path. Default: local. */
export interface OrderSubmitOptions extends OrderPreflightOptions {}

export type OrderOutcomeStatus = "placed" | "filled" | "cancelled" | "amended" | "rejected";

/** Minimal per-order result derived from events emitted by the committed transaction. */
export interface OrderOutcome {
    status: OrderOutcomeStatus;
    orderId: bigint | null;
    clientOrderId: string | null;
    symbolId: number;
    /** Present only when `status === "rejected"`. */
    rejectReasonCode?: number;
}

/** Confirmed result returned by every high-level order action. */
export interface OrderActionResult {
    hash: string;
    transaction: TransactionResponse;
    orders: OrderOutcome[];
    /** `null` means no decodable order outcome event was present. */
    allAccepted: boolean | null;
}

/** Backward-compatible name for placement results. */
export type PlaceOrderResult = OrderActionResult;

/** Optional exception mode for callers that prefer rejected orders to throw. */
export class OrderRejectedError extends Error {
    readonly rejectedOrders: OrderOutcome[];

    constructor(public readonly result: OrderActionResult) {
        const rejectedOrders = result.orders.filter((order) => order.status === "rejected");
        super(`DEX rejected ${rejectedOrders.length} order(s) in transaction ${result.hash}`);
        this.name = "OrderRejectedError";
        this.rejectedOrders = rejectedOrders;
    }
}

function orderOutcomeKey(outcome: OrderOutcome, fallbackIndex: number): string {
    if (outcome.orderId != null && outcome.orderId !== 0n) {
        return `order:${outcome.orderId}`;
    }
    if (outcome.clientOrderId != null) {
        return `client:${outcome.clientOrderId}`;
    }
    return `event:${fallbackIndex}`;
}

function orderEventField(
    event: DecodedDexEvent["event"],
    camelCase: string,
    snakeCase: string,
): unknown {
    const record = event as unknown as Readonly<Record<string, unknown>>;
    return record[camelCase] ?? record[snakeCase];
}

function normalizedOrderId(value: unknown): bigint | null {
    try {
        const orderId = BigInt(value as string | number | bigint);
        return orderId === 0n ? null : orderId;
    } catch {
        return null;
    }
}

function normalizedEventNumber(value: unknown): number | undefined {
    if (value == null || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizedClientOrderId(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const values = (value as Readonly<Record<string, unknown>>).vec;
    return Array.isArray(values) && values.length === 1 && typeof values[0] === "string"
        ? values[0]
        : null;
}

function normalizedOrderEvent(event: DecodedDexEvent["event"]): Omit<OrderOutcome, "status"> {
    return {
        orderId: normalizedOrderId(orderEventField(event, "orderId", "order_id")),
        clientOrderId: normalizedClientOrderId(
            orderEventField(event, "clientOrderId", "client_order_id"),
        ),
        symbolId: normalizedEventNumber(orderEventField(event, "symbolId", "symbol_id")) ?? 0,
    };
}

/** Collapse placed->filled event sequences into one current outcome per order. */
export function orderOutcomesFromDecodedEvents(events: DecodedDexEvent[]): OrderOutcome[] {
    const outcomes: OrderOutcome[] = [];
    const indexes = new Map<string, number>();

    const upsert = (outcome: OrderOutcome): void => {
        const key = orderOutcomeKey(outcome, outcomes.length);
        const existingIndex = indexes.get(key);
        if (existingIndex == null) {
            indexes.set(key, outcomes.length);
            outcomes.push(outcome);
        } else {
            outcomes[existingIndex] = outcome;
        }
    };

    for (const decoded of events) {
        switch (decoded.eventType) {
            case "OrderPlacedEvent":
            case "ConditionOrderPlacedEvent": {
                upsert({
                    status: "placed",
                    ...normalizedOrderEvent(decoded.event),
                });
                break;
            }
            case "OrderFilledEvent": {
                upsert({
                    status: "filled",
                    ...normalizedOrderEvent(decoded.event),
                });
                break;
            }
            case "OrderCancelledEvent": {
                upsert({
                    status: "cancelled",
                    ...normalizedOrderEvent(decoded.event),
                });
                break;
            }
            case "OrderAmendedEvent": {
                upsert({
                    status: "amended",
                    ...normalizedOrderEvent(decoded.event),
                });
                break;
            }
            case "OrderRejectedEvent": {
                const rejectReasonCode = normalizedEventNumber(
                    orderEventField(decoded.event, "rejectReason", "reject_reason"),
                );
                upsert({
                    status: "rejected",
                    ...normalizedOrderEvent(decoded.event),
                    ...(rejectReasonCode == null ? {} : { rejectReasonCode }),
                });
                break;
            }
        }
    }

    return outcomes;
}

/**
 * High-level async order client: ties {@link OrderIntents} (pure builders) to
 * `Intention.submitDexOrders` (wrap `DexTx` -> orderless -> sign -> submit).
 * `place*` methods submit, wait for commitment, and return per-order outcomes.
 * Their matching `submit*` methods are the low-latency path that only submits
 * and returns a `PendingTransactionResponse`.
 */
export class OrderClient {
    private readonly builder: OrderIntents;
    private readonly intention: Intention;
    private readonly signer: Account;
    private readonly resolver: MarketResolver;
    private readonly positionMode: OrderPositionMode;
    private readonly createdBy: CreatedBy;
    private readonly onBehalfOf?: AccountAddress;
    private readonly submitOptions?: OrderClientContext["submitOptions"];
    private readonly preflightProvider?: OrderPreflightDataProvider;
    private readonly accountProvider?: DexAccountProvider;
    private readonly openOrdersProvider?: OpenOrdersProvider;
    private readonly subAddress: AccountAddress;

    constructor(ctx: OrderClientContext) {
        this.builder = new OrderIntents(ctx);
        this.intention = ctx.intention;
        this.signer = ctx.signer;
        this.resolver = ctx.resolver;
        this.positionMode = ctx.positionMode;
        this.createdBy = ctx.createdBy ?? CreatedBy.User;
        this.onBehalfOf = ctx.onBehalfOf;
        this.submitOptions = ctx.submitOptions;
        this.subAddress = ctx.subAddress;
        const config = ctx.intention.config;
        this.preflightProvider =
            ctx.preflightProvider === null
                ? undefined
                : (ctx.preflightProvider ??
                  (config?.relayerUrl
                      ? new RelayerOrderPreflightDataProvider(config)
                      : undefined));
        this.accountProvider =
            ctx.accountProvider === null
                ? undefined
                : (ctx.accountProvider ?? (config?.nodeUrl ? new DexAccountClient(ctx.intention) : undefined));
        this.openOrdersProvider =
            ctx.openOrdersProvider === null
                ? undefined
                : (ctx.openOrdersProvider ??
                  (config?.relayerUrl ? new RelayerOpenOrdersProvider(config) : undefined));
    }

    /** The pure builder - for advanced composition (build now, submit later). */
    get build(): OrderIntents {
        return this.builder;
    }

    // ---- Preflight ---------------------------------------------------------

    private collectRequirements(groups: OrderGroup[]): Map<string, OrderPreflightRequirements> {
        const result = new Map<string, OrderPreflightRequirements>();
        const add = (symbol: string, next: OrderPreflightRequirements): void => {
            const current = result.get(symbol) ?? {};
            result.set(symbol, {
                markPrice: current.markPrice || next.markPrice,
                lastPrice: current.lastPrice || next.lastPrice,
                midPrice: current.midPrice || next.midPrice,
                tradingPolicy: current.tradingPolicy || next.tradingPolicy,
            });
        };
        const addConditional = (
            symbol: string,
            type: OrderType,
            triggerPriceType?: TriggerPriceKind,
        ): void => {
            const usesLast = triggerPriceType === "LAST_PRICE";
            add(symbol, {
                // Mark is authoritative for MARK_PRICE and is also required by
                // the chain's LAST_PRICE trigger-protection fallback.
                markPrice: true,
                lastPrice: usesLast,
                // Last-price protection and condition-limit deviation both use policy.
                tradingPolicy: usesLast || isLimitOrderType(type),
            });
        };

        for (const group of groups) {
            if (group.kind === "single") {
                if (isConditionalOrderType(group.order.type)) {
                    addConditional(
                        group.order.symbol,
                        group.order.type,
                        group.order.triggerPriceType,
                    );
                }
            } else if (group.kind === "bracket") {
                if (group.entry.type === OrderType.MARKET) {
                    add(group.entry.symbol, { midPrice: true });
                }
            } else {
                if (group.tp) {
                    addConditional(group.symbol, group.tp.type, group.tp.triggerPriceType);
                }
                if (group.sl) {
                    addConditional(group.symbol, group.sl.type, group.sl.triggerPriceType);
                }
            }
        }
        return result;
    }

    private resolveReferencePrice(args: {
        symbol: string;
        snapshot: OrderPreflightMarketSnapshot;
        kind: TriggerPriceKind | "MID_PRICE";
    }):
        | {
              subticks: bigint;
              raw: string;
              type: "MARK_PRICE" | "LAST_PRICE" | "MID_PRICE";
              timestampMs?: number;
          }
        | undefined {
        const { symbol, snapshot } = args;
        try {
            if (args.kind === "MARK_PRICE") {
                if (snapshot.markPrice == null) return undefined;
                return {
                    subticks: this.resolver.toSubticks(symbol, snapshot.markPrice),
                    raw: String(snapshot.markPrice),
                    type: "MARK_PRICE",
                    timestampMs: snapshot.timestamps?.markPrice,
                };
            }
            if (args.kind === "MID_PRICE") {
                if (snapshot.midPrice != null) {
                    return {
                        subticks: this.resolver.toSubticks(symbol, snapshot.midPrice),
                        raw: String(snapshot.midPrice),
                        type: "MID_PRICE",
                        timestampMs: snapshot.timestamps?.midPrice,
                    };
                }
                if (snapshot.bestBidPrice == null || snapshot.bestAskPrice == null) {
                    return undefined;
                }
                const bid = this.resolver.toSubticks(symbol, snapshot.bestBidPrice);
                const ask = this.resolver.toSubticks(symbol, snapshot.bestAskPrice);
                if (bid <= 0n || ask <= bid) return undefined;
                return {
                    subticks: (bid + ask) / 2n,
                    raw: `${String(snapshot.bestBidPrice)}..${String(snapshot.bestAskPrice)}`,
                    type: "MID_PRICE",
                    timestampMs: snapshot.timestamps?.midPrice,
                };
            }

            if (snapshot.lastPrice == null) return undefined;
            const last = this.resolver.toSubticks(symbol, snapshot.lastPrice);
            const protectPpm = snapshot.triggerProtectPpm ?? 0;
            if (protectPpm > 0 && snapshot.markPrice != null) {
                const mark = this.resolver.toSubticks(symbol, snapshot.markPrice);
                if (
                    mark > 0n &&
                    (mark > last ? mark - last : last - mark) * 1_000_000n >
                        mark * BigInt(protectPpm)
                ) {
                    return {
                        subticks: mark,
                        raw: String(snapshot.markPrice),
                        type: "MARK_PRICE",
                        timestampMs: snapshot.timestamps?.markPrice,
                    };
                }
            }
            return {
                subticks: last,
                raw: String(snapshot.lastPrice),
                type: "LAST_PRICE",
                timestampMs: snapshot.timestamps?.lastPrice,
            };
        } catch {
            return undefined;
        }
    }

    private validateReferenceFreshness(args: {
        reference: { timestampMs?: number; type: "MARK_PRICE" | "LAST_PRICE" | "MID_PRICE" };
        maxPriceAgeMs?: number;
        symbol: string;
        field: string;
        groupIndex: number;
    }): OrderValidationIssue[] {
        if (
            args.maxPriceAgeMs == null ||
            args.reference.timestampMs == null ||
            Date.now() - args.reference.timestampMs <= args.maxPriceAgeMs
        ) {
            return [];
        }
        return [
            validationIssue("REFERENCE_PRICE_STALE", "Reference price is stale", {
                field: args.field,
                groupIndex: args.groupIndex,
                symbol: args.symbol,
                referencePriceType: args.reference.type,
                actual: String(args.reference.timestampMs),
                expected: `age <= ${args.maxPriceAgeMs}ms`,
            }),
        ];
    }

    private validateTriggerDirection(args: {
        symbol: string;
        kind: "tp" | "sl";
        side: IntentSide;
        triggerPrice: number | string;
        triggerSubticks: bigint;
        reference: {
            subticks: bigint;
            raw: string;
            type: "MARK_PRICE" | "LAST_PRICE" | "MID_PRICE";
        };
        field: string;
        groupIndex: number;
    }): OrderValidationIssue[] {
        const sell = args.side === "SELL";
        const valid =
            args.kind === "tp"
                ? sell
                    ? args.triggerSubticks >= args.reference.subticks
                    : args.triggerSubticks <= args.reference.subticks
                : sell
                  ? args.triggerSubticks <= args.reference.subticks
                  : args.triggerSubticks >= args.reference.subticks;
        if (valid) return [];

        const above = args.kind === "tp" ? sell : !sell;
        return [
            validationIssue(
                args.kind === "tp"
                    ? above
                        ? "TAKE_PROFIT_PRICE_MUST_ABOVE_REF"
                        : "TAKE_PROFIT_PRICE_MUST_BELOW_REF"
                    : above
                      ? "STOP_ORDER_PRICE_MUST_ABOVE_REF"
                      : "STOP_ORDER_PRICE_MUST_BELOW_REF",
                `${args.kind.toUpperCase()} trigger price must be ${above ? "higher" : "lower"} than or equal to the reference price`,
                {
                    field: args.field,
                    groupIndex: args.groupIndex,
                    symbol: args.symbol,
                    actual: String(args.triggerPrice),
                    expected: `${above ? ">=" : "<="} ${args.reference.raw}`,
                    referencePriceType: args.reference.type,
                    referencePrice: args.reference.raw,
                },
            ),
        ];
    }

    private effectiveConditionalSide(order: OrderInput): IntentSide {
        if (this.positionMode !== OrderPositionMode.Hedge || order.positionSide == null) {
            return order.side;
        }
        if (order.reduceOnly) {
            return order.positionSide === "LONG" ? "SELL" : "BUY";
        }
        return order.positionSide === "LONG" ? "BUY" : "SELL";
    }

    private validateConditionalAgainstSnapshot(args: {
        symbol: string;
        type: OrderType;
        side: IntentSide;
        price?: number | string;
        triggerPrice: number | string;
        triggerPriceType?: TriggerPriceKind;
        snapshot: OrderPreflightMarketSnapshot;
        field: string;
        groupIndex: number;
        maxPriceAgeMs?: number;
    }): OrderValidationIssue[] {
        const reference = this.resolveReferencePrice({
            symbol: args.symbol,
            snapshot: args.snapshot,
            kind: args.triggerPriceType ?? "MARK_PRICE",
        });
        if (!reference || reference.subticks <= 0n) {
            return [
                validationIssue(
                    "REFERENCE_PRICE_UNAVAILABLE",
                    `Required ${args.triggerPriceType ?? "MARK_PRICE"} reference price is unavailable`,
                    {
                        field: args.field,
                        groupIndex: args.groupIndex,
                        symbol: args.symbol,
                        referencePriceType: args.triggerPriceType ?? "MARK_PRICE",
                    },
                ),
            ];
        }
        const freshnessIssues = this.validateReferenceFreshness({
            reference,
            maxPriceAgeMs: args.maxPriceAgeMs,
            symbol: args.symbol,
            field: args.field,
            groupIndex: args.groupIndex,
        });
        if (freshnessIssues.length > 0) return freshnessIssues;

        let triggerSubticks: bigint;
        try {
            triggerSubticks = this.resolver.toSubticks(args.symbol, args.triggerPrice);
        } catch {
            return [];
        }
        const kind = isTakeProfitOrderType(args.type) ? "tp" : "sl";
        const issues = this.validateTriggerDirection({
            symbol: args.symbol,
            kind,
            side: args.side,
            triggerPrice: args.triggerPrice,
            triggerSubticks,
            reference,
            field: args.field,
            groupIndex: args.groupIndex,
        });

        if (isLimitOrderType(args.type) && args.price != null) {
            const protect = args.snapshot.triggerProtectPpm ?? 0;
            const deviationPpm =
                protect > 0
                    ? protect
                    : (args.snapshot.conditionPriceDeviationPpm ?? 0);
            if (deviationPpm > 0 && deviationPpm <= 1_000_000) {
                try {
                    const limit = this.resolver.toSubticks(args.symbol, args.price);
                    const ppm = BigInt(deviationPpm);
                    const valid =
                        args.side === "SELL"
                            ? limit * 1_000_000n >= triggerSubticks * (1_000_000n - ppm)
                            : limit * 1_000_000n <= triggerSubticks * (1_000_000n + ppm);
                    if (!valid) {
                        issues.push(
                            validationIssue(
                                "CONDITION_LIMIT_PRICE_DEVIATION",
                                "Conditional limit price is too far from its trigger price",
                                {
                                    field: args.field.replace("triggerPrice", "price"),
                                    groupIndex: args.groupIndex,
                                    symbol: args.symbol,
                                    actual: String(args.price),
                                    expected: `${deviationPpm}ppm directional limit from trigger ${String(args.triggerPrice)}`,
                                },
                            ),
                        );
                    }
                } catch {
                    // Static validation owns invalid decimal input errors.
                }
            }
        }
        return issues;
    }

    private validateDynamicGroup(
        group: OrderGroup,
        groupIndex: number,
        snapshot: OrderPreflightMarketSnapshot,
        maxPriceAgeMs?: number,
    ): OrderValidationIssue[] {
        if (group.kind === "single") {
            if (!isConditionalOrderType(group.order.type) || group.order.triggerPrice == null) {
                return [];
            }
            return this.validateConditionalAgainstSnapshot({
                symbol: group.order.symbol,
                type: group.order.type,
                side: this.effectiveConditionalSide(group.order),
                price: group.order.price,
                triggerPrice: group.order.triggerPrice,
                triggerPriceType: group.order.triggerPriceType,
                snapshot,
                field: "triggerPrice",
                groupIndex,
                maxPriceAgeMs,
            });
        }

        if (group.kind === "bracket") {
            if (group.entry.type !== OrderType.MARKET) return [];
            const reference = this.resolveReferencePrice({
                symbol: group.entry.symbol,
                snapshot,
                kind: "MID_PRICE",
            });
            if (!reference || reference.subticks <= 0n) {
                return [
                    validationIssue(
                        "REFERENCE_PRICE_UNAVAILABLE",
                        "Required MID_PRICE reference price is unavailable",
                        {
                            groupIndex,
                            symbol: group.entry.symbol,
                            referencePriceType: "MID_PRICE",
                        },
                    ),
                ];
            }
            const freshness = this.validateReferenceFreshness({
                reference,
                maxPriceAgeMs,
                symbol: group.entry.symbol,
                field: "triggerPrice",
                groupIndex,
            });
            if (freshness.length > 0) return freshness;
            const opensLong =
                this.positionMode === OrderPositionMode.Hedge && group.entry.positionSide != null
                    ? group.entry.positionSide === "LONG"
                    : group.entry.side === "BUY";
            const childSide: IntentSide = opensLong ? "SELL" : "BUY";
            return ([
                ["tp", group.tp],
                ["sl", group.sl],
            ] as const).flatMap(([kind, leg]) => {
                if (!leg) return [];
                try {
                    return this.validateTriggerDirection({
                        symbol: group.entry.symbol,
                        kind,
                        side: childSide,
                        triggerPrice: leg.triggerPrice,
                        triggerSubticks: this.resolver.toSubticks(
                            group.entry.symbol,
                            leg.triggerPrice,
                        ),
                        reference,
                        field: `${kind}.triggerPrice`,
                        groupIndex,
                    });
                } catch {
                    return [];
                }
            });
        }

        const positionSide = group.positionSide ?? "LONG";
        const closeSide: IntentSide = positionSide === "LONG" ? "SELL" : "BUY";
        return ([
            ["tp", group.tp],
            ["sl", group.sl],
        ] as const).flatMap(([kind, leg]) => {
            if (!leg) return [];
            return this.validateConditionalAgainstSnapshot({
                symbol: group.symbol,
                type: leg.type,
                side: closeSide,
                price: leg.price,
                triggerPrice: leg.triggerPrice,
                triggerPriceType: leg.triggerPriceType,
                snapshot,
                field: `${kind}.triggerPrice`,
                groupIndex,
                maxPriceAgeMs,
            });
        });
    }

    private async preflightGroups(
        groups: OrderGroup[],
        options: OrderPreflightOptions,
        defaultMode: OrderPreflightMode,
    ): Promise<OrderValidationIssue[]> {
        const localIssues = this.builder.validateOrders(groups);
        if (localIssues.length > 0) return localIssues;

        const mode = options.preflight ?? defaultMode;
        if (mode === "local") return [];
        const requirements = this.collectRequirements(groups);
        if (requirements.size === 0) return [];
        if (!this.preflightProvider) {
            return mode === "full"
                ? [
                      validationIssue(
                          "PREFLIGHT_PROVIDER_UNAVAILABLE",
                          "Full order preflight requires relayerUrl or preflightProvider",
                      ),
                  ]
                : [];
        }

        const snapshots = new Map<string, OrderPreflightMarketSnapshot>();
        const dataIssues: OrderValidationIssue[] = [];
        await Promise.all(
            [...requirements.entries()].map(async ([symbol, required]) => {
                try {
                    const snapshot = await this.preflightProvider!.getMarketSnapshot({
                        symbol,
                        symbolId: this.resolver.symbolId(symbol),
                        requirements: required,
                    });
                    snapshots.set(symbol, snapshot);
                } catch (error) {
                    dataIssues.push(
                        validationIssue(
                            "PREFLIGHT_DATA_UNAVAILABLE",
                            error instanceof Error ? error.message : "Preflight data unavailable",
                            { symbol },
                        ),
                    );
                }
            }),
        );
        if (dataIssues.length > 0) return dataIssues;

        return groups.flatMap((group, groupIndex) => {
            const symbol =
                group.kind === "bracket"
                    ? group.entry.symbol
                    : group.kind === "single"
                      ? group.order.symbol
                      : group.symbol;
            const snapshot = snapshots.get(symbol);
            return snapshot
                ? this.validateDynamicGroup(group, groupIndex, snapshot, options.maxPriceAgeMs)
                : [];
        });
    }

    private async assertPreflight(
        groups: OrderGroup[],
        options: OrderPreflightOptions,
        defaultMode: OrderPreflightMode,
    ): Promise<void> {
        const issues = await this.preflightGroups(groups, options, defaultMode);
        if (issues.length > 0) throw new OrderPreflightError(issues);
    }

    validateOrder(order: OrderInput): OrderValidationIssue[] {
        return this.builder.validateOrder(order);
    }

    validateOrderWithTpSl(
        entry: OrderInput,
        tpsl: { tp?: TpSlLeg; sl?: TpSlLeg },
    ): OrderValidationIssue[] {
        return this.builder.validateOrderWithTpSl(entry, tpsl);
    }

    validatePositionTpSl(
        args: Parameters<OrderIntents["placePositionTpSl"]>[0],
    ): OrderValidationIssue[] {
        return this.builder.validatePositionTpSl(args);
    }

    validateOrders(groups: OrderGroup[]): OrderValidationIssue[] {
        return this.builder.validateOrders(groups);
    }

    preflightOrder(
        order: OrderInput,
        options: OrderPreflightOptions = {},
    ): Promise<OrderValidationIssue[]> {
        return this.preflightGroups([{ kind: "single", order }], options, "full");
    }

    preflightOrderWithTpSl(
        entry: OrderInput,
        tpsl: { tp?: TpSlLeg; sl?: TpSlLeg },
        options: OrderPreflightOptions = {},
    ): Promise<OrderValidationIssue[]> {
        return this.preflightGroups(
            [{ kind: "bracket", entry, tp: tpsl.tp, sl: tpsl.sl }],
            options,
            "full",
        );
    }

    preflightPositionTpSl(
        args: Parameters<OrderIntents["placePositionTpSl"]>[0],
        options: OrderPreflightOptions = {},
    ): Promise<OrderValidationIssue[]> {
        return this.preflightGroups([{ kind: "positionTpSl", ...args }], options, "full");
    }

    preflightOrders(
        groups: OrderGroup[],
        options: OrderPreflightOptions = {},
    ): Promise<OrderValidationIssue[]> {
        return this.preflightGroups(groups, options, "full");
    }

    private submit(dexOrders: DexOrders): Promise<PendingTransactionResponse> {
        return this.intention.submitDexOrders({
            signer: this.signer,
            dexOrders,
            createdBy: this.createdBy,
            onBehalfOf: this.onBehalfOf,
            options: this.submitOptions,
        });
    }

    private async executeOrderAction(
        dexOrders: DexOrders,
        options: OrderExecutionOptions = {},
    ): Promise<OrderActionResult> {
        const pending = await this.submit(dexOrders);
        const transaction = await this.intention.waitForTransaction({
            transactionHash: pending.hash,
            options: {
                timeoutSecs: options.timeoutSecs ?? 30,
                checkIntervalMs: options.pollIntervalMs ?? 1000,
                checkSuccess: true,
            },
        });
        const rawEvents = Array.isArray(transaction.events)
            ? transaction.events.filter(
                  (event): event is { type: string; data: unknown } =>
                      typeof event === "object" &&
                      event !== null &&
                      typeof (event as { type?: unknown }).type === "string" &&
                      "data" in event,
              )
            : [];
        const decodedEvents = decodeTransactionEvents(rawEvents).map(
            ({ eventType, event }) => ({ eventType, event }),
        );
        const orders = orderOutcomesFromDecodedEvents(decodedEvents);
        const hasRejectedOrder = orders.some((order) => order.status === "rejected");
        const result: OrderActionResult = {
            hash: pending.hash,
            transaction,
            orders,
            allAccepted: orders.length === 0 ? null : !hasRejectedOrder,
        };
        if (hasRejectedOrder && options.throwOnOrderReject) {
            throw new OrderRejectedError(result);
        }
        return result;
    }

    private async loadAccountSnapshot(): Promise<DexAccountSnapshot> {
        if (!this.accountProvider) {
            throw new Error(
                "Full close requires an account provider (configure IntentionConfig.nodeUrl or OrderClientContext.accountProvider)",
            );
        }
        const owner = this.signer.accountAddress;
        if (!owner) throw new Error("Full close requires signer.accountAddress");
        const accounts = await this.accountProvider.getAccounts(owner);
        const target = this.subAddress.toString().toLowerCase();
        const account = accounts.find((candidate) => candidate.subAddress.toLowerCase() === target);
        if (!account) {
            throw new Error(`DEX account ${this.subAddress.toString()} was not found`);
        }
        return account;
    }

    private resolveFullClose(
        input: ClosePositionInput,
        account: DexAccountSnapshot,
    ): ClosePositionInput {
        if (input.size != null && input.size !== "ALL") return input;
        const symbolId = this.resolver.symbolId(input.symbol);
        const position = account.perps.find((candidate) => candidate.perpetualId === symbolId);
        if (!position) throw new Error(`No open ${input.symbol} position was found`);

        let positionSide = input.positionSide;
        if (this.positionMode === OrderPositionMode.Hedge && positionSide == null) {
            throw new Error("Hedge mode full close requires positionSide ('LONG' | 'SHORT')");
        }
        if (positionSide == null) {
            const hasLong = position.longQuantums > 0n;
            const hasShort = position.shortQuantums > 0n;
            if (hasLong === hasShort) {
                throw new Error(
                    hasLong
                        ? `Cannot infer ${input.symbol} position side; pass positionSide explicitly`
                        : `No open ${input.symbol} position was found`,
                );
            }
            positionSide = hasLong ? "LONG" : "SHORT";
        }
        const quantums =
            positionSide === "LONG" ? position.longQuantums : position.shortQuantums;
        if (quantums <= 0n) {
            throw new Error(`No open ${input.symbol} ${positionSide} position was found`);
        }
        return { ...input, positionSide, size: quantums };
    }

    private async resolveCloseInputs(inputs: ClosePositionsInput): Promise<ClosePositionsInput> {
        if (!inputs.some((input) => input.size == null || input.size === "ALL")) return inputs;
        const account = await this.loadAccountSnapshot();
        return inputs.map((input) => this.resolveFullClose(input, account));
    }

    private async discoverOpenOrderRefs(symbol?: string): Promise<OrderRef[]> {
        if (!this.openOrdersProvider) {
            throw new Error(
                "cancelAll requires an open-orders provider (configure IntentionConfig.relayerUrl or OrderClientContext.openOrdersProvider)",
            );
        }
        const owner = this.signer.accountAddress;
        if (!owner) throw new Error("cancelAll requires signer.accountAddress");
        const symbolId = symbol == null ? undefined : this.resolver.symbolId(symbol);
        const orders = await this.openOrdersProvider.getOpenOrders({
            address: owner,
            subAddress: this.subAddress,
            symbol,
            symbolId,
        });
        if (orders.length === 0) {
            throw new Error(symbol == null ? "No open orders to cancel" : `No open ${symbol} orders to cancel`);
        }
        return orders.map((order) => ({ orderId: order.orderId }));
    }

    // ---- Place -------------------------------------------------------------

    async placeOrder(
        order: OrderInput,
        options: OrderExecutionOptions = {},
    ): Promise<PlaceOrderResult> {
        await this.assertPreflight([{ kind: "single", order }], options, "auto");
        return this.executeOrderAction(this.builder.placeOrder(order), options);
    }

    async placeOrderWithTpSl(
        entry: OrderInput,
        tpsl: { tp?: TpSlLeg; sl?: TpSlLeg },
        options: OrderExecutionOptions = {},
    ): Promise<PlaceOrderResult> {
        await this.assertPreflight(
            [{ kind: "bracket", entry, tp: tpsl.tp, sl: tpsl.sl }],
            options,
            "auto",
        );
        return this.executeOrderAction(this.builder.placeOrderWithTpSl(entry, tpsl), options);
    }

    async placePositionTpSl(
        args: Parameters<OrderIntents["placePositionTpSl"]>[0],
        options: OrderExecutionOptions = {},
    ): Promise<PlaceOrderResult> {
        await this.assertPreflight([{ kind: "positionTpSl", ...args }], options, "auto");
        return this.executeOrderAction(this.builder.placePositionTpSl(args), options);
    }

    async placeOrders(
        groups: OrderGroup[],
        options: OrderExecutionOptions = {},
    ): Promise<PlaceOrderResult> {
        await this.assertPreflight(groups, options, "auto");
        return this.executeOrderAction(this.builder.placeOrders(groups), options);
    }

    /** Submit one order without waiting for commitment. */
    async submitOrder(
        order: OrderInput,
        options: OrderSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        await this.assertPreflight([{ kind: "single", order }], options, "local");
        return this.submit(this.builder.placeOrder(order));
    }

    /** Submit an entry plus TP/SL without waiting for commitment. */
    async submitOrderWithTpSl(
        entry: OrderInput,
        tpsl: { tp?: TpSlLeg; sl?: TpSlLeg },
        options: OrderSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        await this.assertPreflight(
            [{ kind: "bracket", entry, tp: tpsl.tp, sl: tpsl.sl }],
            options,
            "local",
        );
        return this.submit(this.builder.placeOrderWithTpSl(entry, tpsl));
    }

    /** Submit position-level TP/SL without waiting for commitment. */
    async submitPositionTpSl(
        args: Parameters<OrderIntents["placePositionTpSl"]>[0],
        options: OrderSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        await this.assertPreflight([{ kind: "positionTpSl", ...args }], options, "local");
        return this.submit(this.builder.placePositionTpSl(args));
    }

    /** Submit multiple place groups in one transaction without waiting. */
    async submitOrders(
        groups: OrderGroup[],
        options: OrderSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        await this.assertPreflight(groups, options, "local");
        return this.submit(this.builder.placeOrders(groups));
    }

    // ---- Close -------------------------------------------------------------

    async closePosition(
        args: ClosePositionInput,
        options: OrderExecutionOptions = {},
    ): Promise<OrderActionResult> {
        const [resolved] = await this.resolveCloseInputs([args]);
        return this.executeOrderAction(this.builder.closePosition(resolved), options);
    }

    async closePositions(
        list: ClosePositionsInput,
        options: OrderExecutionOptions = {},
    ): Promise<OrderActionResult> {
        return this.executeOrderAction(
            this.builder.closePositions(await this.resolveCloseInputs(list)),
            options,
        );
    }

    async submitClosePosition(args: ClosePositionInput): Promise<PendingTransactionResponse> {
        const [resolved] = await this.resolveCloseInputs([args]);
        return this.submit(this.builder.closePosition(resolved));
    }

    async submitClosePositions(list: ClosePositionsInput): Promise<PendingTransactionResponse> {
        return this.submit(this.builder.closePositions(await this.resolveCloseInputs(list)));
    }

    // ---- Cancel ------------------------------------------------------------

    cancelOrder(
        ref: OrderRef,
        options: OrderExecutionOptions = {},
    ): Promise<OrderActionResult> {
        return this.executeOrderAction(this.builder.cancelOrder(ref), options);
    }

    cancelOrders(refs: OrderRef[], options: OrderExecutionOptions = {}): Promise<OrderActionResult> {
        return this.executeOrderAction(this.builder.cancelOrders(refs), options);
    }

    async cancelAll(options: OrderExecutionOptions = {}): Promise<OrderActionResult> {
        return this.executeOrderAction(
            this.builder.cancelAll(await this.discoverOpenOrderRefs()),
            options,
        );
    }

    async cancelAllForSymbol(
        symbol: string,
        options: OrderExecutionOptions = {},
    ): Promise<OrderActionResult> {
        return this.executeOrderAction(
            this.builder.cancelAllForSymbol(symbol, await this.discoverOpenOrderRefs(symbol)),
            options,
        );
    }

    submitCancelOrder(ref: OrderRef): Promise<PendingTransactionResponse> {
        return this.submit(this.builder.cancelOrder(ref));
    }

    submitCancelOrders(refs: OrderRef[]): Promise<PendingTransactionResponse> {
        return this.submit(this.builder.cancelOrders(refs));
    }

    async submitCancelAll(): Promise<PendingTransactionResponse> {
        return this.submit(this.builder.cancelAll(await this.discoverOpenOrderRefs()));
    }

    async submitCancelAllForSymbol(symbol: string): Promise<PendingTransactionResponse> {
        return this.submit(
            this.builder.cancelAllForSymbol(symbol, await this.discoverOpenOrderRefs(symbol)),
        );
    }

    // ---- Modify ------------------------------------------------------------

    modifyOrder(
        ref: OrderRef,
        changes: ModifyChanges,
        options: OrderExecutionOptions = {},
    ): Promise<OrderActionResult> {
        return this.executeOrderAction(this.builder.modifyOrder(ref, changes), options);
    }

    modifyOrders(
        list: Array<{ ref: OrderRef; changes: ModifyChanges }>,
        options: OrderExecutionOptions = {},
    ): Promise<OrderActionResult> {
        return this.executeOrderAction(this.builder.modifyOrders(list), options);
    }

    modifyConditionOrder(
        ref: OrderRef,
        changes: ModifyConditionChanges,
        options: OrderExecutionOptions = {},
    ): Promise<OrderActionResult> {
        return this.executeOrderAction(this.builder.modifyConditionOrder(ref, changes), options);
    }

    modifyConditionOrders(
        list: Array<{ ref: OrderRef; changes: ModifyConditionChanges }>,
        options: OrderExecutionOptions = {},
    ): Promise<OrderActionResult> {
        return this.executeOrderAction(this.builder.modifyConditionOrders(list), options);
    }

    submitModifyOrder(ref: OrderRef, changes: ModifyChanges): Promise<PendingTransactionResponse> {
        return this.submit(this.builder.modifyOrder(ref, changes));
    }

    submitModifyOrders(
        list: Array<{ ref: OrderRef; changes: ModifyChanges }>,
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.builder.modifyOrders(list));
    }

    submitModifyConditionOrder(
        ref: OrderRef,
        changes: ModifyConditionChanges,
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.builder.modifyConditionOrder(ref, changes));
    }

    submitModifyConditionOrders(
        list: Array<{ ref: OrderRef; changes: ModifyConditionChanges }>,
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.builder.modifyConditionOrders(list));
    }
}

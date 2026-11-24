// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * DEX Transaction Payloads
 *
 * All DEX transaction structures needed by trading-web.
 */

import { Serializable, Serializer } from "../bcs/serializer";
import { AccountAddress } from "../core/accountAddress";
import {
    Side,
    OrderBasicType,
    TimeInForce,
    ConditionType,
    TriggerPriceType,
    SymbolType,
    MarginMode,
    OrderPositionMode,
    Grouping,
    CreatedBy,
    AccountType,
    CrossTransferOption,
    DexOrdersVariant,
    DexOrderlessTxVariant,
    DexTransferVariant,
    AgentOperationVariant,
    DexUserConfigTxVariant,
    TransactionPayloadVariants,
    StpMode,
} from "../types/enums";
// Type-only: the multisig payloads import this module for the inner transactions
// they gate, so a runtime import back would close a cycle. The envelope needs the
// type for its union and reads the nonce off the variant tag, neither of which
// needs the class at runtime.
import type { DexMultisigTx } from "./multisigPayloads";

// ============================================================================
// TransactionPayload base class
// ============================================================================

export abstract class TransactionPayload extends Serializable { }

// ============================================================================
// SubaccountId
// ============================================================================

/**
 * Subaccount identity (main address + number + derived sub-address + user_name).
 *
 * BCS layout (fixed size, 84 bytes):
 *   address:     [u8; 32]
 *   number:      u32
 *   sub_address: [u8; 32]
 *   user_name:   [u8; 16]
 */
export class SubaccountId extends Serializable {
    public readonly address: Uint8Array; // 32 bytes
    public readonly number: number; // u32
    public readonly sub_address: Uint8Array; // 32 bytes
    public readonly user_name: Uint8Array; // 16 bytes

    constructor(
        address: Uint8Array,
        number: number,
        sub_address: Uint8Array,
        user_name?: Uint8Array,
    ) {
        super();
        if (address.length !== 32) {
            throw new Error("SubaccountId address must be exactly 32 bytes");
        }
        if (sub_address.length !== 32) {
            throw new Error("SubaccountId sub_address must be exactly 32 bytes");
        }
        this.address = address;
        this.number = number;
        this.sub_address = sub_address;
        this.user_name = user_name ?? new Uint8Array(16);
        if (this.user_name.length !== 16) {
            throw new Error("SubaccountId user_name must be exactly 16 bytes");
        }
    }

    serialize(serializer: Serializer): void {
        serializer.serializeFixedBytes(this.address);
        serializer.serializeU32(this.number);
        serializer.serializeFixedBytes(this.sub_address);
        serializer.serializeFixedBytes(this.user_name);
    }
}

// ============================================================================
// DexPlaceOrder
// ============================================================================

export class DexPlaceOrder extends Serializable {
    public readonly subAddress: AccountAddress;
    public readonly symbol_id: number;
    public readonly symbol_type: SymbolType;
    public readonly side: Side;
    public readonly quantums: bigint;
    public readonly subticks: bigint;
    public readonly order_basic_type: OrderBasicType;
    public readonly time_in_force: TimeInForce;
    public readonly condition_type: ConditionType;
    public readonly trigger_price_type: TriggerPriceType;
    public readonly target_order_id: bigint;
    public readonly reduce_only: boolean;
    public readonly position_mode: OrderPositionMode;
    /**
     * Slippage tolerance in PPM (parts per million).
     *
     * Validated on-chain only for **market orders** (range [100, 100_000]).
     * For limit orders, any value is accepted and the engine does not use it.
     */
    public readonly slippage_tolerance_ppm: number;
    public readonly trigger_subticks: bigint;
    /**
     * Optional user-supplied client_order_id (`0x` + 32 lowercase hex chars).
     *
     * Format when set: `0x` + 32 lowercase hex chars (16 bytes / 128 bits).
     * - `undefined` / `null` = no client_order_id set (absent).
     * - string = tagged; the value is validated as provided by
     *   {@link validateClientOrderId} before BCS serialization.
     *
     * Uniqueness scope: globally unique within the signer `address` for OPEN
     * orders (across all sub_addresses, all symbol_ids); released when the
     * order leaves OPEN. The chain rejects collisions with
     * `DUPLICATE_CLIENT_ORDER_ID` and unknown ids on cancel with
     * `CLIENT_ORDER_ID_NOT_FOUND`.
     */
    public readonly client_order_id: string | null;
    /**
     * Self-Trade Prevention mode. Determines what happens when this order
     * would match against the same account's resting maker.
     * Default: ExpireMaker (cancel maker, taker continues).
     */
    public readonly stp_mode: StpMode;

    constructor(
        subAddress: AccountAddress,
        symbol_id: number,
        symbol_type: SymbolType,
        side: Side,
        quantums: bigint,
        subticks: bigint,
        trigger_subticks: bigint,
        order_basic_type: OrderBasicType,
        time_in_force: TimeInForce,
        condition_type: ConditionType,
        trigger_price_type: TriggerPriceType,
        target_order_id: bigint,
        reduce_only: boolean,
        position_mode: OrderPositionMode,
        slippage_tolerance_ppm: number,
        client_order_id: string | null = null,
        stp_mode: StpMode = StpMode.ExpireMaker,
    ) {
        super();
        this.subAddress = subAddress;
        this.symbol_id = symbol_id;
        this.symbol_type = symbol_type;
        this.side = side;
        this.quantums = quantums;
        this.subticks = subticks;
        this.trigger_subticks = trigger_subticks;
        this.order_basic_type = order_basic_type;
        this.time_in_force = time_in_force;
        this.condition_type = condition_type;
        this.trigger_price_type = trigger_price_type;
        this.target_order_id = target_order_id;
        this.reduce_only = reduce_only;
        this.position_mode = position_mode;
        this.slippage_tolerance_ppm = slippage_tolerance_ppm;
        this.client_order_id =
            client_order_id == null ? null : validateClientOrderId(client_order_id);
        this.stp_mode = stp_mode;
    }

    serialize(serializer: Serializer): void {
        this.subAddress.serialize(serializer);
        serializer.serializeU32(this.symbol_id);
        serializer.serializeU8(this.symbol_type);
        serializer.serializeU8(this.side);
        serializer.serializeI64(this.quantums);
        serializer.serializeU64(this.subticks);
        serializer.serializeU64(this.trigger_subticks);
        serializer.serializeU8(this.order_basic_type);
        serializer.serializeU8(this.time_in_force);
        serializer.serializeU8(this.condition_type);
        serializer.serializeU8(this.trigger_price_type);
        serializer.serializeU64(this.target_order_id);
        serializer.serializeBool(this.reduce_only);
        serializer.serializeU8(this.position_mode);
        serializer.serializeU32(this.slippage_tolerance_ppm);
        // BCS Option<String>: 0x00 = None; 0x01 + ULEB128 length + UTF-8 bytes = Some.
        // Validation has already checked the canonical lowercase form in the constructor.
        if (this.client_order_id !== null && this.client_order_id !== undefined) {
            serializer.serializeBool(true);
            serializer.serializeStr(this.client_order_id);
        } else {
            serializer.serializeBool(false);
        }
        serializer.serializeU8(this.stp_mode);
    }
}

// ============================================================================
// DexPlaceOrders (batch with TP/SL grouping)
// ============================================================================

/**
 * A batch of place orders sharing the same grouping type.
 * Users construct orders manually and pass them with a Grouping:
 *
 * - **NA**: Standalone orders, may include optional TP/SL. No limit on order count.
 * - **NormalTPSL**: The first order must be a normal order, followed by at most 1 TP and 1 SL order (max 3 total).
 * - **PositionTPSL**: Only TP/SL orders, at most 1 TP and 1 SL (max 2 total).
 */
export class DexPlaceOrders extends Serializable {
    public readonly orders: DexPlaceOrder[];
    public readonly grouping: Grouping;

    constructor(orders: DexPlaceOrder[], grouping: Grouping = Grouping.NA) {
        super();
        DexPlaceOrders.validateOrders(orders, grouping);
        this.orders = orders;
        this.grouping = grouping;
    }

    private static isTPSLOrder(order: DexPlaceOrder): boolean {
        return order.condition_type === ConditionType.TakeProfit || order.condition_type === ConditionType.StopLoss;
    }

    private static validateOrders(orders: DexPlaceOrder[], grouping: Grouping): void {
        if (orders.length === 0) {
            throw new Error("DexPlaceOrders requires at least one order");
        }

        const tpCount = orders.filter((o) => o.condition_type === ConditionType.TakeProfit).length;
        const slCount = orders.filter((o) => o.condition_type === ConditionType.StopLoss).length;

        switch (grouping) {
            case Grouping.NA:
                break;

            case Grouping.NormalTPSL:
                if (orders.length > 3) {
                    throw new Error(`Grouping.NormalTPSL allows at most 3 orders, got ${orders.length}`);
                }
                if (DexPlaceOrders.isTPSLOrder(orders[0])) {
                    throw new Error("Grouping.NormalTPSL requires the first order to be a normal order (condition_type = Unspecified)");
                }
                if (tpCount > 1) {
                    throw new Error(`Grouping.NormalTPSL allows at most 1 TakeProfit order, got ${tpCount}`);
                }
                if (slCount > 1) {
                    throw new Error(`Grouping.NormalTPSL allows at most 1 StopLoss order, got ${slCount}`);
                }
                if (orders.slice(1).some((o) => o.order_basic_type !== OrderBasicType.Market)) {
                    throw new Error("Grouping.NormalTPSL TP/SL child orders must use market execution");
                }
                break;

            case Grouping.PositionTPSL:
                if (orders.length > 2) {
                    throw new Error(`Grouping.PositionTPSL allows at most 2 orders, got ${orders.length}`);
                }
                if (tpCount > 1) {
                    throw new Error(`Grouping.PositionTPSL allows at most 1 TakeProfit order, got ${tpCount}`);
                }
                if (slCount > 1) {
                    throw new Error(`Grouping.PositionTPSL allows at most 1 StopLoss order, got ${slCount}`);
                }
                if (orders.some((o) => !DexPlaceOrders.isTPSLOrder(o))) {
                    throw new Error("Grouping.PositionTPSL only allows TakeProfit and StopLoss orders");
                }
                if (orders.some((o) =>
                    o.quantums === 0n
                    && !o.reduce_only
                    && o.side !== Side.CloseallLong
                    && o.side !== Side.CloseallShort
                )) {
                    throw new Error("whole-position orders require reduce_only = true");
                }
                break;

            default:
                throw new Error(`Unknown grouping type: ${grouping}`);
        }
    }

    serialize(serializer: Serializer): void {
        serializer.serializeVector(this.orders);
        serializer.serializeU32AsUleb128(this.grouping);
    }
}

// ============================================================================
// DexCancelOrder
// ============================================================================

/**
 * Canonical `client_order_id` form: `0x` + 32 lowercase hex chars.
 * SDK input is not normalized; malformed strings are rejected locally before
 * serialization.
 */
const CLIENT_ORDER_ID_REGEX = /^0x[0-9a-f]{32}$/;
const CLIENT_ORDER_ID_STRING_LEN = 34;

/** All-zero literal - reserved by the chain as the "absent" sentinel. */
const CLIENT_ORDER_ID_NONE_LITERAL = "0x00000000000000000000000000000000";

/**
 * Validate a user-supplied client_order_id string and return it unchanged.
 * Throws on format violation or the reserved all-zero sentinel - matches the
 * Rust `validate_client_order_id_format` helper.
 */
export function validateClientOrderId(s: string): string {
    if (s.length !== CLIENT_ORDER_ID_STRING_LEN || !CLIENT_ORDER_ID_REGEX.test(s)) {
        throw new Error(
            `client_order_id must match \`^0x[0-9a-f]{32}$\` (lowercase hex), got ${JSON.stringify(s)}`,
        );
    }
    if (s === CLIENT_ORDER_ID_NONE_LITERAL) {
        throw new Error(
            "client_order_id `0x00..00` is reserved as the absent sentinel and cannot be used",
        );
    }
    return s;
}

/**
 * Discriminates how a cancel targets orders.
 *
 * Wire format (BCS enum):
 *   - `OrderId(u64)`        -> tag=0, then u64
 *   - `ClientOrderId(string)` -> tag=1, then BCS string
 */
export type DexCancelTarget =
    | { kind: "OrderId"; target_order_id: bigint }
    | { kind: "ClientOrderId"; client_order_id: string };

/**
 * Cancel a single order by its chain-assigned order_id.
 */
export function cancelByOrderId(target_order_id: bigint): DexCancelTarget {
    return { kind: "OrderId", target_order_id };
}

/**
 * Cancel the single OPEN order under the signer `address` carrying
 * `client_order_id`. Scope is account-global, no `symbol_id`
 * required. The id is validated as provided.
 */
export function cancelByClientOrderId(
    client_order_id: string,
): DexCancelTarget {
    return {
        kind: "ClientOrderId",
        client_order_id: validateClientOrderId(client_order_id),
    };
}

function serializeDexCancelTarget(target: DexCancelTarget, serializer: Serializer): void {
    switch (target.kind) {
        case "OrderId":
            serializer.serializeU32AsUleb128(0);
            serializer.serializeU64(target.target_order_id);
            break;
        case "ClientOrderId":
            serializer.serializeU32AsUleb128(1);
            serializer.serializeStr(target.client_order_id);
            break;
    }
}

export type DexReplaceTarget =
    | { kind: "OrderId"; target_order_id: bigint }
    | { kind: "ClientOrderId"; client_order_id: string }
    | {
          kind: "OrderIdWithContext";
          target_order_id: bigint;
          symbol_id: number;
          symbol_type: SymbolType;
      };

/** Legacy tag-0 target. Prefer `replaceByOrderIdWithContext` for new requests. */
export function replaceByOrderId(target_order_id: bigint): DexReplaceTarget {
    return { kind: "OrderId", target_order_id };
}

export function replaceByOrderIdWithContext(
    target_order_id: bigint,
    symbol_id: number,
    symbol_type: SymbolType,
): DexReplaceTarget {
    return {
        kind: "OrderIdWithContext",
        target_order_id,
        symbol_id,
        symbol_type,
    };
}

export function replaceByClientOrderId(
    client_order_id: string,
): DexReplaceTarget {
    return {
        kind: "ClientOrderId",
        client_order_id: validateClientOrderId(client_order_id),
    };
}

function serializeDexReplaceTarget(target: DexReplaceTarget, serializer: Serializer): void {
    switch (target.kind) {
        case "OrderId":
            serializer.serializeU32AsUleb128(0);
            serializer.serializeU64(target.target_order_id);
            break;
        case "ClientOrderId":
            serializer.serializeU32AsUleb128(1);
            serializer.serializeStr(target.client_order_id);
            break;
        case "OrderIdWithContext":
            serializer.serializeU32AsUleb128(2);
            serializer.serializeU64(target.target_order_id);
            serializer.serializeU32(target.symbol_id);
            serializer.serializeU32AsUleb128(target.symbol_type);
            break;
    }
}

export class DexCancelOrder extends Serializable {
    public readonly subAddress: AccountAddress;
    public readonly target: DexCancelTarget;
    public readonly symbol_type: SymbolType;

    constructor(
        subAddress: AccountAddress,
        target: DexCancelTarget,
        symbol_type: SymbolType,
    ) {
        super();
        this.subAddress = subAddress;
        this.target = target;
        this.symbol_type = symbol_type;
    }

    /** Convenience: cancel by chain-assigned order_id. */
    static byOrderId(
        subAddress: AccountAddress,
        target_order_id: bigint,
        symbol_type: SymbolType,
    ): DexCancelOrder {
        return new DexCancelOrder(subAddress, cancelByOrderId(target_order_id), symbol_type);
    }

    /**
     * Convenience: cancel the single OPEN order under `address` carrying the
     * given `client_order_id` (scope is account-global, so
     * `symbol_id` is no longer required).
     */
    static byClientOrderId(
        subAddress: AccountAddress,
        client_order_id: string,
        symbol_type: SymbolType,
    ): DexCancelOrder {
        return new DexCancelOrder(
            subAddress,
            cancelByClientOrderId(client_order_id),
            symbol_type,
        );
    }

    serialize(serializer: Serializer): void {
        this.subAddress.serialize(serializer);
        serializeDexCancelTarget(this.target, serializer);
        serializer.serializeU8(this.symbol_type);
    }
}

export class DexReplaceOrder extends Serializable {
    public readonly subAddress: AccountAddress;
    public readonly target: DexReplaceTarget;
    public readonly quantums: bigint | undefined;
    public readonly subticks: bigint | undefined;
    public readonly new_client_order_id: string | undefined;

    constructor(
        subAddress: AccountAddress,
        target: DexReplaceTarget,
        quantums?: bigint | null,
        subticks?: bigint | null,
        new_client_order_id?: string | null,
    ) {
        super();
        this.subAddress = subAddress;
        this.target = target;
        this.quantums = quantums == null ? undefined : quantums;
        this.subticks = subticks == null ? undefined : subticks;
        this.new_client_order_id =
            new_client_order_id == null ? undefined : validateClientOrderId(new_client_order_id);
    }

    static byOrderId(
        subAddress: AccountAddress,
        target_order_id: bigint,
        symbol_id: number,
        symbol_type: SymbolType,
        quantums?: bigint | null,
        subticks?: bigint | null,
        new_client_order_id?: string | null,
    ): DexReplaceOrder {
        return new DexReplaceOrder(
            subAddress,
            replaceByOrderIdWithContext(target_order_id, symbol_id, symbol_type),
            quantums,
            subticks,
            new_client_order_id,
        );
    }

    static byOrderIdWithContext(
        subAddress: AccountAddress,
        target_order_id: bigint,
        symbol_id: number,
        symbol_type: SymbolType,
        quantums: bigint,
        subticks: bigint,
        trigger_subticks: bigint,
        order_basic_type: OrderBasicType,
        condition_type: ConditionType,
        trigger_price_type: TriggerPriceType,
        new_client_order_id?: string | null,
    ): DexConditionReplaceOrder {
        return new DexConditionReplaceOrder(
            subAddress,
            replaceByOrderIdWithContext(target_order_id, symbol_id, symbol_type),
            quantums,
            subticks,
            trigger_subticks,
            order_basic_type,
            condition_type,
            trigger_price_type,
            new_client_order_id,
        );
    }

    static byClientOrderId(
        subAddress: AccountAddress,
        target_client_order_id: string,
        quantums?: bigint | null,
        subticks?: bigint | null,
        new_client_order_id?: string | null,
    ): DexReplaceOrder {
        return new DexReplaceOrder(
            subAddress,
            replaceByClientOrderId(target_client_order_id),
            quantums,
            subticks,
            new_client_order_id,
        );
    }

    serialize(serializer: Serializer): void {
        this.subAddress.serialize(serializer);
        serializeDexReplaceTarget(this.target, serializer);
        serializer.serializeBool(this.quantums !== undefined);
        if (this.quantums !== undefined) {
            serializer.serializeI64(this.quantums);
        }
        serializer.serializeBool(this.subticks !== undefined);
        if (this.subticks !== undefined) {
            serializer.serializeU64(this.subticks);
        }
        serializer.serializeOption(this.new_client_order_id);
    }
}

export class DexConditionReplaceOrder extends Serializable {
    public readonly subAddress: AccountAddress;
    public readonly target: DexReplaceTarget;
    public readonly quantums: bigint;
    public readonly subticks: bigint;
    public readonly trigger_subticks: bigint;
    public readonly order_basic_type: OrderBasicType;
    public readonly condition_type: ConditionType;
    public readonly trigger_price_type: TriggerPriceType;
    public readonly new_client_order_id: string | undefined;

    constructor(
        subAddress: AccountAddress,
        target: DexReplaceTarget,
        quantums: bigint,
        subticks: bigint,
        trigger_subticks: bigint,
        order_basic_type: OrderBasicType,
        condition_type: ConditionType,
        trigger_price_type: TriggerPriceType,
        new_client_order_id?: string | null,
    ) {
        super();
        if (trigger_subticks === 0n) {
            throw new Error("condition replace trigger_subticks must be non-zero");
        }
        if (condition_type === ConditionType.Unspecified) {
            throw new Error("condition replace condition_type must be specified");
        }
        if (order_basic_type === OrderBasicType.Market && subticks !== 0n) {
            throw new Error("condition replace market execution must not specify subticks");
        }
        if (order_basic_type === OrderBasicType.Limit && subticks === 0n) {
            throw new Error("condition replace limit execution must specify subticks");
        }
        if (order_basic_type === OrderBasicType.Unspecified) {
            throw new Error("condition replace order_basic_type must be Market or Limit");
        }

        this.subAddress = subAddress;
        this.target = target;
        this.quantums = quantums;
        this.subticks = subticks;
        this.trigger_subticks = trigger_subticks;
        this.order_basic_type = order_basic_type;
        this.condition_type = condition_type;
        this.trigger_price_type = trigger_price_type;
        this.new_client_order_id =
            new_client_order_id == null ? undefined : validateClientOrderId(new_client_order_id);
    }

    static byOrderId(
        subAddress: AccountAddress,
        target_order_id: bigint,
        quantums: bigint,
        subticks: bigint,
        trigger_subticks: bigint,
        order_basic_type: OrderBasicType,
        condition_type: ConditionType,
        trigger_price_type: TriggerPriceType,
        new_client_order_id?: string | null,
    ): DexConditionReplaceOrder {
        return new DexConditionReplaceOrder(
            subAddress,
            replaceByOrderId(target_order_id),
            quantums,
            subticks,
            trigger_subticks,
            order_basic_type,
            condition_type,
            trigger_price_type,
            new_client_order_id,
        );
    }

    static byClientOrderId(
        subAddress: AccountAddress,
        target_client_order_id: string,
        quantums: bigint,
        subticks: bigint,
        trigger_subticks: bigint,
        order_basic_type: OrderBasicType,
        condition_type: ConditionType,
        trigger_price_type: TriggerPriceType,
        new_client_order_id?: string | null,
    ): DexConditionReplaceOrder {
        return new DexConditionReplaceOrder(
            subAddress,
            replaceByClientOrderId(target_client_order_id),
            quantums,
            subticks,
            trigger_subticks,
            order_basic_type,
            condition_type,
            trigger_price_type,
            new_client_order_id,
        );
    }

    serialize(serializer: Serializer): void {
        this.subAddress.serialize(serializer);
        serializeDexReplaceTarget(this.target, serializer);
        serializer.serializeI64(this.quantums);
        serializer.serializeU64(this.subticks);
        serializer.serializeU64(this.trigger_subticks);
        serializer.serializeU8(this.order_basic_type);
        serializer.serializeU8(this.condition_type);
        serializer.serializeU8(this.trigger_price_type);
        serializer.serializeOption(this.new_client_order_id);
    }
}

// ============================================================================
// DexOrders (Place / Cancel / Replace / ReplaceCondition wrapper)
// ============================================================================

export class DexOrders extends Serializable {
    public readonly variant: DexOrdersVariant;
    public readonly orders:
        | DexPlaceOrders[]
        | DexCancelOrder[]
        | DexReplaceOrder[]
        | DexConditionReplaceOrder[];

    constructor(
        variant: DexOrdersVariant,
        orders:
            | DexPlaceOrders[]
            | DexCancelOrder[]
            | DexReplaceOrder[]
            | DexConditionReplaceOrder[] = [],
    ) {
        super();
        if (variant === DexOrdersVariant.Place) {
            DexOrders.validatePlaceOrderClientOrderIds(orders as DexPlaceOrders[]);
        }
        this.variant = variant;
        this.orders = orders;
    }

    /**
     * An amend whose replacement order is rejected rather than filled if it would cross the book.
     *
     * Use it for any amend not meant to take liquidity: the node packs it on arrival, where a
     * plain replace waits out the taker delay first. The guarantee is the engine's -- asking for
     * this shape and then pricing through the book costs the amend, never a fill. On the
     * cancel-and-replace path (a new price, a larger size, or a new client order id) the target is
     * already cancelled by the time the replacement is matched, so a crossing replacement leaves
     * neither order.
     */
    static replaceMakerOnly(orders: DexReplaceOrder[]): DexOrders {
        return new DexOrders(DexOrdersVariant.ReplaceMakerOnly, orders);
    }

    /**
     * The in-flight cancel: a DEX transaction with no orders whose only effect is to consume its
     * nonce.
     *
     * Submit it with the nonce of an order that may not have landed yet, and the two race for that
     * nonce; exactly one wins and the loser is discarded with no effect on chain. A committed noop
     * is the receipt -- it holds the nonce long enough that the order it cancels can never be
     * admitted again. An order already resting on the book needs a cancel naming it instead: by
     * then the engine knows the order and the nonce is no help.
     */
    static noop(): DexOrders {
        return new DexOrders(DexOrdersVariant.Noop);
    }

    private static validatePlaceOrderClientOrderIds(groups: DexPlaceOrders[]): void {
        const seen = new Set<string>();
        for (const group of groups) {
            for (const order of group.orders) {
                if (order.client_order_id === null || order.client_order_id === undefined) {
                    continue;
                }
                const clientOrderId = validateClientOrderId(order.client_order_id);
                const key = `${order.subAddress.toStringLong()}/${clientOrderId}`;
                if (seen.has(key)) {
                    throw new Error(
                        `duplicate client_order_id ${JSON.stringify(clientOrderId)} in place batch for sub_address ${order.subAddress.toStringLong()}`,
                    );
                }
                seen.add(key);
            }
        }
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU8(this.variant);
        if (this.variant === DexOrdersVariant.Noop) {
            // The tag is the whole payload. Writing an empty vector here would append a trailing
            // zero byte the node does not read, and the transaction would not deserialise.
            return;
        }
        serializer.serializeVector(this.orders as Serializable[]);
    }
}

// ============================================================================
// DexTx (nonce + orders + createdBy)
// ============================================================================

export class DexTx extends Serializable {
    public readonly nonce: bigint;
    public readonly orders: DexOrders;
    public readonly created_by: CreatedBy;
    public readonly onBehalfOf?: AccountAddress;

    constructor(
        nonce: bigint,
        orders: DexOrders,
        created_by: CreatedBy,
        onBehalfOf?: AccountAddress,
    ) {
        super();
        this.nonce = nonce;
        this.orders = orders;
        this.created_by = created_by;
        this.onBehalfOf = onBehalfOf;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        this.orders.serialize(serializer);
        serializer.serializeU8(this.created_by);
        serializer.serializeOption(this.onBehalfOf);
    }
}

// ============================================================================
// Transfer types
// ============================================================================

export class InternalTransferItem extends Serializable {
    public readonly from_subaddress: AccountAddress;
    public readonly to_subaddress: AccountAddress;
    public readonly asset_id: number;
    public readonly amount: bigint;
    public readonly account_type: AccountType;

    constructor(
        from_subaddress: AccountAddress,
        to_subaddress: AccountAddress,
        asset_id: number,
        amount: bigint,
        account_type: AccountType,
    ) {
        super();
        this.from_subaddress = from_subaddress;
        this.to_subaddress = to_subaddress;
        this.asset_id = asset_id;
        this.amount = amount;
        this.account_type = account_type;
    }

    serialize(serializer: Serializer): void {
        this.from_subaddress.serialize(serializer);
        this.to_subaddress.serialize(serializer);
        serializer.serializeU32(this.asset_id);
        serializer.serializeU64(this.amount);
        serializer.serializeU8(this.account_type);
    }
}

/**
 * Account-level transfer item (cross-account USDC transfer).
 * Used for transferring assets to another account (not between subaccounts).
 */
export class AccountTransferItem extends Serializable {
    public readonly to_account: AccountAddress;
    public readonly asset_id: number;
    public readonly amount: bigint;
    public readonly account_type: AccountType;

    constructor(
        to_account: AccountAddress,
        asset_id: number,
        amount: bigint,
        account_type: AccountType,
    ) {
        super();
        this.to_account = to_account;
        this.asset_id = asset_id;
        this.amount = amount;
        this.account_type = account_type;
    }

    serialize(serializer: Serializer): void {
        this.to_account.serialize(serializer);
        serializer.serializeU32(this.asset_id);
        serializer.serializeU64(this.amount);
        serializer.serializeU8(this.account_type);
    }
}

/**
 * CrossTransferItem for cross-chain transfers.
 * The Mint/Burn option is specified at the transaction level, not per-item.
 */
export class CrossTransferItem extends Serializable {
    public readonly to_account: AccountAddress;
    public readonly asset_id: number;
    public readonly amount: bigint;
    public readonly account_type: AccountType;

    constructor(
        to_account: AccountAddress,
        asset_id: number,
        amount: bigint,
        account_type: AccountType,
    ) {
        super();
        this.to_account = to_account;
        this.asset_id = asset_id;
        this.amount = amount;
        this.account_type = account_type;
    }

    serialize(serializer: Serializer): void {
        this.to_account.serialize(serializer);
        serializer.serializeU32(this.asset_id);
        serializer.serializeU64(this.amount);
        serializer.serializeU8(this.account_type);
    }
}

export type TransferItem = InternalTransferItem | AccountTransferItem | CrossTransferItem;

/**
 * Single bridge validator signature (secp256k1 ECDSA).
 */
export class BridgeSignature extends Serializable {
    public readonly r: Uint8Array; // 32 bytes
    public readonly s: Uint8Array; // 32 bytes
    public readonly v: number;     // u8

    constructor(r: Uint8Array, s: Uint8Array, v: number) {
        super();
        if (r.length !== 32) throw new Error("BridgeSignature r must be exactly 32 bytes");
        if (s.length !== 32) throw new Error("BridgeSignature s must be exactly 32 bytes");
        this.r = r;
        this.s = s;
        this.v = v;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeFixedBytes(this.r);
        serializer.serializeFixedBytes(this.s);
        serializer.serializeU8(this.v);
    }
}

/**
 * The n/m multisig carried alongside a privileged DexSystemConfig operation --
 * the listing and fee committees, and the bridge's own signer set when it
 * authorises its own rotation. Mirrors
 * `intention_types::transaction::dex_sys_config::MultiSigProof`.
 *
 * The chain's `EvmSignature` has the same layout as {@link BridgeSignature}
 * here (r[32] || s[32] || v), so that type is reused rather than duplicated.
 *
 * This SDK models no operation that needs a proof. The type lives here because
 * the proof rides the {@link DexOrderlessTx} envelope, which this package owns;
 * whoever builds the operation builds the proof to go with it.
 */
export class MultiSigProof extends Serializable {
    public readonly opDigest: Uint8Array;      // 32 bytes
    /**
     * The ledger timestamp after which the proof is refused. Bootstrap uses zero.
     *
     * It sits BETWEEN opDigest and signatures, which is the only position the
     * chain reads it from. Omitting it does not degrade gracefully: the chain
     * reads the signature vector's length prefix as the first byte of this u64
     * and rejects the transaction with an error naming neither the field nor
     * the side that differs.
     */
    public readonly expiresAtSecs: bigint;     // u64
    public readonly signatures: BridgeSignature[];

    constructor(opDigest: Uint8Array, expiresAtSecs: bigint, signatures: BridgeSignature[]) {
        super();
        if (opDigest.length !== 32) {
            throw new Error("MultiSigProof opDigest must be exactly 32 bytes, got " + opDigest.length);
        }
        this.opDigest = opDigest;
        this.expiresAtSecs = expiresAtSecs;
        this.signatures = signatures;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeFixedBytes(this.opDigest);
        serializer.serializeU64(this.expiresAtSecs);
        serializer.serializeU32AsUleb128(this.signatures.length);
        for (const sig of this.signatures) sig.serialize(serializer);
    }
}

/**
 * Proof of bridge validator consensus for cross-chain deposits.
 * Required for Mint; undefined for Burn (withdrawal).
 */
export class BridgeProof extends Serializable {
    public readonly msgId: Uint8Array;      // 32 bytes
    public readonly signerEpoch: bigint;     // u64
    public readonly signatures: BridgeSignature[];

    constructor(msgId: Uint8Array, signerEpoch: bigint, signatures: BridgeSignature[]) {
        super();
        if (msgId.length !== 32) throw new Error("BridgeProof msgId must be exactly 32 bytes");
        this.msgId = msgId;
        this.signerEpoch = signerEpoch;
        this.signatures = signatures;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeFixedBytes(this.msgId);
        serializer.serializeU64(this.signerEpoch);
        serializer.serializeVector(this.signatures);
    }
}

export class DexTransferTx extends Serializable {
    public readonly nonce: bigint;
    public readonly variant: DexTransferVariant;
    public readonly payload: TransferItem[];
    public readonly option?: CrossTransferOption;
    public readonly bridgeProof?: BridgeProof;

    constructor(
        nonce: bigint,
        variant: DexTransferVariant,
        payload: TransferItem[],
        option?: CrossTransferOption,
        bridgeProof?: BridgeProof,
    ) {
        super();
        this.nonce = nonce;
        this.variant = variant;
        this.payload = payload;
        this.option = option;
        this.bridgeProof = bridgeProof;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        serializer.serializeU64(this.nonce);
        switch (this.variant) {
            case DexTransferVariant.InternalTransfer:
                serializer.serializeVector(this.payload as InternalTransferItem[]);
                break;
            case DexTransferVariant.AccountTransfer:
                serializer.serializeVector(this.payload as AccountTransferItem[]);
                break;
            case DexTransferVariant.CrossTransfer:
                serializer.serializeU8(this.option!);
                serializer.serializeVector(this.payload as CrossTransferItem[]);
                serializer.serializeOption(this.bridgeProof);
                break;
            case DexTransferVariant.FaucetMint:
                serializer.serializeVector(this.payload as CrossTransferItem[]);
                break;
            default:
                throw new Error(`Unsupported DexTransferTx variant: ${this.variant}`);
        }
    }
}

/**
 * Helper: create a deposit-to-subaccount transfer.
 */
export function DepositToSubaccount(
    nonce: bigint,
    mainAddress: AccountAddress,
    subAddress: AccountAddress,
    assetId: number,
    amount: bigint,
    accountType: AccountType = AccountType.Perp,
): DexTransferTx {
    return new DexTransferTx(nonce, DexTransferVariant.InternalTransfer, [
        new InternalTransferItem(mainAddress, subAddress, assetId, amount, accountType),
    ]);
}

/**
 * Helper: create a withdraw-to-main transfer.
 */
export function WithdrawToMain(
    nonce: bigint,
    subAddress: AccountAddress,
    mainAddress: AccountAddress,
    assetId: number,
    amount: bigint,
    accountType: AccountType = AccountType.Perp,
): DexTransferTx {
    return new DexTransferTx(nonce, DexTransferVariant.InternalTransfer, [
        new InternalTransferItem(subAddress, mainAddress, assetId, amount, accountType),
    ]);
}

// ============================================================================
// Agent operations
// ============================================================================

export class AgentApprove extends Serializable {
    public readonly name: string;
    public readonly agentAddress: AccountAddress;
    public readonly expiryTimestamp: bigint;

    constructor(name: string, agentAddress: AccountAddress, expiryTimestamp: bigint) {
        super();
        this.name = name;
        this.agentAddress = agentAddress;
        this.expiryTimestamp = expiryTimestamp;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeStr(this.name);
        this.agentAddress.serialize(serializer);
        serializer.serializeU64(this.expiryTimestamp);
    }
}

export class AgentRevoke extends Serializable {
    public readonly name: string;

    constructor(name: string) {
        super();
        this.name = name;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeStr(this.name);
    }
}

/**
 * End every grant this master holds.
 *
 * No fields: the operation names an end state rather than a record, so its BCS is
 * the variant tag alone. Declarative and idempotent - an account with no grants is
 * a silent success with an empty write set, not a `DexAgentNotFound`.
 */
export class AgentRevokeAll extends Serializable {
    serialize(_serializer: Serializer): void {
        // Intentionally empty: the variant tag carries the whole operation.
    }
}

export class DexAgentTx extends Serializable {
    public readonly nonce: bigint;
    public readonly variant: AgentOperationVariant;
    public readonly operation: AgentApprove | AgentRevoke | AgentRevokeAll;

    constructor(
        nonce: bigint,
        variant: AgentOperationVariant,
        operation: AgentApprove | AgentRevoke | AgentRevokeAll,
    ) {
        super();
        this.nonce = nonce;
        this.variant = variant;
        this.operation = operation;
    }

    /** Revoke every grant: the variant and its empty operation always travel together. */
    static revokeAll(nonce: bigint): DexAgentTx {
        return new DexAgentTx(nonce, AgentOperationVariant.RevokeAll, new AgentRevokeAll());
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        serializer.serializeU32AsUleb128(this.variant);
        this.operation.serialize(serializer);
    }
}

// ============================================================================
// User config types (SetUserLeverage, ChangePositionMode, ChangeMarginMode, etc.)
// ============================================================================

const VALID_EXPONENT = -4;

function leverageToImLeverage(leverage: number): number {
    return Math.ceil(1 / leverage / 10 ** VALID_EXPONENT);
}

export class UserSymbolLeverage extends Serializable {
    public readonly symbolId: number;
    public readonly leverage: number;
    private readonly _imLeverage: number;
    private readonly _exponent: number;

    constructor(symbolId: number, leverage: number) {
        super();
        this.symbolId = symbolId;
        this.leverage = leverage;
        this._imLeverage = leverageToImLeverage(leverage);
        this._exponent = VALID_EXPONENT;
    }

    /** Initial-margin leverage exactly as serialized in BCS (i32). */
    get imLeverage(): number {
        return this._imLeverage;
    }

    /** Fixed-point exponent exactly as serialized in BCS (i32). */
    get exponent(): number {
        return this._exponent;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32(this.symbolId);
        serializer.serializeI32(this._imLeverage);
        serializer.serializeI32(this._exponent);
    }
}

export class SetUserLeverage extends Serializable {
    public readonly nonce: bigint;
    public readonly subAddress: AccountAddress;
    public readonly leverageInfo: UserSymbolLeverage[];
    public readonly onBehalfOf?: AccountAddress;

    constructor(
        nonce: bigint,
        subAddress: AccountAddress,
        leverageInfo: UserSymbolLeverage[],
        onBehalfOf?: AccountAddress,
    ) {
        super();
        this.nonce = nonce;
        this.subAddress = subAddress;
        this.leverageInfo = leverageInfo;
        this.onBehalfOf = onBehalfOf;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        this.subAddress.serialize(serializer);
        serializer.serializeVector(this.leverageInfo);
        serializer.serializeOption(this.onBehalfOf);
    }
}

export class ChangePositionMode extends Serializable {
    public readonly nonce: bigint;
    public readonly subAddress: AccountAddress;
    public readonly positionMode: OrderPositionMode;
    public readonly onBehalfOf?: AccountAddress;

    constructor(
        nonce: bigint,
        subAddress: AccountAddress,
        positionMode: OrderPositionMode,
        onBehalfOf?: AccountAddress,
    ) {
        super();
        this.nonce = nonce;
        this.subAddress = subAddress;
        this.positionMode = positionMode;
        this.onBehalfOf = onBehalfOf;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        this.subAddress.serialize(serializer);
        serializer.serializeU8(this.positionMode);
        serializer.serializeOption(this.onBehalfOf);
    }
}

export class SymbolMarginMode extends Serializable {
    public readonly symbolId: number;
    public readonly marginMode: MarginMode;

    constructor(symbolId: number, marginMode: MarginMode) {
        super();
        this.symbolId = symbolId;
        this.marginMode = marginMode;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32(this.symbolId);
        serializer.serializeU8(this.marginMode);
    }
}

export class ChangeMarginMode extends Serializable {
    public readonly nonce: bigint;
    public readonly subAddress: AccountAddress;
    public readonly marginModes: SymbolMarginMode[];
    public readonly onBehalfOf?: AccountAddress;

    constructor(
        nonce: bigint,
        subAddress: AccountAddress,
        marginModes: SymbolMarginMode[],
        onBehalfOf?: AccountAddress,
    ) {
        super();
        this.nonce = nonce;
        this.subAddress = subAddress;
        this.marginModes = marginModes;
        this.onBehalfOf = onBehalfOf;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        this.subAddress.serialize(serializer);
        serializer.serializeVector(this.marginModes);
        serializer.serializeOption(this.onBehalfOf);
    }
}

export class CreateSubAccount extends Serializable {
    public readonly nonce: bigint;
    public readonly name: string;

    constructor(nonce: bigint, name: string) {
        super();
        this.nonce = nonce;
        this.name = name;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        serializer.serializeStr(this.name);
    }
}

export class ModifySubAccount extends Serializable {
    public readonly nonce: bigint;
    public readonly name: string;
    public readonly subAddress: AccountAddress;
    public readonly onBehalfOf?: AccountAddress;

    constructor(
        nonce: bigint,
        name: string,
        subAddress: AccountAddress,
        onBehalfOf?: AccountAddress,
    ) {
        super();
        this.nonce = nonce;
        this.name = name;
        this.subAddress = subAddress;
        this.onBehalfOf = onBehalfOf;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        serializer.serializeStr(this.name);
        this.subAddress.serialize(serializer);
        serializer.serializeOption(this.onBehalfOf);
    }
}

/**
 * Per-side add / remove of isolated-margin collateral on an existing
 * isolated position, mirroring the chain `AdjustIsolatedMarginTx`.
 *
 * Semantics:
 * - `deltaLong > 0` moves USDC from the account balance into the long-side
 *   `long_imr_quota`; `deltaLong < 0` releases from the long pool back to
 *   the balance. `deltaShort` follows the same sign convention for the
 *   short side. At least one of the two deltas must be non-zero.
 * - The net balance change applied by the engine equals
 *   `-(deltaLong + deltaShort)`.
 *
 * BCS field order is fixed to match the chain definition:
 *   nonce (u64) -> subAddress (AccountAddress) -> symbolId (u32) ->
 *   deltaLong (i64) -> deltaShort (i64) -> onBehalfOf (Option<AccountAddress>).
 */
export class AdjustIsolatedMargin extends Serializable {
    public readonly nonce: bigint;
    public readonly subAddress: AccountAddress;
    public readonly symbolId: number;
    public readonly deltaLong: bigint; // i64 signed delta on the long-side pool
    public readonly deltaShort: bigint; // i64 signed delta on the short-side pool
    public readonly onBehalfOf?: AccountAddress;

    constructor(
        nonce: bigint,
        subAddress: AccountAddress,
        symbolId: number,
        deltaLong: bigint,
        deltaShort: bigint,
        onBehalfOf?: AccountAddress,
    ) {
        super();
        this.nonce = nonce;
        this.subAddress = subAddress;
        this.symbolId = symbolId;
        this.deltaLong = deltaLong;
        this.deltaShort = deltaShort;
        this.onBehalfOf = onBehalfOf;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        this.subAddress.serialize(serializer);
        serializer.serializeU32(this.symbolId);
        serializer.serializeI64(this.deltaLong);
        serializer.serializeI64(this.deltaShort);
        serializer.serializeOption(this.onBehalfOf);
    }
}

// ============================================================================
// DexUserConfigTx (wrapper)
// ============================================================================

export class RegisterReferralCode extends Serializable {
    constructor(public readonly nonce: bigint, public readonly code: string) {
        super();
        if (!/^[A-Za-z0-9]{6,20}$/.test(code)) throw new Error("Referral code must be 6-20 ASCII letters or digits");
    }
    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        serializer.serializeStr(this.code);
    }
}

export class BindReferrer extends RegisterReferralCode {}

export class ClaimReferralRewards extends DexTransferTx {
    constructor(nonce: bigint, public readonly onBehalfOf?: AccountAddress) {
        super(nonce, DexTransferVariant.ClaimReferralRewards, []);
    }
    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(DexTransferVariant.ClaimReferralRewards);
        serializer.serializeU64(this.nonce);
        serializer.serializeOption(this.onBehalfOf);
    }
}

export type DexUserConfigTxPayload =
    | SetUserLeverage
    | ChangePositionMode
    | ChangeMarginMode
    | CreateSubAccount
    | ModifySubAccount
    | AdjustIsolatedMargin
    | RegisterReferralCode
    | BindReferrer;

export class DexUserConfigTx extends Serializable {
    public readonly variant: DexUserConfigTxVariant;
    public readonly payload: DexUserConfigTxPayload;

    constructor(variant: DexUserConfigTxVariant, payload: DexUserConfigTxPayload) {
        super();
        this.variant = variant;
        this.payload = payload;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        this.payload.serialize(serializer);
    }
}

// ============================================================================
// DexOrderlessTx (top-level wrapper)
// ============================================================================

/**
 * Carries an already-serialized DexOrderlessTx inner body under a variant tag
 * the caller supplies.
 *
 * Admin and system-config operations are deliberately not modelled in this SDK.
 * They are owned by the services that hold the keys for them, and they live in
 * a separate admin SDK. This type is what makes that possible without either
 * side forking the transaction stack: the caller owns the variant number and
 * the body's layout, and this package keeps owning the envelope, the signing
 * message and the authenticator.
 *
 * It knows nothing about any particular operation, and it should stay that way.
 * If a variant belongs in this SDK, model it properly; if it does not, it goes
 * through here.
 *
 * The body is written verbatim, so it must already be valid BCS for whatever
 * the chain expects after the variant tag. Nothing here can check that; the
 * caller's own golden vectors are what keep it honest.
 */
export class RawOrderlessInner extends Serializable {
    /** The inner payload's BCS, after the envelope's variant tag. */
    public readonly body: Uint8Array;

    constructor(body: Uint8Array) {
        super();
        this.body = body;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeFixedBytes(this.body);
    }
}

export interface ReferralParameters {
    inviteeFeeDiscountPpm: number;
    commissionRatePpm: number;
    referralThresholdVolume: bigint;
    discountVolumeCap: bigint;
    commissionVolumeCap: bigint;
    minClaimAmount: bigint;
}

/** `DexSystemConfigTx::Fee`: the domain the referral configuration belongs to. */
const DEX_SYSTEM_CONFIG_FEE_DOMAIN = 2;
/** `FeeTx::SetReferralConfig`, inside the Fee domain. */
const FEE_TX_SET_REFERRAL_CONFIG = 2;

export class SetReferralConfig extends RawOrderlessInner {
    constructor(public readonly nonce: bigint, public readonly parameters: ReferralParameters) {
        const s = new Serializer();
        if (!Number.isInteger(parameters.inviteeFeeDiscountPpm) || parameters.inviteeFeeDiscountPpm < 0 || parameters.inviteeFeeDiscountPpm > 1_000_000 ||
            !Number.isInteger(parameters.commissionRatePpm) || parameters.commissionRatePpm < 0 || parameters.commissionRatePpm > 1_000_000 ||
            parameters.referralThresholdVolume <= 0n || parameters.minClaimAmount <= 0n) throw new Error("Invalid referral configuration");
        s.serializeU32AsUleb128(DEX_SYSTEM_CONFIG_FEE_DOMAIN);
        s.serializeU32AsUleb128(FEE_TX_SET_REFERRAL_CONFIG);
        s.serializeU64(nonce);
        s.serializeU32(parameters.inviteeFeeDiscountPpm);
        s.serializeU32(parameters.commissionRatePpm);
        s.serializeU64(parameters.referralThresholdVolume);
        s.serializeU64(parameters.discountVolumeCap);
        s.serializeU64(parameters.commissionVolumeCap);
        s.serializeU64(parameters.minClaimAmount);
        super(s.toUint8Array());
    }
}

export type DexOrderlessTxInner =
    | DexTx
    | DexUserConfigTx
    | DexTransferTx
    | DexAgentTx
    | DexMultisigTx
    | RawOrderlessInner;

export class DexOrderlessTx extends Serializable {
    public readonly variant: DexOrderlessTxVariant;
    public readonly inner: DexOrderlessTxInner;
    /**
     * The second field of the chain's DexSystemConfig variant:
     *
     *     DexSystemConfig(DexSystemConfigTx, Option<MultiSigProof>)
     *
     * `undefined` encodes None, the legacy single-signer path and what every
     * caller wants until committee multisig is in use. Ignored for the other
     * variants, none of which carry a proof.
     */
    public readonly multiSigProof?: MultiSigProof;

    constructor(
        variant: DexOrderlessTxVariant,
        inner: DexOrderlessTxInner,
        multiSigProof?: MultiSigProof,
    ) {
        super();
        this.variant = variant;
        this.inner = inner;
        this.multiSigProof = multiSigProof;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        this.inner.serialize(serializer);

        // DexSystemConfig alone carries a second field. Omitting it makes the
        // node reject every system-config transaction: over BCS it runs out of
        // bytes ("expected option type"), and over JSON it rebuilds the payload
        // with None, re-serializes it a byte longer than what was signed, and
        // reports INVALID_SIGNATURE -- an error that points at neither the
        // field nor the side that differs. The other variants take no proof, so
        // the tag is written only here.
        if (this.variant === DexOrderlessTxVariant.DexSystemConfig) {
            serializer.serializeBool(this.multiSigProof !== undefined);
            if (this.multiSigProof !== undefined) {
                this.multiSigProof.serialize(serializer);
            }
        }
    }

    /**
     * Extract nonce from the inner transaction.
     */
    public get nonce(): bigint {
        // A caller using RawOrderlessInner tracks its own replay nonce -- it put
        // it in the body -- so the honest answer is "not known here". Returning
        // 0n would hand a submitter a nonce of zero and look authoritative.
        if (this.inner instanceof SetReferralConfig) return this.inner.nonce;
        if (this.inner instanceof RawOrderlessInner) {
            throw new Error("RawOrderlessInner has an opaque body; its nonce is not readable here");
        }
        // The envelope nonce of a multisig transaction, which is the submitting
        // key's and not the approved operation's -- the inner payload keeps its
        // own, and the owners' proof covers that one.
        if (this.variant === DexOrderlessTxVariant.Multisig) {
            return (this.inner as DexMultisigTx).nonce;
        }
        if (this.inner instanceof DexTx) return this.inner.nonce;
        if (this.inner instanceof DexTransferTx) return this.inner.nonce;
        if (this.inner instanceof DexAgentTx) return this.inner.nonce;
        if (this.inner instanceof DexUserConfigTx) {
            const p = this.inner.payload;
            if (p instanceof SetUserLeverage) return p.nonce;
            if (p instanceof ChangePositionMode) return p.nonce;
            if (p instanceof ChangeMarginMode) return p.nonce;
            if (p instanceof CreateSubAccount) return p.nonce;
            if (p instanceof ModifySubAccount) return p.nonce;
            if (p instanceof AdjustIsolatedMargin) return p.nonce;
            if (p instanceof RegisterReferralCode) return p.nonce;
        }
        throw new Error("Unknown inner transaction type or nonce not found");
    }
}

// ============================================================================
// TransactionPayloadDexOrderless
// ============================================================================

export class TransactionPayloadDexOrderless extends TransactionPayload {
    public readonly dexOrderlessTx: DexOrderlessTx;

    constructor(dexOrderlessTx: DexOrderlessTx) {
        super();
        this.dexOrderlessTx = dexOrderlessTx;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TransactionPayloadVariants.DexOrderless);
        this.dexOrderlessTx.serialize(serializer);
    }
}

export function isCrossTransferOrderlessPayload(
    payload: TransactionPayload,
): boolean {
    if (!(payload instanceof TransactionPayloadDexOrderless)) {
        return false;
    }

    const orderlessTx = payload.dexOrderlessTx;
    return (
        orderlessTx.variant === DexOrderlessTxVariant.DexTransfer &&
        orderlessTx.inner instanceof DexTransferTx &&
        orderlessTx.inner.variant === DexTransferVariant.CrossTransfer
    );
}

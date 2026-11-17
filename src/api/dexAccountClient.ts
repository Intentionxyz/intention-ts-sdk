// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/** Read-only user DEX account and order queries. */

import { parse } from "lossless-json";

import type { AccountAddress, AccountAddressInput } from "../core/accountAddress";
import type { Intention, IntentionConfig } from "./intention";

type JsonInteger = string | number | bigint;

function toBigInt(value: JsonInteger, field: string): bigint {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new Error(`${field} is not a safe JSON integer`);
    }
    try {
        return BigInt(value);
    } catch {
        throw new Error(`Invalid integer for ${field}: ${String(value)}`);
    }
}

function addressString(address: AccountAddressInput): string {
    return typeof address === "string" ? address : (address as AccountAddress).toString();
}

function sameAddress(left: string, right: AccountAddressInput): boolean {
    return left.toLowerCase() === addressString(right).toLowerCase();
}

async function readJson(
    response: Response,
    operation: string,
    readBody: (response: Response) => Promise<unknown> = (body) => body.json(),
): Promise<unknown> {
    if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `${operation} failed: ${response.status} ${response.statusText}${body ? `\n${body}` : ""}`,
        );
    }
    return readBody(response);
}

async function readExactIntegerJson(response: Response): Promise<unknown> {
    return parse(await response.text(), undefined, {
        parseNumber: (source) => {
            const value = Number(source);
            // Convert wide integers from their original digits before rounding.
            return !Number.isSafeInteger(value) && /^-?\d+$/.test(source)
                ? BigInt(source)
                : value;
        },
        onDuplicateKey: ({ newValue }) => newValue,
    });
}

export interface DexAssetPosition {
    assetId: number;
    quantums: bigint;
}

export interface DexPerpetualPosition {
    perpetualId: number;
    shortQuantums: bigint;
    longQuantums: bigint;
    marginMode: number;
    fundingIndex: bigint;
    longPositionValue: bigint;
    shortPositionValue: bigint;
    shortImrQuota: bigint;
    longImrQuota: bigint;
    shortMmrQuota: bigint;
    longMmrQuota: bigint;
    shortImrCloseFee: bigint;
    longImrCloseFee: bigint;
}

export interface DexAccountLeverageInfo {
    symbolId: number;
    imLeverage: number;
    exponent: number;
}

export interface DexAccountMarginModeInfo {
    symbolId: number;
    marginMode: number;
}

export interface DexDailyVolumeBucket {
    volumeUsd: bigint;
    makerVolumeUsd: bigint;
    utcDayStart: bigint;
    feeInflow: bigint;
}

export interface DexParentVolumeInfo {
    type: number;
    lastTradeTimestampSec: bigint;
    cumulativeVolumeUsd: bigint;
    volumeThresholdReached: boolean;
    dailyBuckets: DexDailyVolumeBucket[];
}

export interface DexAccountSnapshot {
    address: string;
    subAddress: string;
    name: string;
    availableMargin: bigint;
    positionMode: number;
    takerRate: number;
    makerRate: number;
    parentVolumeInfo: DexParentVolumeInfo;
    assets: DexAssetPosition[];
    perps: DexPerpetualPosition[];
    leverageInfos: DexAccountLeverageInfo[];
    marginModes: DexAccountMarginModeInfo[];
}

export interface DexOrderSnapshot {
    owner: string;
    subaccountNumber: number;
    symbolId: number;
    symbolType: number;
    side: number;
    quantums: bigint;
    subticks: bigint;
    orderBasicType: number;
    timeInForce: number;
    conditionType: number;
    operation: number;
    timestamp: bigint;
    targetOrderId: bigint;
    orderId: bigint;
    state: number;
    remainingQuantums: bigint;
    filledQuantums: bigint;
    reduceOnly: boolean;
    positionMode: number;
    openingFee: bigint;
    closingFee: bigint;
    transactionId: string;
    slippageTolerancePpm: number;
    createdBy: number;
    canceledBy: number;
    rejectReason: number;
}

export interface DexSystemAccounts {
    liquidationTakeoverAddress: string;
}

/** A market's delisting plan: the fields of the chain's plan key. */
export interface DexDelistingPlanView {
    planVersion: number;
    /** End of trading, Unix seconds; 0 once the plan is cancelled. */
    t0Secs: bigint;
    reduceOnlyLeadSecs: number;
    twapWindowSecs: number;
    maxCancelPerBlock: number;
    maxSettlePerBlock: number;
    /** `t0Secs - reduceOnlyLeadSecs`; 0 once cancelled. */
    reduceOnlyAtSecs: bigint;
    /** `t0Secs - twapWindowSecs`, when the price window opens; 0 once cancelled. */
    windowStartSecs: bigint;
}

/** A delisting's progress, kept on chain from the price window on. */
export interface DexDelistingRuntimeView {
    planVersion: number;
    /** Microseconds of samples behind the TWAP. */
    sampleWeightUs: bigint;
    canceledOrders: bigint;
    settledAccounts: bigint;
    settledQuantums: bigint;
    settledQuoteQuantums: bigint;
    /** Signed: every position's PnL at the final price. */
    expectedTotalPnl: bigint;
    /** Signed: the settlement PnL of the accounts settled so far. */
    realizedPnlSum: bigint;
    /** Shortfall made good by the liquidation takeover account. */
    shortfallQuote: bigint;
}

/** One market's delisting as `/dex/delistings` returns it. */
export interface DexDelistingView {
    perpetualId: number;
    symbolId: number;
    /** `BASE-QUOTE` from the market's display info; empty when it has none. */
    ticker: string;
    /** `SymbolStatus`; a value this SDK does not know is kept as read. */
    symbolStatus: number;
    /** `SCHEDULED`, `REDUCE_ONLY`, `SETTLING`, `CLOSED` or `CANCELLED`. */
    phase: string;
    /** `TRADING`, `PRE_SETTLEMENT`, `SETTLING` or `CLOSED`. */
    prdState: string;
    plan: DexDelistingPlanView;
    /** The TWAP so far inside the price window, the final price from T0; null before. */
    indicativePriceSubticks: bigint | null;
    /** Null before T0. */
    finalPriceSubticks: bigint | null;
    /** Null before the price window opens. */
    runtime: DexDelistingRuntimeView | null;
}

interface RawDexDelisting {
    perpetual_id: number;
    symbol_id: number;
    ticker: string;
    symbol_status: number;
    phase: string;
    prd_state: string;
    plan: {
        plan_version: number;
        t0_secs: JsonInteger;
        reduce_only_lead_secs: number;
        twap_window_secs: number;
        max_cancel_per_block: number;
        max_settle_per_block: number;
        reduce_only_at_secs: JsonInteger;
        window_start_secs: JsonInteger;
    };
    indicative_price_subticks: JsonInteger | null;
    final_price_subticks: JsonInteger | null;
    runtime: {
        plan_version: number;
        sample_weight_us: JsonInteger;
        canceled_orders: JsonInteger;
        settled_accounts: JsonInteger;
        settled_quantums: JsonInteger;
        settled_quote_quantums: JsonInteger;
        expected_total_pnl: JsonInteger;
        realized_pnl_sum: JsonInteger;
        shortfall_quote: JsonInteger;
    } | null;
}

interface RawDexAccount {
    address: string;
    sub_address: string;
    name: string;
    available_margin: JsonInteger;
    position_mode: number;
    taker_rate: number;
    maker_rate: number;
    parent_volume_info: {
        type_: number;
        last_trade_timestamp_sec: JsonInteger;
        cumulative_volume_usd: JsonInteger;
        volume_threshold_reached: boolean;
        daily_buckets: Array<{
            volume_usd: JsonInteger;
            maker_volume_usd: JsonInteger;
            utc_day_start: JsonInteger;
            fee_inflow: JsonInteger;
        }>;
    };
    assets: Array<{ asset_id: number; quantums: JsonInteger }>;
    perps: Array<{
        perpetual_id: number;
        short_quantums: JsonInteger;
        long_quantums: JsonInteger;
        margin_mode: number;
        funding_index: JsonInteger;
        long_position_value: JsonInteger;
        short_position_value: JsonInteger;
        short_imr_quota: JsonInteger;
        long_imr_quota: JsonInteger;
        short_mmr_quota: JsonInteger;
        long_mmr_quota: JsonInteger;
        short_imr_close_fee: JsonInteger;
        long_imr_close_fee: JsonInteger;
    }>;
    leverage_infos: Array<{ symbol_id: number; im_leverage: number; exponent: number }>;
    margin_modes: Array<{ symbol_id: number; margin_mode: number }>;
}

interface RawDexOrder {
    owner: string;
    subaccount_number: number;
    symbol_id: number;
    symbol_type: number;
    side: number;
    quantums: JsonInteger;
    subticks: JsonInteger;
    order_basic_type: number;
    time_in_force: number;
    condition_type: number;
    operation: number;
    timestamp: JsonInteger;
    target_order_id: JsonInteger;
    order_id: JsonInteger;
    state: number;
    remaining_quantums: JsonInteger;
    filled_quantums: JsonInteger;
    reduce_only: boolean;
    position_mode: number;
    opening_fee: JsonInteger;
    closing_fee: JsonInteger;
    transaction_id: string;
    slippage_tolerance_ppm: number;
    created_by: number;
    canceled_by: number;
    reject_reason: number;
}

function normalizeAccount(raw: RawDexAccount): DexAccountSnapshot {
    return {
        address: raw.address,
        subAddress: raw.sub_address,
        name: raw.name,
        availableMargin: toBigInt(raw.available_margin, "available_margin"),
        positionMode: raw.position_mode,
        takerRate: raw.taker_rate,
        makerRate: raw.maker_rate,
        parentVolumeInfo: {
            type: raw.parent_volume_info.type_,
            lastTradeTimestampSec: toBigInt(
                raw.parent_volume_info.last_trade_timestamp_sec,
                "last_trade_timestamp_sec",
            ),
            cumulativeVolumeUsd: toBigInt(
                raw.parent_volume_info.cumulative_volume_usd,
                "cumulative_volume_usd",
            ),
            volumeThresholdReached: raw.parent_volume_info.volume_threshold_reached,
            dailyBuckets: raw.parent_volume_info.daily_buckets.map((bucket) => ({
                volumeUsd: toBigInt(bucket.volume_usd, "volume_usd"),
                makerVolumeUsd: toBigInt(bucket.maker_volume_usd, "maker_volume_usd"),
                utcDayStart: toBigInt(bucket.utc_day_start, "utc_day_start"),
                feeInflow: toBigInt(bucket.fee_inflow, "fee_inflow"),
            })),
        },
        assets: raw.assets.map((asset) => ({
            assetId: asset.asset_id,
            quantums: toBigInt(asset.quantums, "asset.quantums"),
        })),
        perps: raw.perps.map((perp) => ({
            perpetualId: perp.perpetual_id,
            shortQuantums: toBigInt(perp.short_quantums, "short_quantums"),
            longQuantums: toBigInt(perp.long_quantums, "long_quantums"),
            marginMode: perp.margin_mode,
            fundingIndex: toBigInt(perp.funding_index, "funding_index"),
            longPositionValue: toBigInt(perp.long_position_value, "long_position_value"),
            shortPositionValue: toBigInt(perp.short_position_value, "short_position_value"),
            shortImrQuota: toBigInt(perp.short_imr_quota, "short_imr_quota"),
            longImrQuota: toBigInt(perp.long_imr_quota, "long_imr_quota"),
            shortMmrQuota: toBigInt(perp.short_mmr_quota, "short_mmr_quota"),
            longMmrQuota: toBigInt(perp.long_mmr_quota, "long_mmr_quota"),
            shortImrCloseFee: toBigInt(perp.short_imr_close_fee, "short_imr_close_fee"),
            longImrCloseFee: toBigInt(perp.long_imr_close_fee, "long_imr_close_fee"),
        })),
        leverageInfos: raw.leverage_infos.map((item) => ({
            symbolId: item.symbol_id,
            imLeverage: item.im_leverage,
            exponent: item.exponent,
        })),
        marginModes: raw.margin_modes.map((item) => ({
            symbolId: item.symbol_id,
            marginMode: item.margin_mode,
        })),
    };
}

function normalizeOrder(raw: RawDexOrder): DexOrderSnapshot {
    return {
        owner: raw.owner,
        subaccountNumber: raw.subaccount_number,
        symbolId: raw.symbol_id,
        symbolType: raw.symbol_type,
        side: raw.side,
        quantums: toBigInt(raw.quantums, "quantums"),
        subticks: toBigInt(raw.subticks, "subticks"),
        orderBasicType: raw.order_basic_type,
        timeInForce: raw.time_in_force,
        conditionType: raw.condition_type,
        operation: raw.operation,
        timestamp: toBigInt(raw.timestamp, "timestamp"),
        targetOrderId: toBigInt(raw.target_order_id, "target_order_id"),
        orderId: toBigInt(raw.order_id, "order_id"),
        state: raw.state,
        remainingQuantums: toBigInt(raw.remaining_quantums, "remaining_quantums"),
        filledQuantums: toBigInt(raw.filled_quantums, "filled_quantums"),
        reduceOnly: raw.reduce_only,
        positionMode: raw.position_mode,
        openingFee: toBigInt(raw.opening_fee, "opening_fee"),
        closingFee: toBigInt(raw.closing_fee, "closing_fee"),
        transactionId: raw.transaction_id,
        slippageTolerancePpm: raw.slippage_tolerance_ppm,
        createdBy: raw.created_by,
        canceledBy: raw.canceled_by,
        rejectReason: raw.reject_reason,
    };
}

function normalizeDelisting(raw: RawDexDelisting): DexDelistingView {
    const optional = (value: JsonInteger | null, field: string) => (
        value === null || value === undefined ? null : toBigInt(value, field)
    );
    const runtime = raw.runtime;
    return {
        perpetualId: raw.perpetual_id,
        symbolId: raw.symbol_id,
        ticker: raw.ticker,
        symbolStatus: raw.symbol_status,
        phase: raw.phase,
        prdState: raw.prd_state,
        plan: {
            planVersion: raw.plan.plan_version,
            t0Secs: toBigInt(raw.plan.t0_secs, "plan.t0_secs"),
            reduceOnlyLeadSecs: raw.plan.reduce_only_lead_secs,
            twapWindowSecs: raw.plan.twap_window_secs,
            maxCancelPerBlock: raw.plan.max_cancel_per_block,
            maxSettlePerBlock: raw.plan.max_settle_per_block,
            reduceOnlyAtSecs: toBigInt(raw.plan.reduce_only_at_secs, "plan.reduce_only_at_secs"),
            windowStartSecs: toBigInt(raw.plan.window_start_secs, "plan.window_start_secs"),
        },
        indicativePriceSubticks: optional(
            raw.indicative_price_subticks,
            "indicative_price_subticks",
        ),
        finalPriceSubticks: optional(raw.final_price_subticks, "final_price_subticks"),
        runtime: runtime
            ? {
                planVersion: runtime.plan_version,
                sampleWeightUs: toBigInt(runtime.sample_weight_us, "runtime.sample_weight_us"),
                canceledOrders: toBigInt(runtime.canceled_orders, "runtime.canceled_orders"),
                settledAccounts: toBigInt(runtime.settled_accounts, "runtime.settled_accounts"),
                settledQuantums: toBigInt(runtime.settled_quantums, "runtime.settled_quantums"),
                settledQuoteQuantums: toBigInt(
                    runtime.settled_quote_quantums,
                    "runtime.settled_quote_quantums",
                ),
                expectedTotalPnl: toBigInt(
                    runtime.expected_total_pnl,
                    "runtime.expected_total_pnl",
                ),
                realizedPnlSum: toBigInt(runtime.realized_pnl_sum, "runtime.realized_pnl_sum"),
                shortfallQuote: toBigInt(runtime.shortfall_quote, "runtime.shortfall_quote"),
            }
            : null,
    };
}

export interface DexAccountProvider {
    getAccounts(address: AccountAddressInput): Promise<DexAccountSnapshot[]>;
}

interface RawDexAuthority {
    account: string;
    version: number;
    epoch: number | string;
    updated_at_secs: number | string;
    kind: "key" | "policy";
    auth_key?: string;
    threshold?: number;
    owner_count?: number;
    owners?: string[];
    owners_digest?: string;
    created_at_secs?: number | string;
}

/**
 * One account's authority record, as `/dex/authority/{account}` reports it.
 *
 * `epoch` is reported for both kinds and keeps counting across a `Remove`: it is
 * what the next proof has to name, and an account that has left a policy does not
 * start again at one.
 */
export interface DexAuthority {
    account: string;
    version: number;
    epoch: bigint;
    updatedAtSecs: bigint;
    /** A named control key, or a k-of-n owner set. */
    kind: "key" | "policy";
    /** Set when `kind` is `key`. */
    authKey?: string;
    /** Set when `kind` is `policy`: approvals required. */
    threshold?: number;
    /** Set when `kind` is `policy`: the owners, lowercase 20-byte hex. */
    owners?: string[];
    /** Set when `kind` is `policy`: the commitment the audit event carries. */
    ownersDigest?: string;
    createdAtSecs?: bigint;
}

function normalizeAuthority(raw: RawDexAuthority): DexAuthority {
    const authority: DexAuthority = {
        account: raw.account,
        version: raw.version,
        epoch: toBigInt(raw.epoch, "epoch"),
        updatedAtSecs: toBigInt(raw.updated_at_secs, "updated_at_secs"),
        kind: raw.kind,
    };
    if (raw.kind === "key") {
        authority.authKey = raw.auth_key;
        return authority;
    }
    authority.threshold = raw.threshold;
    authority.owners = raw.owners;
    authority.ownersDigest = raw.owners_digest;
    if (raw.created_at_secs !== undefined) {
        authority.createdAtSecs = toBigInt(raw.created_at_secs, "created_at_secs");
    }
    return authority;
}

/** Node-backed `/dex/accounts`, `/dex/orders`, `/dex/authority` and `/dex/delistings` client. */
export class DexAccountClient implements DexAccountProvider {
    private readonly config: IntentionConfig;

    constructor(
        intention: Intention,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {
        this.config = intention.config;
    }

    async getAccounts(address: AccountAddressInput): Promise<DexAccountSnapshot[]> {
        if (!this.config.nodeUrl) throw new Error("getAccounts: IntentionConfig.nodeUrl is required");
        const url = `${this.config.nodeUrl.replace(/\/+$/, "")}/dex/accounts/${addressString(address)}`;
        const body = (await readJson(
            await this.fetchImpl(url, {
                headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
            }),
            "getAccounts",
            readExactIntegerJson,
        )) as { accounts?: RawDexAccount[] };
        return (body.accounts ?? []).map(normalizeAccount);
    }

    async getSystemAccounts(): Promise<DexSystemAccounts> {
        if (!this.config.nodeUrl) {
            throw new Error("getSystemAccounts: IntentionConfig.nodeUrl is required");
        }
        const url = `${this.config.nodeUrl.replace(/\/+$/, "")}/dex/system_accounts`;
        const body = (await readJson(
            await this.fetchImpl(url, {
                headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
            }),
            "getSystemAccounts",
        )) as Partial<DexSystemAccounts>;
        if (typeof body.liquidationTakeoverAddress !== "string") {
            throw new Error("getSystemAccounts: invalid liquidationTakeoverAddress");
        }
        return { liquidationTakeoverAddress: body.liquidationTakeoverAddress };
    }

    async getAccount(
        address: AccountAddressInput,
        subAddress: AccountAddressInput,
    ): Promise<DexAccountSnapshot | null> {
        const accounts = await this.getAccounts(address);
        return accounts.find((account) => sameAddress(account.subAddress, subAddress)) ?? null;
    }

    async getPositions(
        address: AccountAddressInput,
        subAddress: AccountAddressInput,
    ): Promise<DexPerpetualPosition[]> {
        return (await this.getAccount(address, subAddress))?.perps ?? [];
    }

    async getBalances(
        address: AccountAddressInput,
        subAddress: AccountAddressInput,
    ): Promise<DexAssetPosition[]> {
        return (await this.getAccount(address, subAddress))?.assets ?? [];
    }

    /**
     * What controls an account: `null` when it has no authority record.
     *
     * `null` is the default and not an error - the account is controlled by the
     * key its address derives from, which is every account that has never run a
     * multisig operation. The endpoint answers 404 for it, which this maps to
     * `null`; a rendered default would be indistinguishable from a node that
     * could not read state.
     */
    async getAuthority(address: AccountAddressInput): Promise<DexAuthority | null> {
        if (!this.config.nodeUrl) throw new Error("getAuthority: IntentionConfig.nodeUrl is required");
        const url = `${this.config.nodeUrl.replace(/\/+$/, "")}/dex/authority/${addressString(address)}`;
        const response = await this.fetchImpl(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (response.status === 404) return null;
        const body = (await readJson(response, "getAuthority")) as RawDexAuthority;
        return normalizeAuthority(body);
    }

    /**
     * Whether one multisig operation id has already been spent.
     *
     * Approvals are collected off chain and any owner may submit them, so the same
     * signed operation can be handed in twice. The chain accepts it once and
     * records the id; this is how a caller tells "my withdrawal already went
     * through" from "my submission was lost".
     */
    async isMultisigOperationUsed(opId: Uint8Array | string): Promise<boolean> {
        if (!this.config.nodeUrl) {
            throw new Error("isMultisigOperationUsed: IntentionConfig.nodeUrl is required");
        }
        const id =
            typeof opId === "string"
                ? opId
                : "0x" + Array.from(opId, (b) => b.toString(16).padStart(2, "0")).join("");
        const url = `${this.config.nodeUrl.replace(/\/+$/, "")}/dex/multisig/op/${id}`;
        const body = (await readJson(
            await this.fetchImpl(url, {
                headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
            }),
            "isMultisigOperationUsed",
        )) as { used?: boolean };
        if (typeof body.used !== "boolean") {
            throw new Error("isMultisigOperationUsed: response carried no `used` flag");
        }
        return body.used;
    }

    async getOrder(orderId: bigint): Promise<DexOrderSnapshot> {
        if (!this.config.nodeUrl) throw new Error("getOrder: IntentionConfig.nodeUrl is required");
        const url = `${this.config.nodeUrl.replace(/\/+$/, "")}/dex/orders/${orderId}`;
        return normalizeOrder(
            (await readJson(
                await this.fetchImpl(url, {
                    headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
                }),
                "getOrder",
                readExactIntegerJson,
            )) as RawDexOrder,
        );
    }

    /**
     * Every market with a delisting plan, cancelled and closed ones included, in
     * perpetual_id order. A node that predates delisting has no
     * such route, and no plans: it answers with an empty list.
     */
    async getDelistings(): Promise<DexDelistingView[]> {
        if (!this.config.nodeUrl) {
            throw new Error("getDelistings: IntentionConfig.nodeUrl is required");
        }
        const url = `${this.config.nodeUrl.replace(/\/+$/, "")}/dex/delistings`;
        const response = await this.fetchImpl(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (response.status === 404) return [];
        const body = (await readJson(response, "getDelistings")) as {
            delistings?: RawDexDelisting[];
        };
        return (body.delistings ?? []).map(normalizeDelisting);
    }

    /** One market's delisting, or null when the market has no plan (the node answers 404). */
    async getDelisting(perpetualId: number): Promise<DexDelistingView | null> {
        if (!this.config.nodeUrl) {
            throw new Error("getDelisting: IntentionConfig.nodeUrl is required");
        }
        if (!Number.isInteger(perpetualId) || perpetualId < 0 || perpetualId > 0xffff_ffff) {
            throw new Error(`getDelisting: perpetualId must be a u32, got ${perpetualId}`);
        }
        const url = `${this.config.nodeUrl.replace(/\/+$/, "")}/dex/delistings/${perpetualId}`;
        const response = await this.fetchImpl(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (response.status === 404) return null;
        return normalizeDelisting((await readJson(response, "getDelisting")) as RawDexDelisting);
    }
}

export interface OpenOrderRecord {
    orderId: bigint;
    clientOrderId: string | null;
    symbolId: number | null;
    symbol: string | null;
    subAddress: string;
}

export interface OpenOrdersProvider {
    getOpenOrders(args: {
        address: AccountAddressInput;
        subAddress: AccountAddressInput;
        symbolId?: number;
        symbol?: string;
    }): Promise<OpenOrderRecord[]>;
}

interface RelayerOrder {
    id: string | number;
    clientId?: string | null;
    clobPairId?: string | number | null;
    ticker?: string | null;
    subAddress: string;
}

/** Relayer-backed discovery used by true `cancelAll()` operations. */
export class RelayerOpenOrdersProvider implements OpenOrdersProvider {
    constructor(
        private readonly config: IntentionConfig,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    async getOpenOrders(args: {
        address: AccountAddressInput;
        subAddress: AccountAddressInput;
        symbolId?: number;
        symbol?: string;
    }): Promise<OpenOrderRecord[]> {
        const base = this.config.relayerUrl ?? this.config.dexRestUrl;
        if (!base) throw new Error("cancelAll: IntentionConfig.relayerUrl is required");
        const query = new URLSearchParams({
            address: addressString(args.address),
            status: "OPEN,PARTIALLY_FILLED",
            subAddress: addressString(args.subAddress),
        });
        const url = `${base.replace(/\/+$/, "")}/v1/orders?${query}`;
        const body = (await readJson(
            await this.fetchImpl(url, {
                headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
            }),
            "getOpenOrders",
        )) as { code?: number; message?: string; data?: { orders?: RelayerOrder[] } };
        if (body.code != null && body.code !== 0) {
            throw new Error(`getOpenOrders API error: ${body.message ?? body.code}`);
        }
        return (body.data?.orders ?? [])
            .map((order) => ({
                orderId: toBigInt(order.id, "order.id"),
                clientOrderId: order.clientId ?? null,
                symbolId:
                    order.clobPairId == null || !Number.isSafeInteger(Number(order.clobPairId))
                        ? null
                        : Number(order.clobPairId),
                symbol: order.ticker ?? null,
                subAddress: order.subAddress,
            }))
            .filter(
                (order) =>
                    sameAddress(order.subAddress, args.subAddress) &&
                    (args.symbolId == null ||
                        (order.symbolId != null
                            ? order.symbolId === args.symbolId
                            : args.symbol == null || order.symbol === args.symbol)),
            );
    }
}

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/** Unified, user-facing facade over the focused Intention SDK clients. */

import { Account } from "../core/account";
import { AccountAddress } from "../core/accountAddress";
import type { AccountAddressInput } from "../core/accountAddress";
import { OrderPositionMode } from "../types/enums";
import {
    AccountClient,
    type AccountActionExecutionOptions,
    type AccountActionSubmitOptions,
    type AdjustIsolatedMarginInput,
    type SetLeverageInput,
    type SetMarginModeInput,
    type SetPositionModeInput,
} from "../transactions/accountClient";
import {
    OrderClient,
    type MarketResolver,
    type OrderClientContext,
} from "../transactions/orderIntents";
import { SimpleMarketResolver } from "../transactions/marketResolver";
import { DexAccountClient, RelayerOpenOrdersProvider } from "./dexAccountClient";
import {
    Intention,
    IntentionConfig,
    type DexOrderlessSubmitOptions,
    type IntentionConfigArgs,
} from "./intention";
import {
    IntentionWebSocketClient,
    type IntentionWebSocketClientOptions,
    type WebSocketSubscriptionHandlers,
} from "./websocketClient";
import { VaultClient } from "./vaultClient";
import { ReferralClient } from "./referralClient";

function address(value: AccountAddressInput): AccountAddress {
    return AccountAddress.from(value, { maxMissingChars: 64 });
}

function normalizePositionMode(mode: SetPositionModeInput["mode"]): OrderPositionMode {
    if (mode === "one-way" || mode === OrderPositionMode.Net) return OrderPositionMode.Net;
    if (mode === "hedge" || mode === OrderPositionMode.Hedge) return OrderPositionMode.Hedge;
    throw new Error(`Unsupported position mode: ${String(mode)}`);
}

type WithoutSubAddress<T> = T extends unknown ? Omit<T, "subAddress"> : never;

export type TraderSetLeverageInput = WithoutSubAddress<SetLeverageInput>;
export type TraderSetPositionModeInput = WithoutSubAddress<SetPositionModeInput>;
export type TraderSetMarginModeInput = WithoutSubAddress<SetMarginModeInput>;
export type TraderAdjustIsolatedMarginInput = WithoutSubAddress<AdjustIsolatedMarginInput>;

export interface IntentionClientOptions extends IntentionConfigArgs {
    /** Server/script signer shared by all user-action clients. */
    signer: Account;
    /** Default gas and expiration overrides shared by account and order actions. */
    submitOptions?: DexOrderlessSubmitOptions;
    /** WebSocket transport/reconnect overrides. The socket is still created lazily. */
    websocketOptions?: IntentionWebSocketClientOptions;
}

export interface TraderClientOptions {
    subAddress: AccountAddressInput;
    /** Master account used for queries. Defaults to the configured signer's address. */
    address?: AccountAddressInput;
    /** Avoids an account lookup when already known. Otherwise it is resolved lazily. */
    positionMode?: OrderPositionMode;
    /** Avoids a relayer market lookup when already available. Otherwise it is resolved lazily. */
    resolver?: MarketResolver;
    /** Advanced OrderClient options; shared identity/context fields are owned by this facade. */
    order?: Omit<
        OrderClientContext,
        "intention" | "signer" | "subAddress" | "positionMode" | "resolver"
    >;
}

/** Cached perpetual-market metadata used by trader and account-scoped actions. */
export class IntentionMarketsClient {
    private resolver?: SimpleMarketResolver;
    private resolverPromise?: Promise<SimpleMarketResolver>;

    constructor(private readonly intention: Intention) {}

    fetchPerpetualMarkets(
        args?: Parameters<Intention["fetchPerpetualMarkets"]>[0],
    ): Promise<SimpleMarketResolver> {
        return this.intention.fetchPerpetualMarkets(args);
    }

    /** Return the cached active-market resolver, fetching it only on first use. */
    async getResolver(options: { refresh?: boolean } = {}): Promise<SimpleMarketResolver> {
        if (options.refresh) this.clearCache();
        if (this.resolver) return this.resolver;
        if (this.resolverPromise) return this.resolverPromise;

        const request = this.intention.fetchPerpetualMarkets({ statuses: ["ACTIVE"] });
        this.resolverPromise = request;
        try {
            this.resolver = await request;
            return this.resolver;
        } finally {
            if (this.resolverPromise === request) this.resolverPromise = undefined;
        }
    }

    clearCache(): void {
        this.resolver = undefined;
        this.resolverPromise = undefined;
    }
}

/** Account actions and account/order reads under one namespace. */
export class IntentionAccountsClient extends AccountClient {
    readonly query: DexAccountClient;
    private readonly defaultAddress: AccountAddress;

    constructor(context: ConstructorParameters<typeof AccountClient>[0]) {
        super(context);
        this.query = new DexAccountClient(context.intention);
        this.defaultAddress = context.signer.accountAddress;
    }

    getAccounts(addressInput: AccountAddressInput = this.defaultAddress) {
        return this.query.getAccounts(addressInput);
    }

    getAccount(
        subAddress: AccountAddressInput,
        addressInput: AccountAddressInput = this.defaultAddress,
    ) {
        return this.query.getAccount(addressInput, subAddress);
    }

    getPositions(
        subAddress: AccountAddressInput,
        addressInput: AccountAddressInput = this.defaultAddress,
    ) {
        return this.query.getPositions(addressInput, subAddress);
    }

    getBalances(
        subAddress: AccountAddressInput,
        addressInput: AccountAddressInput = this.defaultAddress,
    ) {
        return this.query.getBalances(addressInput, subAddress);
    }

    getOrder(orderId: bigint) {
        return this.query.getOrder(orderId);
    }
}

/**
 * Subaccount-scoped trading API. Construction is synchronous and side-effect
 * free; market metadata and position mode are loaded only before first use.
 */
export class TraderClient {
    readonly subAddress: AccountAddress;
    readonly address: AccountAddress;

    private readonly configuredPositionMode?: OrderPositionMode;
    private positionMode?: OrderPositionMode;
    private readonly providedResolver?: MarketResolver;
    private readonly orderOptions: NonNullable<TraderClientOptions["order"]>;
    private orderClientPromise?: Promise<OrderClient>;

    constructor(
        private readonly sdk: IntentionClient,
        options: TraderClientOptions,
    ) {
        this.subAddress = address(options.subAddress);
        this.address = address(options.address ?? sdk.signer.accountAddress);
        this.configuredPositionMode = options.positionMode;
        this.positionMode = options.positionMode;
        this.providedResolver = options.resolver;
        this.orderOptions = options.order ?? {};
    }

    /** Explicitly preload and validate lazy market/account context. */
    async prepare(): Promise<this> {
        await this.getOrderClient();
        return this;
    }

    /** Drop the scoped client so position mode is read again on next use. */
    refresh(): void {
        this.positionMode = this.configuredPositionMode;
        this.orderClientPromise = undefined;
    }

    private async resolvePositionMode(): Promise<OrderPositionMode> {
        if (this.positionMode != null) return this.positionMode;
        const snapshot = await this.sdk.accounts.getAccount(this.subAddress, this.address);
        if (!snapshot) {
            throw new Error(
                `DEX subaccount ${this.subAddress.toString()} was not found for ${this.address.toString()}`,
            );
        }
        if (
            snapshot.positionMode !== OrderPositionMode.Net &&
            snapshot.positionMode !== OrderPositionMode.Hedge
        ) {
            throw new Error(`Unsupported on-chain position mode: ${snapshot.positionMode}`);
        }
        this.positionMode = snapshot.positionMode;
        return this.positionMode;
    }

    private async getOrderClient(): Promise<OrderClient> {
        if (this.orderClientPromise) return this.orderClientPromise;
        const request = Promise.all([
            this.providedResolver ?? this.sdk.markets.getResolver(),
            this.resolvePositionMode(),
        ]).then(([resolver, positionMode]) => {
            const { submitOptions, ...orderOptions } = this.orderOptions;
            return new OrderClient({
                ...orderOptions,
                intention: this.sdk.intention,
                signer: this.sdk.signer,
                subAddress: this.subAddress,
                positionMode,
                resolver,
                submitOptions: { ...this.sdk.submitOptions, ...submitOptions },
            });
        });
        this.orderClientPromise = request;
        try {
            return await request;
        } catch (error) {
            if (this.orderClientPromise === request) this.orderClientPromise = undefined;
            throw error;
        }
    }

    private async accountClient(needsResolver: boolean): Promise<AccountClient> {
        return new AccountClient({
            intention: this.sdk.intention,
            signer: this.sdk.signer,
            resolver: needsResolver ? await this.sdk.markets.getResolver() : undefined,
            submitOptions: this.sdk.submitOptions,
        });
    }

    // Order placement -------------------------------------------------------

    async placeOrder(...args: Parameters<OrderClient["placeOrder"]>) {
        return (await this.getOrderClient()).placeOrder(...args);
    }

    async placeOrderWithTpSl(...args: Parameters<OrderClient["placeOrderWithTpSl"]>) {
        return (await this.getOrderClient()).placeOrderWithTpSl(...args);
    }

    async placePositionTpSl(...args: Parameters<OrderClient["placePositionTpSl"]>) {
        return (await this.getOrderClient()).placePositionTpSl(...args);
    }

    async placeOrders(...args: Parameters<OrderClient["placeOrders"]>) {
        return (await this.getOrderClient()).placeOrders(...args);
    }

    async submitOrder(...args: Parameters<OrderClient["submitOrder"]>) {
        return (await this.getOrderClient()).submitOrder(...args);
    }

    async submitOrderWithTpSl(...args: Parameters<OrderClient["submitOrderWithTpSl"]>) {
        return (await this.getOrderClient()).submitOrderWithTpSl(...args);
    }

    async submitPositionTpSl(...args: Parameters<OrderClient["submitPositionTpSl"]>) {
        return (await this.getOrderClient()).submitPositionTpSl(...args);
    }

    async submitOrders(...args: Parameters<OrderClient["submitOrders"]>) {
        return (await this.getOrderClient()).submitOrders(...args);
    }

    // Close -----------------------------------------------------------------

    async closePosition(...args: Parameters<OrderClient["closePosition"]>) {
        return (await this.getOrderClient()).closePosition(...args);
    }

    async closePositions(...args: Parameters<OrderClient["closePositions"]>) {
        return (await this.getOrderClient()).closePositions(...args);
    }

    async submitClosePosition(...args: Parameters<OrderClient["submitClosePosition"]>) {
        return (await this.getOrderClient()).submitClosePosition(...args);
    }

    async submitClosePositions(...args: Parameters<OrderClient["submitClosePositions"]>) {
        return (await this.getOrderClient()).submitClosePositions(...args);
    }

    // Cancel ----------------------------------------------------------------

    async cancelOrder(...args: Parameters<OrderClient["cancelOrder"]>) {
        return (await this.getOrderClient()).cancelOrder(...args);
    }

    async cancelOrders(...args: Parameters<OrderClient["cancelOrders"]>) {
        return (await this.getOrderClient()).cancelOrders(...args);
    }

    async cancelAll(...args: Parameters<OrderClient["cancelAll"]>) {
        return (await this.getOrderClient()).cancelAll(...args);
    }

    async cancelAllForSymbol(...args: Parameters<OrderClient["cancelAllForSymbol"]>) {
        return (await this.getOrderClient()).cancelAllForSymbol(...args);
    }

    async submitCancelOrder(...args: Parameters<OrderClient["submitCancelOrder"]>) {
        return (await this.getOrderClient()).submitCancelOrder(...args);
    }

    async submitCancelOrders(...args: Parameters<OrderClient["submitCancelOrders"]>) {
        return (await this.getOrderClient()).submitCancelOrders(...args);
    }

    async submitCancelAll(...args: Parameters<OrderClient["submitCancelAll"]>) {
        return (await this.getOrderClient()).submitCancelAll(...args);
    }

    async submitCancelAllForSymbol(
        ...args: Parameters<OrderClient["submitCancelAllForSymbol"]>
    ) {
        return (await this.getOrderClient()).submitCancelAllForSymbol(...args);
    }

    // Modify ----------------------------------------------------------------

    async modifyOrder(...args: Parameters<OrderClient["modifyOrder"]>) {
        return (await this.getOrderClient()).modifyOrder(...args);
    }

    async modifyOrders(...args: Parameters<OrderClient["modifyOrders"]>) {
        return (await this.getOrderClient()).modifyOrders(...args);
    }

    async modifyConditionOrder(...args: Parameters<OrderClient["modifyConditionOrder"]>) {
        return (await this.getOrderClient()).modifyConditionOrder(...args);
    }

    async modifyConditionOrders(...args: Parameters<OrderClient["modifyConditionOrders"]>) {
        return (await this.getOrderClient()).modifyConditionOrders(...args);
    }

    async submitModifyOrder(...args: Parameters<OrderClient["submitModifyOrder"]>) {
        return (await this.getOrderClient()).submitModifyOrder(...args);
    }

    async submitModifyOrders(...args: Parameters<OrderClient["submitModifyOrders"]>) {
        return (await this.getOrderClient()).submitModifyOrders(...args);
    }

    async submitModifyConditionOrder(
        ...args: Parameters<OrderClient["submitModifyConditionOrder"]>
    ) {
        return (await this.getOrderClient()).submitModifyConditionOrder(...args);
    }

    async submitModifyConditionOrders(
        ...args: Parameters<OrderClient["submitModifyConditionOrders"]>
    ) {
        return (await this.getOrderClient()).submitModifyConditionOrders(...args);
    }

    // Scoped queries --------------------------------------------------------

    getAccount() {
        return this.sdk.accounts.getAccount(this.subAddress, this.address);
    }

    getPositions() {
        return this.sdk.accounts.getPositions(this.subAddress, this.address);
    }

    getBalances() {
        return this.sdk.accounts.getBalances(this.subAddress, this.address);
    }

    getOrder(orderId: bigint) {
        return this.sdk.accounts.getOrder(orderId);
    }

    async getOpenOrders(symbol?: string) {
        const symbolId =
            symbol == null
                ? undefined
                : (await this.sdk.markets.getResolver()).symbolId(symbol);
        return new RelayerOpenOrdersProvider(this.sdk.config).getOpenOrders({
            address: this.address,
            subAddress: this.subAddress,
            symbol,
            symbolId,
        });
    }

    subscribe<T = unknown>(handlers: WebSocketSubscriptionHandlers<T>) {
        return this.sdk.realtime.subscribeSubaccount({
            address: this.address,
            subAddress: this.subAddress,
            handlers,
        });
    }

    // Scoped account settings ----------------------------------------------

    async setLeverage(
        input: TraderSetLeverageInput,
        options: AccountActionExecutionOptions = {},
    ) {
        const client = await this.accountClient(
            input.updates.some((update) => update.symbol != null),
        );
        return client.setLeverage({ ...input, subAddress: this.subAddress }, options);
    }

    async submitSetLeverage(
        input: TraderSetLeverageInput,
        options: AccountActionSubmitOptions = {},
    ) {
        const client = await this.accountClient(
            input.updates.some((update) => update.symbol != null),
        );
        return client.submitSetLeverage({ ...input, subAddress: this.subAddress }, options);
    }

    async setPositionMode(
        input: TraderSetPositionModeInput,
        options: AccountActionExecutionOptions = {},
    ) {
        const result = await (await this.accountClient(false)).setPositionMode(
            { ...input, subAddress: this.subAddress },
            options,
        );
        this.positionMode = normalizePositionMode(input.mode);
        this.orderClientPromise = undefined;
        return result;
    }

    async submitSetPositionMode(
        input: TraderSetPositionModeInput,
        options: AccountActionSubmitOptions = {},
    ) {
        const result = await (await this.accountClient(false)).submitSetPositionMode(
            { ...input, subAddress: this.subAddress },
            options,
        );
        this.positionMode = normalizePositionMode(input.mode);
        this.orderClientPromise = undefined;
        return result;
    }

    async setMarginMode(
        input: TraderSetMarginModeInput,
        options: AccountActionExecutionOptions = {},
    ) {
        const client = await this.accountClient(
            input.updates.some((update) => update.symbol != null),
        );
        return client.setMarginMode({ ...input, subAddress: this.subAddress }, options);
    }

    async submitSetMarginMode(
        input: TraderSetMarginModeInput,
        options: AccountActionSubmitOptions = {},
    ) {
        const client = await this.accountClient(
            input.updates.some((update) => update.symbol != null),
        );
        return client.submitSetMarginMode({ ...input, subAddress: this.subAddress }, options);
    }

    async adjustIsolatedMargin(
        input: TraderAdjustIsolatedMarginInput,
        options: AccountActionExecutionOptions = {},
    ) {
        const client = await this.accountClient(input.symbol != null);
        return client.adjustIsolatedMargin({ ...input, subAddress: this.subAddress }, options);
    }

    async submitAdjustIsolatedMargin(
        input: TraderAdjustIsolatedMarginInput,
        options: AccountActionSubmitOptions = {},
    ) {
        const client = await this.accountClient(input.symbol != null);
        return client.submitAdjustIsolatedMargin(
            { ...input, subAddress: this.subAddress },
            options,
        );
    }
}

/** Root facade: one configuration/signer, domain namespaces, scoped traders. */
export class IntentionClient {
    readonly config: IntentionConfig;
    readonly intention: Intention;
    readonly signer: Account;
    readonly submitOptions?: DexOrderlessSubmitOptions;
    readonly markets: IntentionMarketsClient;
    readonly accounts: IntentionAccountsClient;
    /** Read-only Vault queries. Vault transaction helpers are intentionally not exposed. */
    readonly vaults: VaultClient;
    readonly referrals: ReferralClient;

    private readonly websocketOptions?: IntentionWebSocketClientOptions;
    private realtimeClient?: IntentionWebSocketClient;

    constructor(options: IntentionClientOptions) {
        const { signer, submitOptions, websocketOptions, ...config } = options;
        this.config = new IntentionConfig(config);
        this.intention = new Intention(this.config);
        this.signer = signer;
        this.submitOptions = submitOptions;
        this.websocketOptions = websocketOptions;
        this.markets = new IntentionMarketsClient(this.intention);
        this.accounts = new IntentionAccountsClient({
            intention: this.intention,
            signer,
            submitOptions,
        });
        this.vaults = new VaultClient(this.intention);
        this.referrals=new ReferralClient(this.intention,signer,submitOptions);
    }

    /** Lazily create the WebSocket client; subscribing will connect it. */
    get realtime(): IntentionWebSocketClient {
        if (!this.realtimeClient) {
            this.realtimeClient = new IntentionWebSocketClient(this.config, {
                ...this.websocketOptions,
                autoConnect: this.websocketOptions?.autoConnect ?? false,
            });
        }
        return this.realtimeClient;
    }

    trader(options: TraderClientOptions): TraderClient {
        return new TraderClient(this, options);
    }

    getLedgerInfo() {
        return this.intention.getLedgerInfo();
    }

    waitForTransaction(...args: Parameters<Intention["waitForTransaction"]>) {
        return this.intention.waitForTransaction(...args);
    }

    close(): void {
        this.realtimeClient?.close();
        this.realtimeClient = undefined;
    }
}

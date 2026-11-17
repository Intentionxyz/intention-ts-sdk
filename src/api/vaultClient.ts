// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import type { Intention } from "./intention";

type JsonInteger = string | number;

/** Subaccount identity returned by the Vault REST API. */
export interface SubaccountIdResponse {
    address: string;
    number: number;
    sub_address: string;
    user_name: string;
}

export interface VaultSummary {
    vault_id: JsonInteger;
    vault_type: "CLP" | "UserVault" | string;
    status: "Active" | "Paused" | "Closed" | string;
    nav_e6: string;
    tvl_usdc: string;
    total_shares: string;
    lockup_seconds: number;
    vault_name: string;
    strategy_description: string;
    vault_account: SubaccountIdResponse;
    leader_account: SubaccountIdResponse;
    created_ts_us: JsonInteger;
    updated_ts_us: JsonInteger;
}

/** Backward-compatible alias. */
export type VaultState = VaultSummary;

export interface VaultClpConfig {
    primary_account: SubaccountIdResponse;
    symbol_accounts: Array<{ symbol_id: number; accounts: SubaccountIdResponse[] }>;
    trader_allowlist: ClpAllowlistEntry[];
    daily_withdraw_limit_bps: number;
    min_free_balance_ratio_bps: number;
}

export interface VaultDetail extends VaultSummary {
    always_proportional_close: boolean;
    accounts: SubaccountIdResponse[];
    profit_share_bps: number;
    clp_config: VaultClpConfig | null;
}

export interface VaultDepositor {
    vault_id: JsonInteger;
    depositor: SubaccountIdResponse;
    shares: string;
    avg_cost_nav_e6: string;
    last_deposit_ts_us: JsonInteger;
}

/** Backward-compatible alias. */
export type DepositorPosition = VaultDepositor;

export interface VaultAssetPosition {
    asset_id: number;
    quantums: JsonInteger;
}

export interface VaultPerpetualPosition {
    perpetual_id: number;
    short_quantums: JsonInteger;
    long_quantums: JsonInteger;
    margin_mode: number;
    funding_index: string;
    long_position_value: string;
    short_position_value: string;
    short_imr_quota: string;
    long_imr_quota: string;
    short_mmr_quota: string;
    long_mmr_quota: string;
    short_imr_close_fee: string;
    long_imr_close_fee: string;
}

export interface VaultAccountPositions {
    address: string;
    sub_address: string;
    number: number;
    assets: VaultAssetPosition[];
    perps: VaultPerpetualPosition[];
}

/** Backward-compatible alias for one account's position group. */
export type VaultPosition = VaultAccountPositions;

export interface VaultOrder {
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
    opening_fee: string;
    closing_fee: string;
    transaction_id: string;
    slippage_tolerance_ppm: number;
    created_by: number;
    canceled_by: number;
    reject_reason: number;
}

export interface VaultAccountOrders {
    address: string;
    sub_address: string;
    number: number;
    orders: VaultOrder[];
}

export interface ClpAllowlistEntry {
    clp_account: SubaccountIdResponse;
    traders: string[];
}

interface VaultListResponse {
    vaults: VaultSummary[];
}

interface VaultDepositorListResponse {
    vault_id: JsonInteger;
    depositors: VaultDepositor[];
}

interface VaultPositionsResponse {
    vault_id: JsonInteger;
    accounts: VaultAccountPositions[];
}

interface VaultOrdersResponse {
    vault_id: JsonInteger;
    accounts: VaultAccountOrders[];
}

/** Read-only Vault API client matching the node's actual response envelopes. */
export class VaultClient {
    private readonly baseUrl: string;
    private readonly headers?: Record<string, string>;
    private readonly includesVersion: boolean;

    constructor(
        baseUrlOrIntention: string | Intention,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {
        if (typeof baseUrlOrIntention === "string") {
            this.baseUrl = baseUrlOrIntention.replace(/\/+$/, "");
            this.includesVersion = /\/v1$/i.test(this.baseUrl);
        } else {
            this.baseUrl = baseUrlOrIntention.config.nodeUrl.replace(/\/+$/, "");
            this.headers = baseUrlOrIntention.config.clientConfig?.HEADERS;
            this.includesVersion = true;
        }
    }

    private path(path: string): string {
        return `${this.includesVersion ? "" : "/v1"}${path}`;
    }

    private async fetchJson<T>(path: string): Promise<T> {
        if (!this.baseUrl) throw new Error("VaultClient requires a node URL");
        const response = await this.fetchImpl(`${this.baseUrl}${this.path(path)}`, {
            headers: { Accept: "application/json", ...this.headers },
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(
                `Vault API request failed: ${response.status} ${response.statusText} (${path})${body ? `\n${body}` : ""}`,
            );
        }
        return response.json() as Promise<T>;
    }

    async getVaults(): Promise<VaultSummary[]> {
        return (await this.fetchJson<VaultListResponse>("/vaults")).vaults;
    }

    async getVault(vaultId: bigint | number): Promise<VaultDetail> {
        return this.fetchJson<VaultDetail>(`/vaults/${vaultId}`);
    }

    async getDepositors(
        vaultId: bigint | number,
        address?: string,
    ): Promise<VaultDepositor[]> {
        const query = address == null ? "" : `?address=${encodeURIComponent(address)}`;
        return (
            await this.fetchJson<VaultDepositorListResponse>(
                `/vaults/${vaultId}/depositors${query}`,
            )
        ).depositors;
    }

    async getPositions(vaultId: bigint | number): Promise<VaultAccountPositions[]> {
        return (
            await this.fetchJson<VaultPositionsResponse>(`/vaults/${vaultId}/positions`)
        ).accounts;
    }

    async getOrders(vaultId: bigint | number): Promise<VaultAccountOrders[]> {
        return (await this.fetchJson<VaultOrdersResponse>(`/vaults/${vaultId}/orders`)).accounts;
    }

    /** CLP read-only compatibility endpoint; no CLP/Admin transaction helpers are exposed. */
    async getClpAllowlist(): Promise<ClpAllowlistEntry[]> {
        const body = await this.fetchJson<
            ClpAllowlistEntry[] | { allowlist?: ClpAllowlistEntry[] }
        >("/vaults/clp/allowlist");
        return Array.isArray(body) ? body : (body.allowlist ?? []);
    }
}

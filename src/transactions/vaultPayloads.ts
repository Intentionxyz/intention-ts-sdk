// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Vault transaction types for the CLP and User Vault system.
 */

import { Serializable, Serializer } from "../bcs/serializer";
import { AccountAddress } from "../core/accountAddress";
import {
    VaultTxVariant,
    ClpTraderAllowlistAction,
    ManagedAccountAction,
    VaultStatus,
} from "../types/enums";

// =============================================================================
// Constants
// =============================================================================

/** Minimum initial deposit for UserVault in USDC quantums (100 USDC) */
export const VAULT_MIN_INITIAL_DEPOSIT_USDC = 100_000_000n;

/** Vault creation fee in USDC quantums (100 USDC), deducted from sender on vault creation */
export const VAULT_CREATION_FEE_USDC = 100_000_000n;

/** Minimum USDC value the leader must retain in the vault (100 USDC) */
export const MIN_LEADER_STAKE_USDC = 100_000_000n;

/** Minimum lockup period in seconds (1 day) */
export const VAULT_MIN_LOCKUP_SECONDS = 86400;

/** Maximum vault name length */
export const VAULT_NAME_MAX_LEN = 64;

/** Maximum strategy description length */
export const VAULT_STRATEGY_DESC_MAX_LEN = 512;

/** NAV precision: 1e6 fixed point */
export const NAV_PRECISION = 1_000_000n;

/** Basis points denominator (100% = 10000) */
export const BPS_DENOMINATOR = 10_000;

// =============================================================================
// Error Types
// =============================================================================

export class VaultValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VaultValidationError";
    }
}

export enum VaultErrorCode {
    Success = 0,
    InvalidParameter = 1,
    PermissionDenied = 2,
    VaultNotFound = 3,
    VaultAlreadyExists = 4,
    VaultPaused = 5,
    VaultClosed = 6,
    NonceAlreadyUsed = 7,
    InvalidVaultStatus = 8,
    DepositAmountTooSmall = 100,
    DepositAmountTooLarge = 101,
    InsufficientBalanceForDeposit = 102,
    LeaderMinOwnershipDepositViolation = 103,
    LockupNotExpired = 200,
    InsufficientShares = 201,
    InsufficientAvailableShares = 202,
    WithdrawExceedsLimit = 203,
    WithdrawRejectedByEngine = 204,
    FreeBalanceRatioTooLow = 205,
    DailyWithdrawLimitExceeded = 206,
    LeaderMinOwnershipViolation = 207,
    WithdrawRequestNotFound = 208,
    InvalidWithdrawRequestStatus = 209,
    PositionNotFound = 210,
    WithdrawQueueFull = 211,
    ClpNotInitialized = 300,
    ClpAlreadyInitialized = 301,
    InvalidClpAccount = 302,
    TraderNotInAllowlist = 303,
    InvalidSymbolAccounts = 304,
    NotVaultLeader = 400,
    InvalidVaultAccount = 401,
    VaultHasPendingWithdrawals = 402,
    VaultHasSharesOutstanding = 403,
    VaultNotFlat = 404,
    InsufficientParentTradingVolume = 405,
    DistributeAmountTooLarge = 450,
    DistributeAmountTooSmall = 451,
    NoDepositorsToDistribute = 452,
    DistributeHasPendingWithdrawals = 453,
    DistributeNotUserVault = 454,
    LeaderMinStakeViolation = 455,
    EngineCallFailed = 500,
    EngineInvalidData = 501,
    InternalError = 900,
    SerializationError = 901,
    StorageError = 902,
}

// =============================================================================
// Helper Types
// =============================================================================

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

/**
 * Symbol to accounts mapping entry (CLP config).
 */
export class SymbolAccountsEntry extends Serializable {
    public readonly symbol_id: number; // u32
    public readonly accounts: SubaccountId[];

    constructor(symbol_id: number, accounts: SubaccountId[]) {
        super();
        this.symbol_id = symbol_id;
        this.accounts = accounts;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32(this.symbol_id);
        serializer.serializeVector(this.accounts);
    }
}

/**
 * CLP trader allowlist entry.
 */
export class ClpTraderAllowlistEntry extends Serializable {
    public readonly clp_account: SubaccountId;
    public readonly traders: AccountAddress[];

    constructor(clp_account: SubaccountId, traders: AccountAddress[]) {
        super();
        this.clp_account = clp_account;
        this.traders = traders;
    }

    serialize(serializer: Serializer): void {
        this.clp_account.serialize(serializer);
        serializer.serializeVector(this.traders);
    }
}

// =============================================================================
// Vault Transaction Types
// =============================================================================

/**
 * Create UserVault transaction.
 */
export class VaultCreateTx extends Serializable {
    public readonly nonce: bigint;
    public readonly lockup_seconds: number;
    public readonly always_proportional_close: boolean;
    public readonly initial_deposit_usdc: bigint;
    public readonly vault_name: string;
    public readonly strategy_description: string;

    constructor(
        nonce: bigint,
        lockup_seconds: number,
        always_proportional_close: boolean,
        initial_deposit_usdc: bigint,
        vault_name: string,
        strategy_description: string,
    ) {
        super();
        if (initial_deposit_usdc < VAULT_MIN_INITIAL_DEPOSIT_USDC) {
            throw new VaultValidationError(
                `Initial deposit ${initial_deposit_usdc} must be at least ${VAULT_MIN_INITIAL_DEPOSIT_USDC} (100 USDC)`,
            );
        }
        if (lockup_seconds < VAULT_MIN_LOCKUP_SECONDS) {
            throw new VaultValidationError(
                `Lockup period ${lockup_seconds} must be at least ${VAULT_MIN_LOCKUP_SECONDS} seconds`,
            );
        }
        if (vault_name.length === 0 || vault_name.length > VAULT_NAME_MAX_LEN) {
            throw new VaultValidationError(
                `vault_name length must be 1-${VAULT_NAME_MAX_LEN}, got ${vault_name.length}`,
            );
        }
        if (!/^[A-Za-z0-9 _\-.]+$/.test(vault_name)) {
            throw new VaultValidationError("vault_name must match [A-Za-z0-9 _-.]");
        }
        if (vault_name !== vault_name.trim()) {
            throw new VaultValidationError("vault_name must not have leading/trailing whitespace");
        }
        if (
            strategy_description.length === 0 ||
            strategy_description.length > VAULT_STRATEGY_DESC_MAX_LEN
        ) {
            throw new VaultValidationError(
                `strategy_description length must be 1-${VAULT_STRATEGY_DESC_MAX_LEN}, got ${strategy_description.length}`,
            );
        }
        if (strategy_description !== strategy_description.trim()) {
            throw new VaultValidationError("strategy_description must not have leading/trailing whitespace");
        }

        this.nonce = nonce;
        this.lockup_seconds = lockup_seconds;
        this.always_proportional_close = always_proportional_close;
        this.initial_deposit_usdc = initial_deposit_usdc;
        this.vault_name = vault_name;
        this.strategy_description = strategy_description;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        serializer.serializeU32(this.lockup_seconds);
        serializer.serializeBool(this.always_proportional_close);
        serializer.serializeI128(this.initial_deposit_usdc);
        serializer.serializeStr(this.vault_name);
        serializer.serializeStr(this.strategy_description);
    }
}

/**
 * Deposit transaction.
 */
export class VaultDepositTx extends Serializable {
    public readonly vault_id: bigint;
    public readonly nonce: bigint;
    public readonly amount_usdc: bigint;

    constructor(vault_id: bigint, nonce: bigint, amount_usdc: bigint) {
        super();
        if (amount_usdc <= 0n) {
            throw new VaultValidationError("Deposit amount must be positive");
        }
        this.vault_id = vault_id;
        this.nonce = nonce;
        this.amount_usdc = amount_usdc;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.vault_id);
        serializer.serializeU64(this.nonce);
        serializer.serializeI128(this.amount_usdc);
    }
}

/**
 * Withdraw transaction.
 */
export class VaultWithdrawTx extends Serializable {
    public readonly vault_id: bigint;
    public readonly nonce: bigint;
    public readonly withdraw_shares: bigint;

    constructor(vault_id: bigint, nonce: bigint, withdraw_shares: bigint) {
        super();
        if (withdraw_shares <= 0n) {
            throw new VaultValidationError("Withdraw shares must be positive");
        }
        this.vault_id = vault_id;
        this.nonce = nonce;
        this.withdraw_shares = withdraw_shares;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.vault_id);
        serializer.serializeU64(this.nonce);
        serializer.serializeI128(this.withdraw_shares);
    }
}

/**
 * CLP configuration transaction.
 */
export class VaultClpConfigTx extends Serializable {
    public readonly nonce: bigint;
    public readonly bootstrap: boolean;
    public readonly primary_account?: SubaccountId;
    public readonly symbol_accounts?: SymbolAccountsEntry[];
    public readonly allowlist?: ClpTraderAllowlistEntry[];

    constructor(
        nonce: bigint,
        bootstrap: boolean,
        primary_account?: SubaccountId,
        symbol_accounts?: SymbolAccountsEntry[],
        allowlist?: ClpTraderAllowlistEntry[],
    ) {
        super();
        this.nonce = nonce;
        this.bootstrap = bootstrap;
        this.primary_account = primary_account;
        this.symbol_accounts = symbol_accounts;
        this.allowlist = allowlist;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        serializer.serializeBool(this.bootstrap);
        // Option<SubaccountId>
        serializer.serializeOption(this.primary_account);
        // Option<Vec<SymbolAccountsEntry>>
        serializer.serializeBool(this.symbol_accounts !== undefined);
        if (this.symbol_accounts !== undefined) {
            serializer.serializeVector(this.symbol_accounts);
        }
        // Option<Vec<ClpTraderAllowlistEntry>>
        serializer.serializeBool(this.allowlist !== undefined);
        if (this.allowlist !== undefined) {
            serializer.serializeVector(this.allowlist);
        }
    }
}

/**
 * Unified CLP managed account transaction (upsert, disable, remove).
 */
export class VaultClpManagedAccountTx extends Serializable {
    public readonly nonce: bigint;
    public readonly account: SubaccountId;
    public readonly action: ManagedAccountAction;
    public readonly memo?: string;

    constructor(nonce: bigint, account: SubaccountId, action: ManagedAccountAction, memo?: string) {
        super();
        this.nonce = nonce;
        this.account = account;
        this.action = action;
        this.memo = memo;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        this.account.serialize(serializer);
        serializer.serializeU32AsUleb128(this.action);
        // Option<String>
        serializer.serializeBool(this.memo !== undefined);
        if (this.memo !== undefined) {
            serializer.serializeStr(this.memo);
        }
    }
}

/**
 * Incremental CLP trader allowlist update transaction.
 */
export class VaultClpTraderAllowlistUpdateTx extends Serializable {
    public readonly nonce: bigint;
    public readonly clp_account: SubaccountId;
    public readonly action: ClpTraderAllowlistAction;
    public readonly traders: AccountAddress[];

    constructor(
        nonce: bigint,
        clp_account: SubaccountId,
        action: ClpTraderAllowlistAction,
        traders: AccountAddress[],
    ) {
        super();
        this.nonce = nonce;
        this.clp_account = clp_account;
        this.action = action;
        this.traders = traders;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        this.clp_account.serialize(serializer);
        serializer.serializeU32AsUleb128(this.action);
        serializer.serializeVector(this.traders);
    }
}

/**
 * Set vault parameters transaction.
 */
export class VaultSetParamsTx extends Serializable {
    public readonly nonce: bigint;
    public readonly vault_id: bigint;
    public readonly daily_withdraw_limit_bps?: number;
    public readonly min_free_balance_ratio_bps?: number;
    public readonly lockup_seconds?: number;
    public readonly always_proportional_close?: boolean;

    constructor(
        nonce: bigint,
        vault_id: bigint,
        daily_withdraw_limit_bps?: number,
        min_free_balance_ratio_bps?: number,
        lockup_seconds?: number,
        always_proportional_close?: boolean,
    ) {
        super();
        this.nonce = nonce;
        this.vault_id = vault_id;
        this.daily_withdraw_limit_bps = daily_withdraw_limit_bps;
        this.min_free_balance_ratio_bps = min_free_balance_ratio_bps;
        this.lockup_seconds = lockup_seconds;
        this.always_proportional_close = always_proportional_close;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        serializer.serializeU64(this.vault_id);
        // Option<u32>
        serializer.serializeBool(this.daily_withdraw_limit_bps !== undefined);
        if (this.daily_withdraw_limit_bps !== undefined) {
            serializer.serializeU32(this.daily_withdraw_limit_bps);
        }
        // Option<u32>
        serializer.serializeBool(this.min_free_balance_ratio_bps !== undefined);
        if (this.min_free_balance_ratio_bps !== undefined) {
            serializer.serializeU32(this.min_free_balance_ratio_bps);
        }
        // Option<u32>
        serializer.serializeBool(this.lockup_seconds !== undefined);
        if (this.lockup_seconds !== undefined) {
            serializer.serializeU32(this.lockup_seconds);
        }
        // Option<bool>
        serializer.serializeBool(this.always_proportional_close !== undefined);
        if (this.always_proportional_close !== undefined) {
            serializer.serializeBool(this.always_proportional_close);
        }
    }
}

/**
 * Set vault status transaction (pause, resume, close).
 */
export class VaultSetStatusTx extends Serializable {
    public readonly nonce: bigint;
    public readonly vault_id: bigint;
    public readonly target_status: VaultStatus;

    constructor(nonce: bigint, vault_id: bigint, target_status: VaultStatus) {
        super();
        this.nonce = nonce;
        this.vault_id = vault_id;
        this.target_status = target_status;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        serializer.serializeU64(this.vault_id);
        serializer.serializeU32AsUleb128(this.target_status);
    }
}

/**
 * Batch create CLP managed accounts transaction.
 */
export class VaultClpBatchCreateManagedAccountsTx extends Serializable {
    public readonly nonce: bigint;
    public readonly address: AccountAddress;
    public readonly start_number: number;
    public readonly count: number;
    public readonly user_name_prefix: string;
    public readonly memo: string;

    constructor(
        nonce: bigint,
        address: AccountAddress,
        start_number: number,
        count: number,
        user_name_prefix: string,
        memo: string,
    ) {
        super();
        this.nonce = nonce;
        this.address = address;
        this.start_number = start_number;
        this.count = count;
        this.user_name_prefix = user_name_prefix;
        this.memo = memo;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.nonce);
        this.address.serialize(serializer);
        serializer.serializeU32(this.start_number);
        serializer.serializeU32(this.count);
        serializer.serializeStr(this.user_name_prefix);
        serializer.serializeStr(this.memo);
    }
}

/**
 * Distribute transaction - leader distributes funds to all depositors proportionally (UserVault only).
 * Burns shares proportionally to keep NAV constant, deducts leader fee on profit.
 */
export class VaultDistributeTx extends Serializable {
    public readonly vault_id: bigint;
    public readonly nonce: bigint;
    public readonly distribute_amount_usdc: bigint;

    constructor(vault_id: bigint, nonce: bigint, distribute_amount_usdc: bigint) {
        super();
        if (distribute_amount_usdc <= 0n) {
            throw new VaultValidationError("Distribute amount must be positive");
        }
        this.vault_id = vault_id;
        this.nonce = nonce;
        this.distribute_amount_usdc = distribute_amount_usdc;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU64(this.vault_id);
        serializer.serializeU64(this.nonce);
        serializer.serializeI128(this.distribute_amount_usdc);
    }
}

// =============================================================================
// VaultTx Wrapper
// =============================================================================

export type VaultTxPayload =
    | VaultCreateTx
    | VaultDepositTx
    | VaultWithdrawTx
    | VaultClpConfigTx
    | VaultClpManagedAccountTx
    | VaultClpTraderAllowlistUpdateTx
    | VaultSetParamsTx
    | VaultSetStatusTx
    | VaultClpBatchCreateManagedAccountsTx
    | VaultDistributeTx;

/**
 * Vault transaction wrapper - mirrors VaultTx enum.
 */
export class VaultTx extends Serializable {
    public readonly variant: VaultTxVariant;
    public readonly inner: VaultTxPayload;

    constructor(variant: VaultTxVariant, inner: VaultTxPayload) {
        super();
        this.variant = variant;
        this.inner = inner;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(this.variant);
        this.inner.serialize(serializer);
    }

    public get nonce(): bigint {
        return this.inner.nonce;
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate the maximum amount that can be distributed while keeping the
 * leader's remaining vault value >= MIN_LEADER_STAKE_USDC.
 *
 * Formula:
 *   leader_value = floor(leader_shares * tvl_usdc / total_shares)
 *   max_distribute = floor((leader_value - MIN_LEADER_STAKE_USDC) * total_shares / leader_shares)
 */
export function calculateMaxDistributeForLeader(args: {
    leaderShares: bigint;
    totalShares: bigint;
    tvlUsdc: bigint;
}): bigint {
    const { leaderShares, totalShares, tvlUsdc } = args;

    if (leaderShares <= 0n || totalShares <= 0n || tvlUsdc <= 0n) {
        return 0n;
    }

    const leaderValue = (leaderShares * tvlUsdc) / totalShares;
    if (leaderValue <= MIN_LEADER_STAKE_USDC) {
        return 0n;
    }

    return ((leaderValue - MIN_LEADER_STAKE_USDC) * totalShares) / leaderShares;
}

// =============================================================================
// Builder Helpers
// =============================================================================

/**
 * Build a VaultCreate transaction.
 *
 * NOTE: A creation fee of {@link VAULT_CREATION_FEE_USDC} (100 USDC) is
 * automatically deducted from the sender's account on-chain.  The sender
 * must hold at least `initial_deposit_usdc + VAULT_CREATION_FEE_USDC`.
 */
export function buildVaultCreate(params: {
    nonce: bigint;
    lockup_seconds: number;
    always_proportional_close: boolean;
    initial_deposit_usdc: bigint;
    vault_name: string;
    strategy_description: string;
}): VaultTx {
    const inner = new VaultCreateTx(
        params.nonce,
        params.lockup_seconds,
        params.always_proportional_close,
        params.initial_deposit_usdc,
        params.vault_name,
        params.strategy_description,
    );
    return new VaultTx(VaultTxVariant.Create, inner);
}

export function buildVaultDeposit(params: {
    vault_id: bigint;
    nonce: bigint;
    amount_usdc: bigint;
}): VaultTx {
    const inner = new VaultDepositTx(
        params.vault_id,
        params.nonce,
        params.amount_usdc,
    );
    return new VaultTx(VaultTxVariant.Deposit, inner);
}

export function buildVaultWithdraw(params: {
    vault_id: bigint;
    nonce: bigint;
    withdraw_shares: bigint;
}): VaultTx {
    const inner = new VaultWithdrawTx(
        params.vault_id,
        params.nonce,
        params.withdraw_shares,
    );
    return new VaultTx(VaultTxVariant.Withdraw, inner);
}

export function buildVaultSetParams(params: {
    nonce: bigint;
    vault_id: bigint;
    daily_withdraw_limit_bps?: number;
    min_free_balance_ratio_bps?: number;
    lockup_seconds?: number;
    always_proportional_close?: boolean;
}): VaultTx {
    const inner = new VaultSetParamsTx(
        params.nonce,
        params.vault_id,
        params.daily_withdraw_limit_bps,
        params.min_free_balance_ratio_bps,
        params.lockup_seconds,
        params.always_proportional_close,
    );
    return new VaultTx(VaultTxVariant.SetParams, inner);
}

export function buildVaultSetStatus(params: {
    nonce: bigint;
    vault_id: bigint;
    target_status: VaultStatus;
}): VaultTx {
    const inner = new VaultSetStatusTx(
        params.nonce,
        params.vault_id,
        params.target_status,
    );
    return new VaultTx(VaultTxVariant.SetStatus, inner);
}

/**
 * Convenience wrapper for closing a vault.
 *
 * If the vault still has depositors with shares, the on-chain handler
 * will **automatically distribute** all remaining TVL to depositors
 * (proportional to their share ownership) before closing.
 *
 * Prerequisites:
 *  - Vault must have no open positions or pending orders.
 *  - Vault must have no pending withdrawal requests.
 *  - UserVault: sender must be the leader.
 *  - CLP: sender must be an admin.
 */
export function buildVaultClose(params: {
    nonce: bigint;
    vault_id: bigint;
}): VaultTx {
    return buildVaultSetStatus({
        nonce: params.nonce,
        vault_id: params.vault_id,
        target_status: VaultStatus.Closed,
    });
}

export function buildVaultDistribute(params: {
    vault_id: bigint;
    nonce: bigint;
    distribute_amount_usdc: bigint;
}): VaultTx {
    const inner = new VaultDistributeTx(
        params.vault_id,
        params.nonce,
        params.distribute_amount_usdc,
    );
    return new VaultTx(VaultTxVariant.Distribute, inner);
}

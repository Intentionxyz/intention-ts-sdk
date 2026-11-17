// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Unified DEX event decoder - hex-decode + BCS deserialize.
 *
 * Port of the on-chain event type + parser logic.
 *
 * REST API events have:
 *   - type: "0x0000...0001::dex::FillEvent" (Move type string)
 *   - data: hex-encoded BCS bytes (may or may not have 0x prefix)
 *
 * Parsing flow:
 *   1. Match event.type suffix against known DEX event tags
 *   2. hex decode event.data -> Uint8Array
 *   3. BCS deserialize -> typed event struct
 */

import {
    VAULT_EVENT_NAMES,
    decodeVaultEvent,
    type DexVaultInternalOffsetEvent,
} from "./vaultEvents";
import { Deserializer } from "../bcs/deserializer";
import { decodeReferralEvent, isReferralEvent, type ReferralEvent } from "./referralEvents";
import { AccountAddress } from "../core/accountAddress";
import { PerpetualTier } from "../types/enums";
import {
    AdlExecutionPass,
    AdlExecutionStatus,
    AdlMarginMode,
    AdlPositionSide,
    AdlSign,
    AdlSkipReasonCode,
    AdlSourceKind,
    AdlStopReason,
    AdlTriggerSource,
} from "../types/enums";
import {
    decodeFaucetMintEvent,
    decodeInternalTransferEvent,
    decodeAccountTransferEvent,
    decodeAuthorityChangedEvent,
    decodeMultisigOperationExecutedEvent,
    decodeCrossTransferEvent,
    decodeCreateSubAccountEvent,
    decodeModifySubAccountEvent,
    decodeSetUserLeverageEvent,
    decodeChangePositionModeEvent,
    decodeChangeMarginModeEvent,
    decodeAdjustIsolatedMarginEvent,
    decodeVaultCreatedEvent,
    decodeVaultUpdatedEvent,
    decodeVaultDepositedEvent,
    decodeVaultWithdrawRequestedEvent,
    decodeVaultWithdrawCompletedEvent,
    decodeVaultWithdrawRejectedEvent,
    decodeVaultWithdrawFailedEvent,
    decodeVaultSharesBurnedEvent,
    decodeVaultLeaderFeePaidEvent,
    decodeVaultDistributeEvent,
    decodeVaultDistributeDepositorEvent,
    decodeCreateSpotEvent,
    decodeCreatePerpetualEvent,
    decodeUpdateLeverageEvent,
    decodeSetAccountFeeRateEvent,
    decodeSetFeeConfigEvent,
    decodeUpdateBridgeSignersEvent,
    decodeSetBridgeFeesEvent,
    decodeSetFaucetMintEnabledEvent,
    decodeBatchSystemConfigEvent,
    decodeBatchOpFailedEvent,
    type BatchSystemConfigEvent,
    type BatchOpFailedEvent,
    type FaucetMintEvent,
    type InternalTransferEvent,
    type AccountTransferEvent,
    type AuthorityChangedEvent,
    type MultisigOperationExecutedEvent,
    type CrossTransferEvent,
    type CreateSubAccountEvent,
    type ModifySubAccountEvent,
    type SetUserLeverageEvent,
    type ChangePositionModeEvent,
    type ChangeMarginModeEvent,
    type AdjustIsolatedMarginEvent,
    type VaultCreatedEvent,
    type VaultUpdatedEvent,
    type VaultDepositedEvent,
    type VaultWithdrawRequestedEvent,
    type VaultWithdrawCompletedEvent,
    type VaultWithdrawErrorEvent,
    type VaultSharesBurnedEvent,
    type VaultLeaderFeePaidEvent,
    type VaultDistributeEvent,
    type VaultDistributeDepositorEvent,
    type SuccessEvent,
} from "./events";

// ============================================================================
// Shared helpers
// ============================================================================

const ACCOUNT_ID_LENGTH = 32;

function readAddress(d: Deserializer): string {
    const bytes = d.deserializeFixedBytes(ACCOUNT_ID_LENGTH);
    return new AccountAddress(bytes).toString();
}

function readSubaccountId(d: Deserializer): DexSubaccountId {
    return {
        address: readAddress(d),
        number: d.deserializeU32(),
        subAddress: readAddress(d),
        userName: d.deserializeFixedBytes(16),
    };
}

function readOptionString(d: Deserializer): string | null {
    return d.deserializeBool() ? d.deserializeStr() : null;
}

function readOptionU64(d: Deserializer): bigint | null {
    return d.deserializeBool() ? d.deserializeU64() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonU32(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
        throw new Error(`invalid u32 event field: ${String(value)}`);
    }
    return parsed;
}

function readJsonU64(value: unknown): bigint {
    if (
        typeof value !== "bigint" &&
        typeof value !== "string" &&
        !(typeof value === "number" && Number.isSafeInteger(value))
    ) {
        throw new Error(`invalid u64 event field: ${String(value)}`);
    }
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn) {
        throw new Error(`u64 event field out of range: ${String(value)}`);
    }
    return parsed;
}

function readJsonAddress(value: unknown): string {
    if (typeof value !== "string") {
        throw new Error("invalid address event field");
    }
    return AccountAddress.fromString(value, { maxMissingChars: 64 }).toString();
}

function readJsonOptionU64(value: unknown): bigint | null {
    if (!isRecord(value) || !Array.isArray(value.vec) || value.vec.length > 1) {
        throw new Error("invalid Move Option<u64> event field");
    }
    return value.vec.length === 0 ? null : readJsonU64(value.vec[0]);
}

function readJsonOptionString(value: unknown): string | null {
    if (!isRecord(value) || !Array.isArray(value.vec) || value.vec.length > 1) {
        throw new Error("invalid Move Option<String> event field");
    }
    if (value.vec.length === 0) {
        return null;
    }
    if (typeof value.vec[0] !== "string") {
        throw new Error("invalid Move Option<String> event field");
    }
    return value.vec[0];
}

function readTrailingOptionU32(d: Deserializer): number | null {
    if (d.remaining === 0) return null;
    return d.deserializeBool() ? d.deserializeU32() : null;
}

function hexToBytes(hex: string): Uint8Array {
    const h = hex.startsWith("0x") ? hex.slice(2) : hex;
    const bytes = new Uint8Array(h.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

// ============================================================================
// Event type tags (suffixes for matching)
// ============================================================================

const EVENT_TAGS = {
    FILL: "::dex::FillEvent",
    ORDER_PLACED: "::dex::OrderPlacedEvent",
    ORDER_CANCELLED: "::dex::OrderCancelledEvent",
    ORDER_AMENDED: "::dex::OrderAmendedEvent",
    ORDER_REJECTED: "::dex::OrderRejectedEvent",
    ORDER_FILLED: "::dex::OrderFilledEvent",
    CONDITION_ORDER_PLACED: "::dex::ConditionOrderPlacedEvent",
    CONDITION_ORDER_ACTIVATED: "::dex::ConditionOrderActivatedEvent",
    CONDITION_ORDER_PARENT_REBOUND: "::dex::ConditionOrderParentReboundEvent",
    CONDITION_ORDER_TRIGGERED: "::dex::ConditionOrderTriggeredEvent",
    WHOLE_POSITION_OCO_UPDATED: "::dex::WholePositionOcoUpdatedEvent",
    FUNDING_RATE: "::dex::FundingRateEvent",
    ACCOUNT: "::dex::AccountEvent",
    MARK_PRICE: "::dex::MarkPriceEvent",
    INDEX_PRICE: "::dex::IndexPriceEvent",
    FUNDING_PREDICTION: "::dex::FundingPredictionEvent",
    SET_SYMBOL_TRADING_POLICY: "::dex::SetSymbolTradingPolicyEvent",
    SET_SYMBOL_LEVERAGE_TIER: "::dex::SetSymbolLeverageTierEvent",
    SET_SYMBOL_DISPLAY_INFO: "::dex::SetSymbolDisplayInfoEvent",
    SYMBOL_OPENED: "::dex::SymbolOpenedEvent",
    // delisting events
    DELISTING_PLAN_SET: "::dex::DelistingPlanSetEvent",
    DELISTING_PRICED: "::dex::DelistingPricedEvent",
    DELISTING_SETTLED: "::dex::DelistingSettledEvent",
    SYMBOL_CLOSED: "::dex::SymbolClosedEvent",
    // liquidation telemetry events
    LIQUIDATION_RISK_TRANSFER: "::dex::LiquidationRiskTransferEvent",
    LIQUIDATION_INTERNAL_OFFSET: "::dex::LiquidationInternalOffsetEvent",
    LIQUIDATION_FAILED: "::dex::LiquidationFailedEvent",
    LIQUIDATION_DIRECT_ADL: "::dex::LiquidationDirectAdlEvent",
    ADL_EXECUTION: "::dex::AdlExecutionEvent",
    ADL_VAULT_INITIALIZED: "::dex::AdlVaultInitializedEvent",
    // transfer events
    FAUCET_MINT: "::dex::FaucetMintEvent",
    INTERNAL_TRANSFER: "::dex::InternalTransferEvent",
    ACCOUNT_TRANSFER: "::dex::AccountTransferEvent",
    // account authority (native multisig)
    AUTHORITY_CHANGED: "::dex::AuthorityChangedEvent",
    MULTISIG_OPERATION_EXECUTED: "::dex::MultisigOperationExecutedEvent",
    CROSS_TRANSFER: "::dex::CrossTransferEvent",
    // user_config events
    CREATE_SUB_ACCOUNT: "::dex::CreateSubAccountEvent",
    MODIFY_SUB_ACCOUNT: "::dex::ModifySubAccountEvent",
    SET_USER_LEVERAGE: "::dex::SetUserLeverageEvent",
    CHANGE_POSITION_MODE: "::dex::ChangePositionModeEvent",
    CHANGE_MARGIN_MODE: "::dex::ChangeMarginModeEvent",
    ADJUST_ISOLATED_MARGIN: "::dex::AdjustIsolatedMarginEvent",
    VAULT_CREATED: "::vault_events::VaultCreatedEvent",
    VAULT_UPDATED: "::vault_events::VaultUpdatedEvent",
    VAULT_DEPOSITED: "::vault_events::DepositedEvent",
    VAULT_WITHDRAW_REQUESTED: "::vault_events::WithdrawRequestedEvent",
    VAULT_WITHDRAW_COMPLETED: "::vault_events::WithdrawCompletedEvent",
    VAULT_WITHDRAW_REJECTED: "::vault_events::WithdrawRejectedEvent",
    VAULT_WITHDRAW_FAILED: "::vault_events::WithdrawFailedEvent",
    VAULT_SHARES_BURNED: "::vault_events::SharesBurnedEvent",
    VAULT_LEADER_FEE_PAID: "::vault_events::LeaderFeePaidEvent",
    VAULT_DISTRIBUTE: "::vault_events::DistributeEvent",
    VAULT_DISTRIBUTE_DEPOSITOR: "::vault_events::DistributeDepositorEvent",
    // sys_config events
    CREATE_SPOT: "::dex::CreateSpotEvent",
    CREATE_PERPETUAL: "::dex::CreatePerpetualEvent",
    UPDATE_LEVERAGE: "::dex::UpdateLeverageEvent",
    SET_ACCOUNT_FEE_RATE: "::dex::SetAccountFeeRateEvent",
    SET_FEE_CONFIG: "::dex::SetFeeConfigEvent",
    UPDATE_BRIDGE_SIGNERS: "::dex::UpdateBridgeSignersEvent",
    SET_BRIDGE_FEES: "::dex::SetBridgeFeesEvent",
    SET_FAUCET_MINT_ENABLED: "::dex::SetFaucetMintEnabledEvent",
    BATCH_SYSTEM_CONFIG: "::dex::BatchSystemConfigEvent",
    BATCH_OP_FAILED: "::dex::BatchOpFailedEvent",
    ADMIN_CONTROL_INITIALIZED: "::dex::AdminControlInitializedEvent",
    ADMIN_CONTROL_ENABLED: "::dex::AdminControlEnabledEvent",
    ADMIN_ACTION_SCHEDULED: "::dex::AdminActionScheduledEvent",
    ADMIN_ACTION_EXECUTED: "::dex::AdminActionExecutedEvent",
    ADMIN_ACTION_CANCELLED: "::dex::AdminActionCancelledEvent",
    ADMIN_ACTION_EXPIRED: "::dex::AdminActionExpiredEvent",
    ADMIN_ACTION_INVALIDATED: "::dex::AdminActionInvalidatedEvent",
    ADMIN_CONTROL_ROTATED: "::dex::AdminControlRotatedEvent",
    ADMIN_CONTROL_POLICY_UPDATED: "::dex::AdminControlPolicyUpdatedEvent",
    ADMIN_CONTROL_LISTING_SIGNER_SET_UPDATED: "::dex::AdminControlListingSignerSetUpdatedEvent",
    FEE_SIGNER_SET_UPDATED: "::dex::FeeSignerSetUpdatedEvent",
    FEE_CONFIG_UPDATED: "::dex::FeeConfigUpdatedEvent",
    ADMIN_CONTROL_ROLE_UPDATED: "::dex::AdminControlRoleUpdatedEvent",
    FEE_STATEMENT: "::transaction_fee::FeeStatement",
} as const;

// ============================================================================
// Type definitions - mirror the on-chain event types
// ============================================================================

export interface DexSubaccountId {
    address: string;
    number: number;
    subAddress: string;
    userName: Uint8Array;
}

export interface DexAssetPosition {
    assetId: number;
    balance: bigint;
    locked: bigint;
}

export interface DexPerpPosition {
    perpetualId: number;
    shortQuantums: bigint;
    longQuantums: bigint;
    deltaSellClosingLong: bigint;
    deltaBuyOpeningLong: bigint;
    deltaSellClosingShort: bigint;
    deltaBuyOpeningShort: bigint;
    marginMode: number;
    fundingIndex: bigint;
    longPositionValue: bigint;
    shortPositionValue: bigint;
    longImrQuota: bigint;
    shortImrQuota: bigint;
    longMmrQuota: bigint;
    shortMmrQuota: bigint;
    longBankruptPrice: bigint;
    shortBankruptPrice: bigint;
    longImrCloseFee: bigint;
    shortImrCloseFee: bigint;
}

export interface DexLeverageInfo {
    tier: PerpetualTier;
    minNotional: bigint;
    maxNotional: bigint;
    imLeverage: number;
    mmLeverage: number;
    exponent: number;
    maintenanceDeduction: bigint;
}

export interface DexSymbolLeverage {
    symbolId: number;
    leverageInfo: DexLeverageInfo;
}

export interface DexSymbolMarginMode {
    symbolId: number;
    marginMode: number;
}

// Kept as a standalone type for auxiliary/off-chain volume data. The on-chain
// AccountEvent parent volume snapshot no longer carries the per-day breakdown
// (it moved off-chain), so `dailyBuckets` is no longer part of
// DexParentVolumeInfo.
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
}

export interface DexMarkPriceInfo {
    symbolId: number;
    markPrice: bigint;
    exponent: number;
}

export interface DexIndexPriceInfo {
    symbolId: number;
    indexPrice: bigint;
    exponent: number;
}

export interface DexFundingPredictionInfo {
    symbolId: number;
    fundingRatePpm: number;
    timestamp: bigint;
}

// ============================================================================
// Event structs - field order matches the on-chain layout exactly for BCS compat
// ============================================================================

export interface DexFillEvent {
    symbolId: number;
    fillOrderId: bigint;
    makerOrderId: bigint;
    takerOrderId: bigint;
    filledQuantums: bigint;
    matchSubticks: bigint;
    blockHeight: bigint;
    fillTimestamp: bigint;
    makerSubaccountId: DexSubaccountId;
    makerDirection: number;
    makerOpenQuantums: bigint;
    makerCloseQuantums: bigint;
    makerOpeningFee: bigint;
    makerClosingFee: bigint;
    makerNewState: number;
    makerRealizedPnl: bigint;
    makerClientOrderId: string | null;
    takerSubaccountId: DexSubaccountId;
    takerDirection: number;
    takerOpenQuantums: bigint;
    takerCloseQuantums: bigint;
    takerOpeningFee: bigint;
    takerClosingFee: bigint;
    takerNewState: number;
    takerRealizedPnl: bigint;
    takerClientOrderId: string | null;
    /** Current on-chain layout; `null` for archived FillEvent payloads. */
    makerRemainingQuantums: bigint | null;
    /** Current on-chain layout; `null` for archived FillEvent payloads. */
    takerRemainingQuantums: bigint | null;
    /**
     * True for synthetic liquidation / ADL / self-cross fills
     * (`taker_tx_index == TX_INDEX_SYSTEM` on-chain). Trailing field on the
     * on-chain `FillEvent`; decoded backward-compatibly (`false` when absent).
     */
    isLiquidation: boolean;
}

export interface DexOrderPlacedEvent {
    subaccountId: DexSubaccountId;
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
    transactionId: Uint8Array;
    remainingQuantums: bigint;
    filledQuantums: bigint;
    openingFee: bigint;
    closingFee: bigint;
    reduceOnly: boolean;
    positionMode: number;
    createdBy: number;
    canceledBy: number;
    rejectReason: number;
    slippageTolerancePpm: number;
    triggerSubticks: bigint;
    triggerPriceType: number;
    parentOrderId: bigint;
    isActivated: boolean;
    /**
     * Optional user-supplied client_order_id (canonical form:
     * `0x` + 32 lowercase hex chars). `null` when the placer set no tag.
     * Mirrors the on-chain `DexOrderPlacedEvent.client_order_id` field.
     */
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
    /** Maker-risk fee rate captured by the order; null for old or pending conditional events. */
    reservationFeeRatePpm: number | null;
}

export interface DexOrderCancelledEvent {
    orderId: bigint;
    owner: string;
    subAddress: string;
    symbolId: number;
    remainingQuantums: bigint;
    canceledBy: number;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export interface DexOrderRejectedEvent {
    orderId: bigint;
    owner: string;
    subAddress: string;
    symbolId: number;
    rejectReason: number;
    transactionId: Uint8Array;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export interface DexOrderAmendedEvent {
    orderId: bigint;
    owner: string;
    subAddress: string;
    symbolId: number;
    oldQuantums: bigint;
    newQuantums: bigint;
    oldRemainingQuantums: bigint;
    newRemainingQuantums: bigint;
    keptPriority: boolean;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
    /** Maker-risk fee rate carried by the amended order; null for historical events. */
    reservationFeeRatePpm: number | null;
}

export interface DexOrderFilledEvent {
    orderId: bigint;
    owner: string;
    subAddress: string;
    symbolId: number;
    remainingQuantums: bigint;
    basicType: number;
    side: number;
    state: number;
    transactionId: Uint8Array;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export type DexConditionOrderPlacedEvent = DexOrderPlacedEvent;

export interface DexConditionOrderActivatedEvent {
    orderId: bigint;
    parentOrderId: bigint;
    owner: string;
    subAddress: string;
    symbolId: number;
    conditionType: number;
    clientOrderId: string | null;
    isActivated: boolean;
    activationState: number;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export interface DexConditionOrderParentReboundEvent {
    orderId: bigint;
    oldParentOrderId: bigint;
    newParentOrderId: bigint;
    owner: string;
    subAddress: string;
    symbolId: number;
    conditionType: number;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export interface DexConditionOrderTriggeredEvent {
    orderId: bigint;
    owner: string;
    subAddress: string;
    symbolId: number;
    conditionType: number;
    state: number;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export interface DexWholePositionOcoUpdatedEvent {
    owner: string;
    subAddress: string;
    symbolId: number;
    positionSide: number;
    groupId: bigint;
    takeProfitOrderId: bigint | null;
    stopLossOrderId: bigint | null;
    updateType: number;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export interface DexFundingRateEvent {
    symbolId: number;
    fundingRatePpm: number;
    markPrice: bigint;
    blockHeight: bigint;
    timestamp: bigint;
}

export interface DexAccountEvent {
    subaccountId: DexSubaccountId;
    positionMode: number;
    takerRate: number;
    makerRate: number;
    assetsSize: number;
    perpsSize: number;
    assets: DexAssetPosition[];
    perps: DexPerpPosition[];
    leverageInfosSize: number;
    leverageInfos: DexSymbolLeverage[];
    marginModesSize: number;
    marginModes: DexSymbolMarginMode[];
    parentVolumeInfo: DexParentVolumeInfo;
    blockHeight: bigint;
    timestamp: bigint;
}

export interface DexMarkPriceEvent {
    prices: DexMarkPriceInfo[];
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export interface DexIndexPriceEvent {
    prices: DexIndexPriceInfo[];
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export interface DexFundingPredictionEvent {
    predictions: DexFundingPredictionInfo[];
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export interface DexFeeStatementEvent {
    executionGasUnits: bigint;
    ioGasUnits: bigint;
    /** In the native coin's smallest unit (1e-8 of a coin). */
    storageFee: bigint;
    /** In the native coin's smallest unit (1e-8 of a coin). */
    storageFeeRefund: bigint;
    totalChargeGasUnits: bigint;
}

export interface DexAdminControlInitializedEvent {
    adminSignerEpoch: bigint;
    adminDelaySecs: bigint;
    adminActionExpirySecs: bigint;
    committeeDigest: Uint8Array;
}

export interface DexAdminControlEnabledEvent {
    enabledAtSecs: bigint;
}

export interface DexAdminActionScheduledEvent {
    operationId: Uint8Array;
    payloadDigest: Uint8Array;
    actionKind: number;
    signerEpoch: bigint;
    proposer: string;
    scheduledAtSecs: bigint;
    executableAtSecs: bigint;
    expiresAtSecs: bigint;
    signatureCount: number;
}

export interface DexAdminActionExecutedEvent extends Omit<DexAdminActionScheduledEvent, "proposer"> {
    executor: string;
    executedAtSecs: bigint;
}

export interface DexAdminActionCancelledEvent extends Omit<DexAdminActionScheduledEvent, "proposer"> {
    executor: string;
    cancelledAtSecs: bigint;
}

export interface DexAdminActionExpiredEvent {
    operationId: Uint8Array;
    payloadDigest: Uint8Array;
    actionKind: number;
    signerEpoch: bigint;
    executor: string;
    scheduledAtSecs: bigint;
    executableAtSecs: bigint;
    expiresAtSecs: bigint;
    expiredAtSecs: bigint;
}

export interface DexAdminActionInvalidatedEvent {
    operationId: Uint8Array;
    payloadDigest: Uint8Array;
    actionKind: number;
    signerEpoch: bigint;
    currentSignerEpoch: bigint;
    executor: string;
    scheduledAtSecs: bigint;
    executableAtSecs: bigint;
    expiresAtSecs: bigint;
    invalidatedAtSecs: bigint;
}

export interface DexAdminControlCommitteeUpdatedEvent {
    operationId: Uint8Array;
    oldEpoch: bigint;
    newEpoch: bigint;
    oldCommitteeDigest: Uint8Array;
    newCommitteeDigest: Uint8Array;
    executedAtSecs: bigint;
}

export interface DexAdminControlPolicyUpdatedEvent {
    operationId: Uint8Array;
    oldPolicyEpoch: bigint;
    newPolicyEpoch: bigint;
    oldAdminDelaySecs: bigint;
    newAdminDelaySecs: bigint;
    oldAdminActionExpirySecs: bigint;
    newAdminActionExpirySecs: bigint;
    executedAtSecs: bigint;
}

export interface DexFeeConfigUpdatedEvent {
    oldConfigDigest: Uint8Array;
    newConfigDigest: Uint8Array;
    signerEpoch: bigint;
}

export interface DexAdminControlRoleUpdatedEvent {
    operationId: Uint8Array;
    action: number;
    roleMask: bigint;
    targetCount: number;
    targetsDigest: Uint8Array;
}

export interface DexSetSymbolTradingPolicyEvent {
    perpetualId: number;
}

export interface DexSetSymbolLeverageTierEvent {
    perpetualId: number;
    tier: number;
}

export interface DexSetSymbolDisplayInfoEvent {
    perpetualId: number;
}

export interface DexSymbolOpenedEvent {
    perpetualId: number;
    listingTime: bigint;
    openingMarkPrice: bigint;
}

/**
 * A delisting plan was created, moved or cancelled; the fields are
 * the plan as written.
 */
export interface DexDelistingPlanSetEvent {
    perpetualId: number;
    symbolId: number;
    /** The plan's version after the write. */
    planVersion: number;
    /** End of trading, Unix seconds; 0 when the plan was cancelled. */
    t0Secs: bigint;
    reduceOnlyLeadSecs: number;
    twapWindowSecs: number;
    /** `t0Secs - reduceOnlyLeadSecs`; 0 when the plan was cancelled. */
    reduceOnlyAtSecs: bigint;
    maxCancelPerBlock: number;
    maxSettlePerBlock: number;
    blockHeight: bigint;
    timestampUs: bigint;
}

/** A delisting market was priced, once, in the block that reached T0. */
export interface DexDelistingPricedEvent {
    perpetualId: number;
    symbolId: number;
    planVersion: number;
    finalPriceSubticks: bigint;
    /** Microseconds of samples behind the TWAP. */
    sampleWeightUs: bigint;
    /** `DelistingPriceSource`; a value this SDK does not know is kept as read. */
    priceSource: number;
    /** Signed: every position's unrealized PnL at the final price, from the u128 bits. */
    expectedTotalPnl: bigint;
    blockHeight: bigint;
    timestampUs: bigint;
}

/** One leg of a settled account, longs before shorts. */
export interface DexDelistingSettledLeg {
    /** `DelistingLegSide`: 0 long, 1 short. */
    side: number;
    /** `DelistingLegMarginMode`: 0 Cross, 1 Isolated. */
    marginMode: number;
    quantums: bigint;
    /** Notional at the final price. */
    quoteQuantums: bigint;
    /** Signed: the leg's settlement PnL, fee-free, from the u128 bits. */
    realizedPnl: bigint;
    /** Made good by the liquidation takeover account; always 0 on a Cross leg. */
    isolatedShortfall: bigint;
}

/** An account was settled at the final price, one event per account. */
export interface DexDelistingSettledEvent {
    perpetualId: number;
    symbolId: number;
    owner: string;
    subAddress: string;
    subaccountNumber: number;
    finalPriceSubticks: bigint;
    legs: DexDelistingSettledLeg[];
    /** The account's Cross shortfall made good by the liquidation takeover account. */
    crossShortfall: bigint;
    blockHeight: bigint;
    timestampUs: bigint;
}

/** A delisted market closed for good: its last delisting event. */
export interface DexSymbolClosedEvent {
    perpetualId: number;
    symbolId: number;
    planVersion: number;
    finalPriceSubticks: bigint;
    settledAccounts: bigint;
    settledQuantums: bigint;
    settledQuoteQuantums: bigint;
    canceledOrders: bigint;
    /** Signed: sum of settlement PnL, equal to the priced event's `expectedTotalPnl`. */
    realizedPnlSum: bigint;
    shortfallQuote: bigint;
    blockHeight: bigint;
    timestampUs: bigint;
}

export interface DexLiquidationTriggerMark {
    symbolId: number;
    markSubticks: bigint;
}

/**
 * A liquidation routed straight into ADL because the symbol was already OPEN when this residual
 * was reached. It carries no takeover account - the fixed Liquidation Vault is not involved - and
 * no trigger snapshot, because the symbol was open before this residual rather than opened by it.
 */
// ============================================================================
// ADL execution contract
// Wire mirror of the on-chain ADL execution contract.
// ============================================================================

/** Sign-and-magnitude pair; the chain never writes a negative zero. */
export interface DexAdlSignedValue {
    sign: AdlSign;
    absValue: bigint;
}

export interface DexAdlEventId {
    triggerBlockHeight: bigint;
    triggerIndexInBlock: bigint;
}

export interface DexAdlDirectLiquidationLocator {
    blockHeight: bigint;
    directLiquidationIndexInBlock: bigint;
    flowInstanceId: Uint8Array;
    actionSeq: number;
}

/**
 * Custom wire shape: the source kind is followed by an optional Direct payload, so a Direct source
 * that is missing its locator is representable on the wire and rejected during validation.
 */
export interface DexAdlSourceLocator {
    sourceKind: AdlSourceKind;
    directLiquidationLocator: DexAdlDirectLiquidationLocator | null;
}

export interface DexAdlAccountLocator {
    ownerAddress: string;
    subaccountNumber: number;
    subAddress: string;
}

export interface DexAdlPositionKey {
    account: DexAdlAccountLocator;
    symbolId: number;
    positionSide: AdlPositionSide;
    marginMode: AdlMarginMode;
}

export interface DexAdlQueueKey {
    symbolId: number;
    opponentSide: AdlPositionSide;
}

export interface DexAdlSelectedPrefixHeader {
    schemaVersion: number;
    algorithmVersion: bigint;
    priceVersion: bigint;
    preAdlStateVersion: bigint;
    queueKey: DexAdlQueueKey;
    triggerSource: AdlTriggerSource;
    triggerReasons: AdlTriggerSource[];
    sourceLocator: DexAdlSourceLocator;
    sourceRiskHolder: DexAdlAccountLocator;
    originalLiquidatedAccount: DexAdlAccountLocator | null;
    sourcePositionKey: DexAdlPositionKey;
    bankruptcySubticks: bigint;
    targetQuantums: bigint;
    totalExecutedQuantums: bigint;
    stopReason: AdlStopReason;
}

export interface DexAdlAuditEntry {
    schemaVersion: number;
    auditEntryIndex: bigint;
    executionPass: AdlExecutionPass;
    rankIndex: bigint;
    positionKey: DexAdlPositionKey;
    rawSideQuantumsBefore: bigint;
    oppositeSideQuantumsBefore: bigint;
    scoreNumeratorSigned: DexAdlSignedValue;
    /** 0/0 operands mean an unscored global-tail Vault; signed 1/0 is a scored zero-entry-cost limit. */
    scoreDenominator: bigint;
    executionStatus: AdlExecutionStatus;
    executedQuantums: bigint;
    realizedPnlSigned: DexAdlSignedValue;
    skipReasonCode: AdlSkipReasonCode;
}

export interface DexAdlVaultTakeoverFill {
    schemaVersion: number;
    vaultAccount: DexAdlAccountLocator;
    leftoverQuantums: bigint;
    bankruptcySubticks: bigint;
    feeCharged: bigint;
}

export interface DexAdlExecutionEvent {
    schemaVersion: number;
    adlEventId: DexAdlEventId;
    chunkIndex: bigint;
    totalChunks: bigint;
    auditEntriesStartIndex: bigint;
    auditEntriesEndIndexExclusive: bigint;
    selectedPrefixHeader: DexAdlSelectedPrefixHeader;
    auditEntries: DexAdlAuditEntry[];
    vaultTakeoverFill: DexAdlVaultTakeoverFill | null;
    inputSnapshotHash: Uint8Array;
    selectedPrefixHash: Uint8Array;
    executionFillsDigest: Uint8Array;
}

export interface DexAdlVaultInitializedEvent {
    schemaVersion: number;
    vaultAddress: string;
    vaultSubAddress: string;
    vaultConfigVersion: bigint;
}

export interface DexLiquidationDirectAdlEvent {
    flowInstanceId: Uint8Array;
    sourceRiskUnitId: Uint8Array;
    sourceAccount: string;
    subAddress: string;
    subaccountNumber: number;
    symbolId: number;
    riskUnitType: number;
    side: number;
    targetQuantums: bigint;
    bankruptcySubticks: bigint;
    /** i64 bit-cast to u64; signed value via BigInt.asIntN(64, x). */
    sourceFeeBits: bigint;
    /** i64 bit-cast to u64; signed value via BigInt.asIntN(64, x). */
    sourceRealizedPnlBits: bigint;
    /** i64 bit-cast to u64; only the flow's terminal source event is non-zero. */
    sourceResidualSettledBits: bigint;
    sourceResidualBoundQuantums: bigint;
    blockHeight: bigint;
    timestampUs: bigint;
    actionSeq: number;
    txIndex: number;
}

export interface DexLiquidationRiskTransferEvent {
    flowInstanceId: Uint8Array;
    sourceRiskUnitId: Uint8Array;
    sourceAccount: string;
    subAddress: string;
    subaccountNumber: number;
    symbolId: number;
    riskUnitType: number;
    side: number;
    takeoverAccount: string;
    quantums: bigint;
    price: bigint;
    /** i64 bit-cast to u64; signed value via BigInt.asIntN(64, x). */
    feeBits: bigint;
    /** i64 bit-cast to u64; signed value via BigInt.asIntN(64, x). */
    realizedPnlBits: bigint;
    /** i64 bit-cast to u64; only the flow's last RiskTransfer is non-zero. */
    sourceResidualSettledBits: bigint;
    /**
     * Aggregate rounding envelope carried only by the flow's terminal Cross source event. Absent
     * on the pre-bound layout, which decodes to 0.
     */
    sourceResidualBoundQuantums: bigint;
    blockHeight: bigint;
    timestampUs: bigint;
    actionSeq: number;
    txIndex: number;
    /** Trigger-time NC restored from the on-chain u128 two's-complement bits. */
    triggerNc: bigint;
    triggerMmr: bigint;
    triggerMarks: DexLiquidationTriggerMark[];
}

export interface DexLiquidationInternalOffsetEvent {
    flowInstanceId: Uint8Array;
    sourceRiskUnitId: Uint8Array;
    sourceAccount: string;
    subAddress: string;
    subaccountNumber: number;
    symbolId: number;
    riskUnitType: number;
    quantums: bigint;
    price: bigint;
    /** i64 bit-cast to u64; signed value via BigInt.asIntN(64, x). */
    totalFeeBits: bigint;
    /** i64 bit-cast to u64; signed value via BigInt.asIntN(64, x). */
    totalRealizedPnlBits: bigint;
    /** i64 bit-cast to u64; signed value via BigInt.asIntN(64, x). */
    longRealizedPnlBits: bigint;
    /** i64 bit-cast to u64; signed value via BigInt.asIntN(64, x). */
    shortRealizedPnlBits: bigint;
    blockHeight: bigint;
    timestampUs: bigint;
    actionSeq: number;
    txIndex: number;
    triggerNc: bigint;
    triggerMmr: bigint;
    triggerMarks: DexLiquidationTriggerMark[];
}

export interface DexLiquidationFailedEvent {
    flowInstanceId: Uint8Array;
    sourceRiskUnitId: Uint8Array;
    sourceAccount: string;
    subAddress: string;
    subaccountNumber: number;
    /** Account-level failures (no symbol) use the sentinel `u32::MAX` (4294967295). */
    symbolId: number;
    riskUnitType: number;
    step: number;
    reasonCode: number;
    blockHeight: bigint;
    timestampUs: bigint;
    actionSeq: number;
    txIndex: number;
    triggerNc: bigint;
    triggerMmr: bigint;
    triggerMarks: DexLiquidationTriggerMark[];
}

// ============================================================================
// Decode functions - one per event type
// ============================================================================

function decodeFillEvent(bytes: Uint8Array): DexFillEvent {
    const d = new Deserializer(bytes);
    const event = {
        symbolId: d.deserializeU32(),
        fillOrderId: d.deserializeU64(),
        makerOrderId: d.deserializeU64(),
        takerOrderId: d.deserializeU64(),
        filledQuantums: d.deserializeU64(),
        matchSubticks: d.deserializeU64(),
        blockHeight: d.deserializeU64(),
        fillTimestamp: d.deserializeU64(),
        makerSubaccountId: readSubaccountId(d),
        makerDirection: d.deserializeU32(),
        makerOpenQuantums: d.deserializeU64(),
        makerCloseQuantums: d.deserializeU64(),
        makerOpeningFee: d.deserializeI128(),
        makerClosingFee: d.deserializeI128(),
        makerNewState: d.deserializeU32(),
        makerRealizedPnl: d.deserializeI128(),
        makerClientOrderId: readOptionString(d),
        takerSubaccountId: readSubaccountId(d),
        takerDirection: d.deserializeU32(),
        takerOpenQuantums: d.deserializeU64(),
        takerCloseQuantums: d.deserializeU64(),
        takerOpeningFee: d.deserializeI128(),
        takerClosingFee: d.deserializeI128(),
        takerNewState: d.deserializeU32(),
        takerRealizedPnl: d.deserializeI128(),
        takerClientOrderId: readOptionString(d),
    };

    let makerRemainingQuantums: bigint | null = null;
    let takerRemainingQuantums: bigint | null = null;
    let isLiquidation = false;
    const tailLength = d.remaining;
    if (tailLength === 16 || tailLength === 17) {
        makerRemainingQuantums = d.deserializeU64();
        takerRemainingQuantums = d.deserializeU64();
        if (d.remaining === 1) {
            isLiquidation = d.deserializeBool();
        }
    } else if (tailLength === 1) {
        // Historical layout after is_liquidation was introduced but before
        // order progress moved into FillEvent.
        isLiquidation = d.deserializeBool();
    } else if (tailLength !== 0) {
        throw new Error(`unexpected FillEvent trailing bytes: ${tailLength}`);
    }
    if (d.remaining !== 0) {
        throw new Error(`unexpected FillEvent trailing bytes: ${d.remaining}`);
    }
    return {
        ...event,
        makerRemainingQuantums,
        takerRemainingQuantums,
        isLiquidation,
    };
}

function decodeOrderPlacedEvent(bytes: Uint8Array): DexOrderPlacedEvent {
    const d = new Deserializer(bytes);
    return {
        subaccountId: readSubaccountId(d),
        symbolId: d.deserializeU32(),
        symbolType: d.deserializeU32(),
        side: d.deserializeU32(),
        quantums: d.deserializeI64(),
        subticks: d.deserializeU64(),
        orderBasicType: d.deserializeU32(),
        timeInForce: d.deserializeU32(),
        conditionType: d.deserializeU32(),
        operation: d.deserializeU32(),
        timestamp: d.deserializeU64(),
        targetOrderId: d.deserializeU64(),
        orderId: d.deserializeU64(),
        state: d.deserializeU32(),
        transactionId: d.deserializeBytes(),
        remainingQuantums: d.deserializeU64(),
        filledQuantums: d.deserializeU64(),
        openingFee: d.deserializeI128(),
        closingFee: d.deserializeI128(),
        reduceOnly: d.deserializeBool(),
        positionMode: d.deserializeU32(),
        createdBy: d.deserializeU32(),
        canceledBy: d.deserializeU32(),
        rejectReason: d.deserializeU32(),
        slippageTolerancePpm: d.deserializeU32(),
        triggerSubticks: d.deserializeU64(),
        triggerPriceType: d.deserializeU32(),
        parentOrderId: d.deserializeI64(),
        isActivated: d.deserializeBool(),
        // BCS Option<String>: 0x00 = None; 0x01 + length-prefixed UTF-8 = Some
        clientOrderId: readOptionString(d),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
        reservationFeeRatePpm: readTrailingOptionU32(d),
    };
}

function decodeOrderCancelledEvent(bytes: Uint8Array): DexOrderCancelledEvent {
    const d = new Deserializer(bytes);
    return {
        orderId: d.deserializeU64(),
        owner: readAddress(d),
        subAddress: readAddress(d),
        symbolId: d.deserializeU32(),
        remainingQuantums: d.deserializeU64(),
        canceledBy: d.deserializeU32(),
        clientOrderId: readOptionString(d),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeOrderRejectedEvent(bytes: Uint8Array): DexOrderRejectedEvent {
    const d = new Deserializer(bytes);
    return {
        orderId: d.deserializeU64(),
        owner: readAddress(d),
        subAddress: readAddress(d),
        symbolId: d.deserializeU32(),
        rejectReason: d.deserializeU32(),
        transactionId: d.deserializeBytes(),
        clientOrderId: readOptionString(d),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeOrderAmendedEvent(bytes: Uint8Array): DexOrderAmendedEvent {
    const d = new Deserializer(bytes);
    return {
        orderId: d.deserializeU64(),
        owner: readAddress(d),
        subAddress: readAddress(d),
        symbolId: d.deserializeU32(),
        oldQuantums: d.deserializeI64(),
        newQuantums: d.deserializeI64(),
        oldRemainingQuantums: d.deserializeU64(),
        newRemainingQuantums: d.deserializeU64(),
        keptPriority: d.deserializeBool(),
        clientOrderId: readOptionString(d),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
        reservationFeeRatePpm: readTrailingOptionU32(d),
    };
}

function decodeOrderFilledEvent(bytes: Uint8Array): DexOrderFilledEvent {
    const d = new Deserializer(bytes);
    return {
        orderId: d.deserializeU64(),
        owner: readAddress(d),
        subAddress: readAddress(d),
        symbolId: d.deserializeU32(),
        remainingQuantums: d.deserializeU64(),
        basicType: d.deserializeU32(),
        side: d.deserializeU32(),
        state: d.deserializeU32(),
        transactionId: d.deserializeBytes(),
        clientOrderId: readOptionString(d),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeConditionOrderTriggeredEvent(bytes: Uint8Array): DexConditionOrderTriggeredEvent {
    const d = new Deserializer(bytes);
    return {
        orderId: d.deserializeU64(),
        owner: readAddress(d),
        subAddress: readAddress(d),
        symbolId: d.deserializeU32(),
        conditionType: d.deserializeU32(),
        state: d.deserializeU32(),
        clientOrderId: readOptionString(d),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeConditionOrderActivatedEvent(
    bytes: Uint8Array,
): DexConditionOrderActivatedEvent {
    const d = new Deserializer(bytes);
    return {
        orderId: d.deserializeU64(),
        parentOrderId: d.deserializeU64(),
        owner: readAddress(d),
        subAddress: readAddress(d),
        symbolId: d.deserializeU32(),
        conditionType: d.deserializeU32(),
        clientOrderId: readOptionString(d),
        isActivated: d.deserializeBool(),
        activationState: d.deserializeU32(),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeConditionOrderActivatedEventJson(
    data: Record<string, unknown>,
): DexConditionOrderActivatedEvent {
    if (typeof data.is_activated !== "boolean") {
        throw new Error("invalid bool event field: is_activated");
    }
    return {
        orderId: readJsonU64(data.order_id),
        parentOrderId: readJsonU64(data.parent_order_id),
        owner: readJsonAddress(data.owner),
        subAddress: readJsonAddress(data.sub_address),
        symbolId: readJsonU32(data.symbol_id),
        conditionType: readJsonU32(data.condition_type),
        clientOrderId: readJsonOptionString(data.client_order_id),
        isActivated: data.is_activated,
        activationState: readJsonU32(data.activation_state),
        blockHeight: readJsonU64(data.block_height),
        blockTimestamp: readJsonU64(data.block_timestamp),
    };
}

function decodeConditionOrderParentReboundEvent(
    bytes: Uint8Array,
): DexConditionOrderParentReboundEvent {
    const d = new Deserializer(bytes);
    return {
        orderId: d.deserializeU64(),
        oldParentOrderId: d.deserializeU64(),
        newParentOrderId: d.deserializeU64(),
        owner: readAddress(d),
        subAddress: readAddress(d),
        symbolId: d.deserializeU32(),
        conditionType: d.deserializeU32(),
        clientOrderId: readOptionString(d),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeConditionOrderParentReboundEventJson(
    data: Record<string, unknown>,
): DexConditionOrderParentReboundEvent {
    return {
        orderId: readJsonU64(data.order_id),
        oldParentOrderId: readJsonU64(data.old_parent_order_id),
        newParentOrderId: readJsonU64(data.new_parent_order_id),
        owner: readJsonAddress(data.owner),
        subAddress: readJsonAddress(data.sub_address),
        symbolId: readJsonU32(data.symbol_id),
        conditionType: readJsonU32(data.condition_type),
        clientOrderId: readJsonOptionString(data.client_order_id),
        blockHeight: readJsonU64(data.block_height),
        blockTimestamp: readJsonU64(data.block_timestamp),
    };
}

function decodeWholePositionOcoUpdatedEvent(
    bytes: Uint8Array,
): DexWholePositionOcoUpdatedEvent {
    const d = new Deserializer(bytes);
    return {
        owner: readAddress(d),
        subAddress: readAddress(d),
        symbolId: d.deserializeU32(),
        positionSide: d.deserializeU32(),
        groupId: d.deserializeU64(),
        takeProfitOrderId: readOptionU64(d),
        stopLossOrderId: readOptionU64(d),
        updateType: d.deserializeU32(),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeWholePositionOcoUpdatedEventJson(
    data: Record<string, unknown>,
): DexWholePositionOcoUpdatedEvent {
    return {
        owner: readJsonAddress(data.owner),
        subAddress: readJsonAddress(data.sub_address),
        symbolId: readJsonU32(data.symbol_id),
        positionSide: readJsonU32(data.position_side),
        groupId: readJsonU64(data.group_id),
        takeProfitOrderId: readJsonOptionU64(data.take_profit_order_id),
        stopLossOrderId: readJsonOptionU64(data.stop_loss_order_id),
        updateType: readJsonU32(data.update_type),
        blockHeight: readJsonU64(data.block_height),
        blockTimestamp: readJsonU64(data.block_timestamp),
    };
}

function decodeFundingRateEvent(bytes: Uint8Array): DexFundingRateEvent {
    const d = new Deserializer(bytes);
    return {
        symbolId: d.deserializeU32(),
        fundingRatePpm: d.deserializeI32(),
        markPrice: d.deserializeU64(),
        blockHeight: d.deserializeU64(),
        timestamp: d.deserializeU64(),
    };
}

function readAssetPosition(d: Deserializer): DexAssetPosition {
    return {
        assetId: d.deserializeU32(),
        balance: d.deserializeI128(),
        locked: d.deserializeI128(),
    };
}

function readPerpPosition(d: Deserializer): DexPerpPosition {
    return {
        perpetualId: d.deserializeU32(),
        shortQuantums: d.deserializeU64(),
        longQuantums: d.deserializeU64(),
        deltaSellClosingLong: d.deserializeI64(),
        deltaBuyOpeningLong: d.deserializeI64(),
        deltaSellClosingShort: d.deserializeI64(),
        deltaBuyOpeningShort: d.deserializeI64(),
        marginMode: d.deserializeU32(),
        fundingIndex: d.deserializeI128(),
        longPositionValue: d.deserializeI128(),
        shortPositionValue: d.deserializeI128(),
        longImrQuota: d.deserializeI128(),
        shortImrQuota: d.deserializeI128(),
        longMmrQuota: d.deserializeU128(),
        shortMmrQuota: d.deserializeU128(),
        longBankruptPrice: d.deserializeI128(),
        shortBankruptPrice: d.deserializeI128(),
        longImrCloseFee: d.deserializeU128(),
        shortImrCloseFee: d.deserializeU128(),
    };
}

function readLeverageInfo(d: Deserializer): DexLeverageInfo {
    return {
        // LeverageTier.tier is the on-chain PerpetualTier enum (A-Z) -> BCS uleb128 (1 byte),
        // unlike the account event's other enum fields which the binding emits as u32.
        tier: d.deserializeU32FromUleb128() as PerpetualTier,
        minNotional: d.deserializeI128(),
        maxNotional: d.deserializeI128(),
        imLeverage: d.deserializeU32() | 0,
        mmLeverage: d.deserializeU32() | 0,
        exponent: d.deserializeU32() | 0,
        maintenanceDeduction: d.deserializeI64(),
    };
}

function readSymbolLeverage(d: Deserializer): DexSymbolLeverage {
    return {
        symbolId: d.deserializeU32(),
        leverageInfo: readLeverageInfo(d),
    };
}

function readSymbolMarginMode(d: Deserializer): DexSymbolMarginMode {
    return {
        symbolId: d.deserializeU32(),
        marginMode: d.deserializeU8(),
    };
}

function readParentVolumeInfo(d: Deserializer): DexParentVolumeInfo {
    return {
        type: d.deserializeU8(),
        lastTradeTimestampSec: d.deserializeU64(),
        cumulativeVolumeUsd: d.deserializeU64(),
        volumeThresholdReached: d.deserializeBool(),
    };
}

function decodeAccountEvent(bytes: Uint8Array): DexAccountEvent {
    const d = new Deserializer(bytes);
    const subaccountId = readSubaccountId(d);
    const positionMode = d.deserializeU32();
    const takerRate = d.deserializeU32() | 0;
    const makerRate = d.deserializeU32() | 0;
    const assetsSize = d.deserializeU32();
    const perpsSize = d.deserializeU32();

    // BCS Vec<T> has its own ULEB128 length prefix before elements
    const assetsLen = d.deserializeU32FromUleb128();
    const assets: DexAssetPosition[] = [];
    for (let i = 0; i < assetsLen; i++) {
        assets.push(readAssetPosition(d));
    }

    const perpsLen = d.deserializeU32FromUleb128();
    const perps: DexPerpPosition[] = [];
    for (let i = 0; i < perpsLen; i++) {
        perps.push(readPerpPosition(d));
    }

    const leverageInfosSize = d.deserializeU32();
    const leverageInfosLen = d.deserializeU32FromUleb128();
    const leverageInfos: DexSymbolLeverage[] = [];
    for (let i = 0; i < leverageInfosLen; i++) {
        leverageInfos.push(readSymbolLeverage(d));
    }

    const marginModesSize = d.deserializeU32();
    const marginModesLen = d.deserializeU32FromUleb128();
    const marginModes: DexSymbolMarginMode[] = [];
    for (let i = 0; i < marginModesLen; i++) {
        marginModes.push(readSymbolMarginMode(d));
    }

    const parentVolumeInfo = readParentVolumeInfo(d);
    const blockHeight = d.deserializeU64();
    const timestamp = d.deserializeU64();

    return {
        subaccountId,
        positionMode,
        takerRate,
        makerRate,
        assetsSize,
        perpsSize,
        assets,
        perps,
        leverageInfosSize,
        leverageInfos,
        marginModesSize,
        marginModes,
        parentVolumeInfo,
        blockHeight,
        timestamp,
    };
}

function decodeMarkPriceEvent(bytes: Uint8Array): DexMarkPriceEvent {
    const d = new Deserializer(bytes);
    const len = d.deserializeU32FromUleb128();
    const prices: DexMarkPriceInfo[] = [];
    for (let i = 0; i < len; i++) {
        prices.push({
            symbolId: d.deserializeU32(),
            markPrice: d.deserializeU64(),
            exponent: d.deserializeU32() | 0,
        });
    }
    return {
        prices,
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeIndexPriceEvent(bytes: Uint8Array): DexIndexPriceEvent {
    const d = new Deserializer(bytes);
    const len = d.deserializeU32FromUleb128();
    const prices: DexIndexPriceInfo[] = [];
    for (let i = 0; i < len; i++) {
        prices.push({
            symbolId: d.deserializeU32(),
            indexPrice: d.deserializeU64(),
            exponent: d.deserializeU32() | 0,
        });
    }
    return {
        prices,
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeFundingPredictionEvent(bytes: Uint8Array): DexFundingPredictionEvent {
    const d = new Deserializer(bytes);
    const len = d.deserializeU32FromUleb128();
    const predictions: DexFundingPredictionInfo[] = [];
    for (let i = 0; i < len; i++) {
        predictions.push({
            symbolId: d.deserializeU32(),
            fundingRatePpm: d.deserializeU32() | 0,
            timestamp: d.deserializeU64(),
        });
    }
    return {
        predictions,
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
    };
}

function decodeFeeStatementEvent(bytes: Uint8Array): DexFeeStatementEvent {
    const d = new Deserializer(bytes);
    return {
        executionGasUnits: d.deserializeU64(),
        ioGasUnits: d.deserializeU64(),
        storageFee: d.deserializeU64(),
        storageFeeRefund: d.deserializeU64(),
        totalChargeGasUnits: d.deserializeU64(),
    };
}

function decodeAdminControlInitializedEvent(bytes: Uint8Array): DexAdminControlInitializedEvent {
    const d = new Deserializer(bytes);
    return {
        adminSignerEpoch: d.deserializeU64(),
        adminDelaySecs: d.deserializeU64(),
        adminActionExpirySecs: d.deserializeU64(),
        committeeDigest: d.deserializeBytes(),
    };
}

function decodeAdminControlEnabledEvent(bytes: Uint8Array): DexAdminControlEnabledEvent {
    const d = new Deserializer(bytes);
    return { enabledAtSecs: d.deserializeU64() };
}

function decodeAdminActionScheduledEvent(bytes: Uint8Array): DexAdminActionScheduledEvent {
    const d = new Deserializer(bytes);
    return {
        operationId: d.deserializeBytes(),
        payloadDigest: d.deserializeBytes(),
        actionKind: d.deserializeU8(),
        signerEpoch: d.deserializeU64(),
        proposer: readAddress(d),
        scheduledAtSecs: d.deserializeU64(),
        executableAtSecs: d.deserializeU64(),
        expiresAtSecs: d.deserializeU64(),
        signatureCount: d.deserializeU8(),
    };
}

function decodeAdminActionExecutedEvent(bytes: Uint8Array): DexAdminActionExecutedEvent {
    const d = new Deserializer(bytes);
    return {
        operationId: d.deserializeBytes(),
        payloadDigest: d.deserializeBytes(),
        actionKind: d.deserializeU8(),
        signerEpoch: d.deserializeU64(),
        executor: readAddress(d),
        scheduledAtSecs: d.deserializeU64(),
        executableAtSecs: d.deserializeU64(),
        expiresAtSecs: d.deserializeU64(),
        executedAtSecs: d.deserializeU64(),
        signatureCount: d.deserializeU8(),
    };
}

function decodeAdminActionCancelledEvent(bytes: Uint8Array): DexAdminActionCancelledEvent {
    const d = new Deserializer(bytes);
    return {
        operationId: d.deserializeBytes(),
        payloadDigest: d.deserializeBytes(),
        actionKind: d.deserializeU8(),
        signerEpoch: d.deserializeU64(),
        executor: readAddress(d),
        scheduledAtSecs: d.deserializeU64(),
        executableAtSecs: d.deserializeU64(),
        expiresAtSecs: d.deserializeU64(),
        cancelledAtSecs: d.deserializeU64(),
        signatureCount: d.deserializeU8(),
    };
}

function decodeAdminActionExpiredEvent(bytes: Uint8Array): DexAdminActionExpiredEvent {
    const d = new Deserializer(bytes);
    return {
        operationId: d.deserializeBytes(),
        payloadDigest: d.deserializeBytes(),
        actionKind: d.deserializeU8(),
        signerEpoch: d.deserializeU64(),
        executor: readAddress(d),
        scheduledAtSecs: d.deserializeU64(),
        executableAtSecs: d.deserializeU64(),
        expiresAtSecs: d.deserializeU64(),
        expiredAtSecs: d.deserializeU64(),
    };
}

function decodeAdminActionInvalidatedEvent(bytes: Uint8Array): DexAdminActionInvalidatedEvent {
    const d = new Deserializer(bytes);
    return {
        operationId: d.deserializeBytes(),
        payloadDigest: d.deserializeBytes(),
        actionKind: d.deserializeU8(),
        signerEpoch: d.deserializeU64(),
        currentSignerEpoch: d.deserializeU64(),
        executor: readAddress(d),
        scheduledAtSecs: d.deserializeU64(),
        executableAtSecs: d.deserializeU64(),
        expiresAtSecs: d.deserializeU64(),
        invalidatedAtSecs: d.deserializeU64(),
    };
}

function decodeAdminControlCommitteeUpdatedEvent(
    bytes: Uint8Array,
): DexAdminControlCommitteeUpdatedEvent {
    const d = new Deserializer(bytes);
    return {
        operationId: d.deserializeBytes(),
        oldEpoch: d.deserializeU64(),
        newEpoch: d.deserializeU64(),
        oldCommitteeDigest: d.deserializeBytes(),
        newCommitteeDigest: d.deserializeBytes(),
        executedAtSecs: d.deserializeU64(),
    };
}

function decodeAdminControlPolicyUpdatedEvent(
    bytes: Uint8Array,
): DexAdminControlPolicyUpdatedEvent {
    const d = new Deserializer(bytes);
    return {
        operationId: d.deserializeBytes(),
        oldPolicyEpoch: d.deserializeU64(),
        newPolicyEpoch: d.deserializeU64(),
        oldAdminDelaySecs: d.deserializeU64(),
        newAdminDelaySecs: d.deserializeU64(),
        oldAdminActionExpirySecs: d.deserializeU64(),
        newAdminActionExpirySecs: d.deserializeU64(),
        executedAtSecs: d.deserializeU64(),
    };
}

function decodeFeeConfigUpdatedEvent(bytes: Uint8Array): DexFeeConfigUpdatedEvent {
    const d = new Deserializer(bytes);
    return {
        oldConfigDigest: d.deserializeBytes(),
        newConfigDigest: d.deserializeBytes(),
        signerEpoch: d.deserializeU64(),
    };
}

function decodeAdminControlRoleUpdatedEvent(bytes: Uint8Array): DexAdminControlRoleUpdatedEvent {
    const d = new Deserializer(bytes);
    const operationId = d.deserializeBytes();
    const action = d.deserializeU32FromUleb128();
    const roleMask = d.deserializeU64();
    const targetCount = d.deserializeU32();
    const targetsDigest = d.deserializeBytes();
    return { operationId, action, roleMask, targetCount, targetsDigest };
}

function decodeSetSymbolTradingPolicyEvent(bytes: Uint8Array): DexSetSymbolTradingPolicyEvent {
    const d = new Deserializer(bytes);
    return { perpetualId: d.deserializeU32() };
}

function decodeSetSymbolLeverageTierEvent(bytes: Uint8Array): DexSetSymbolLeverageTierEvent {
    const d = new Deserializer(bytes);
    return {
        perpetualId: d.deserializeU32(),
        tier: d.deserializeU32(),
    };
}

function decodeSetSymbolDisplayInfoEvent(bytes: Uint8Array): DexSetSymbolDisplayInfoEvent {
    const d = new Deserializer(bytes);
    return { perpetualId: d.deserializeU32() };
}

function decodeSymbolOpenedEvent(bytes: Uint8Array): DexSymbolOpenedEvent {
    const d = new Deserializer(bytes);
    return {
        perpetualId: d.deserializeU32(),
        listingTime: d.deserializeU64(),
        openingMarkPrice: d.deserializeU64(),
    };
}

/*
 * Delisting events. Each decoder reads the fields the chain defines and ignores whatever
 * follows: a later version only appends fields.
 */

function decodeDelistingPlanSetEvent(bytes: Uint8Array): DexDelistingPlanSetEvent {
    const d = new Deserializer(bytes);
    return {
        perpetualId: d.deserializeU32(),
        symbolId: d.deserializeU32(),
        planVersion: d.deserializeU32(),
        t0Secs: d.deserializeU64(),
        reduceOnlyLeadSecs: d.deserializeU32(),
        twapWindowSecs: d.deserializeU32(),
        reduceOnlyAtSecs: d.deserializeU64(),
        maxCancelPerBlock: d.deserializeU32(),
        maxSettlePerBlock: d.deserializeU32(),
        blockHeight: d.deserializeU64(),
        timestampUs: d.deserializeU64(),
    };
}

function decodeDelistingPricedEvent(bytes: Uint8Array): DexDelistingPricedEvent {
    const d = new Deserializer(bytes);
    return {
        perpetualId: d.deserializeU32(),
        symbolId: d.deserializeU32(),
        planVersion: d.deserializeU32(),
        finalPriceSubticks: d.deserializeU64(),
        sampleWeightUs: d.deserializeU64(),
        priceSource: d.deserializeU8(),
        expectedTotalPnl: d.deserializeI128(),
        blockHeight: d.deserializeU64(),
        timestampUs: d.deserializeU64(),
    };
}

function readDelistingSettledLeg(d: Deserializer): DexDelistingSettledLeg {
    return {
        side: d.deserializeU8(),
        marginMode: d.deserializeU8(),
        quantums: d.deserializeU64(),
        quoteQuantums: d.deserializeU128(),
        realizedPnl: d.deserializeI128(),
        isolatedShortfall: d.deserializeU128(),
    };
}

function decodeDelistingSettledEvent(bytes: Uint8Array): DexDelistingSettledEvent {
    const d = new Deserializer(bytes);
    const perpetualId = d.deserializeU32();
    const symbolId = d.deserializeU32();
    const owner = readAddress(d);
    const subAddress = readAddress(d);
    const subaccountNumber = d.deserializeU32();
    const finalPriceSubticks = d.deserializeU64();
    const legCount = d.deserializeU32FromUleb128();
    const legs: DexDelistingSettledLeg[] = [];
    for (let i = 0; i < legCount; i++) legs.push(readDelistingSettledLeg(d));
    return {
        perpetualId,
        symbolId,
        owner,
        subAddress,
        subaccountNumber,
        finalPriceSubticks,
        legs,
        crossShortfall: d.deserializeU128(),
        blockHeight: d.deserializeU64(),
        timestampUs: d.deserializeU64(),
    };
}

function decodeSymbolClosedEvent(bytes: Uint8Array): DexSymbolClosedEvent {
    const d = new Deserializer(bytes);
    return {
        perpetualId: d.deserializeU32(),
        symbolId: d.deserializeU32(),
        planVersion: d.deserializeU32(),
        finalPriceSubticks: d.deserializeU64(),
        settledAccounts: d.deserializeU64(),
        settledQuantums: d.deserializeU128(),
        settledQuoteQuantums: d.deserializeU128(),
        canceledOrders: d.deserializeU64(),
        realizedPnlSum: d.deserializeI128(),
        shortfallQuote: d.deserializeU128(),
        blockHeight: d.deserializeU64(),
        timestampUs: d.deserializeU64(),
    };
}

const TX_INDEX_SYSTEM = 0xffff_ffff;

function requireSystemTxIndex(value: number, eventName: string): number {
    if (value !== TX_INDEX_SYSTEM) {
        throw new Error(`${eventName} must use the system transaction index`);
    }
    return value;
}

/** Read a trigger snapshot and require it to consume the payload exactly. */
function decodeLiquidationTriggerSnapshot(d: Deserializer): {
    triggerNc: bigint;
    triggerMmr: bigint;
    triggerMarks: DexLiquidationTriggerMark[];
} {
    const triggerNc = d.deserializeI128();
    const triggerMmr = d.deserializeU128();
    const length = d.deserializeU32FromUleb128();
    const triggerMarks: DexLiquidationTriggerMark[] = [];
    for (let index = 0; index < length; index += 1) {
        triggerMarks.push({
            symbolId: d.deserializeU32(),
            markSubticks: d.deserializeU64(),
        });
    }
    if (d.remaining !== 0) {
        throw new Error(
            `BCS deserialize: unexpected ${d.remaining} trailing liquidation event bytes`,
        );
    }
    return { triggerNc, triggerMmr, triggerMarks };
}

/** Archived liquidation events predate trigger snapshots. */
function decodeOptionalLiquidationTriggerSnapshot(d: Deserializer): {
    triggerNc: bigint;
    triggerMmr: bigint;
    triggerMarks: DexLiquidationTriggerMark[];
} {
    return d.remaining === 0
        ? { triggerNc: 0n, triggerMmr: 0n, triggerMarks: [] }
        : decodeLiquidationTriggerSnapshot(d);
}

interface LiquidationRiskTransferTail {
    sourceResidualBoundQuantums: bigint;
    blockHeight: bigint;
    timestampUs: bigint;
    actionSeq: number;
    txIndex: number;
    triggerNc: bigint;
    triggerMmr: bigint;
    triggerMarks: DexLiquidationTriggerMark[];
}

/**
 * Decode the two shipped RiskTransfer tails without guessing.
 *
 * Release/v2.3 appends the trigger snapshot directly after `tx_index`; current
 * main inserts `source_residual_bound_quantums` before the common block
 * coordinates. The snapshot vector makes both tails variable length, so the byte
 * count cannot tell them apart -- each known layout is parsed independently and
 * exactly one must consume the payload.
 */
function decodeLiquidationRiskTransferTail(tail: Uint8Array): LiquidationRiskTransferTail {
    const candidates: LiquidationRiskTransferTail[] = [];
    for (const hasResidualBound of [false, true]) {
        const d = new Deserializer(tail);
        try {
            const sourceResidualBoundQuantums = hasResidualBound ? d.deserializeU64() : 0n;
            const blockHeight = d.deserializeU64();
            const timestampUs = d.deserializeU64();
            const actionSeq = d.deserializeU32();
            const txIndex = requireSystemTxIndex(
                d.deserializeU32(),
                "LiquidationRiskTransferEvent",
            );
            candidates.push({
                sourceResidualBoundQuantums,
                blockHeight,
                timestampUs,
                actionSeq,
                txIndex,
                ...decodeOptionalLiquidationTriggerSnapshot(d),
            });
        } catch {
            continue;
        }
    }
    if (candidates.length !== 1) {
        throw new Error(
            "LiquidationRiskTransferEvent has an unsupported or ambiguous trailing layout",
        );
    }
    return candidates[0];
}

function decodeLiquidationRiskTransferEvent(bytes: Uint8Array): DexLiquidationRiskTransferEvent {
    const d = new Deserializer(bytes);
    const flowInstanceId = d.deserializeBytes();
    const sourceRiskUnitId = d.deserializeBytes();
    const sourceAccount = readAddress(d);
    const subAddress = readAddress(d);
    const subaccountNumber = d.deserializeU32();
    const symbolId = d.deserializeU32();
    const riskUnitType = d.deserializeU8();
    const side = d.deserializeU8();
    const takeoverAccount = readAddress(d);
    const quantums = d.deserializeU64();
    const price = d.deserializeU64();
    const feeBits = d.deserializeU64();
    const realizedPnlBits = d.deserializeU64();
    const sourceResidualSettledBits = d.deserializeU64();

    const tail = decodeLiquidationRiskTransferTail(d.deserializeFixedBytes(d.remaining));
    return {
        flowInstanceId,
        sourceRiskUnitId,
        sourceAccount,
        subAddress,
        subaccountNumber,
        symbolId,
        riskUnitType,
        side,
        takeoverAccount,
        quantums,
        price,
        feeBits,
        realizedPnlBits,
        sourceResidualSettledBits,
        ...tail,
    };
}

function decodeLiquidationInternalOffsetEvent(
    bytes: Uint8Array,
): DexLiquidationInternalOffsetEvent {
    const d = new Deserializer(bytes);
    return {
        flowInstanceId: d.deserializeBytes(),
        sourceRiskUnitId: d.deserializeBytes(),
        sourceAccount: readAddress(d),
        subAddress: readAddress(d),
        subaccountNumber: d.deserializeU32(),
        symbolId: d.deserializeU32(),
        riskUnitType: d.deserializeU8(),
        quantums: d.deserializeU64(),
        price: d.deserializeU64(),
        totalFeeBits: d.deserializeU64(),
        totalRealizedPnlBits: d.deserializeU64(),
        longRealizedPnlBits: d.deserializeU64(),
        shortRealizedPnlBits: d.deserializeU64(),
        blockHeight: d.deserializeU64(),
        timestampUs: d.deserializeU64(),
        actionSeq: d.deserializeU32(),
        txIndex: d.deserializeU32(),
        ...decodeOptionalLiquidationTriggerSnapshot(d),
    };
}

// -- ADL execution decoding --------------------------------------------------

const ADL_EVENT_SCHEMA_VERSION_V5 = 5;
/**
 * The event schema remains V5. Algorithm revisions V4 through V9 use the same BCS layout; V7
 * changes filled-quote settlement semantics only, V8 admits managed Vault accounts as ranked
 * opponents, and V9 scopes source exclusion to the legs being liquidated. Unknown future
 * revisions fail closed.
 */
const ADL_ALGORITHM_VERSIONS_SUPPORTED: readonly bigint[] = [4n, 5n, 6n, 7n, 8n, 9n];
const ADL_HASH_LENGTH = 32;

function readAdlSignedValue(d: Deserializer): DexAdlSignedValue {
    return { sign: d.deserializeU8() as AdlSign, absValue: d.deserializeU128() };
}

function readAdlEventId(d: Deserializer): DexAdlEventId {
    return {
        triggerBlockHeight: d.deserializeU64(),
        triggerIndexInBlock: d.deserializeU64(),
    };
}

function readAdlDirectLiquidationLocator(d: Deserializer): DexAdlDirectLiquidationLocator {
    return {
        blockHeight: d.deserializeU64(),
        directLiquidationIndexInBlock: d.deserializeU64(),
        flowInstanceId: d.deserializeFixedBytes(32),
        actionSeq: d.deserializeU32(),
    };
}

function readAdlSourceLocator(d: Deserializer): DexAdlSourceLocator {
    const sourceKind = d.deserializeU8() as AdlSourceKind;
    const directLiquidationLocator = d.deserializeBool()
        ? readAdlDirectLiquidationLocator(d)
        : null;
    return { sourceKind, directLiquidationLocator };
}

function readAdlAccountLocator(d: Deserializer): DexAdlAccountLocator {
    return {
        ownerAddress: readAddress(d),
        subaccountNumber: d.deserializeU32(),
        subAddress: readAddress(d),
    };
}

function readAdlPositionKey(d: Deserializer): DexAdlPositionKey {
    return {
        account: readAdlAccountLocator(d),
        symbolId: d.deserializeU32(),
        positionSide: d.deserializeU8() as AdlPositionSide,
        marginMode: d.deserializeU8() as AdlMarginMode,
    };
}

function readAdlQueueKey(d: Deserializer): DexAdlQueueKey {
    return {
        symbolId: d.deserializeU32(),
        opponentSide: d.deserializeU8() as AdlPositionSide,
    };
}

function readAdlSelectedPrefixHeader(d: Deserializer): DexAdlSelectedPrefixHeader {
    const schemaVersion = d.deserializeU16();
    const algorithmVersion = d.deserializeU64();
    const priceVersion = d.deserializeU64();
    const preAdlStateVersion = d.deserializeU64();
    const queueKey = readAdlQueueKey(d);
    const triggerSource = d.deserializeU8() as AdlTriggerSource;
    const triggerReasonCount = d.deserializeU32FromUleb128();
    const triggerReasons: AdlTriggerSource[] = [];
    for (let index = 0; index < triggerReasonCount; index += 1) {
        triggerReasons.push(d.deserializeU8() as AdlTriggerSource);
    }
    const sourceLocator = readAdlSourceLocator(d);
    const sourceRiskHolder = readAdlAccountLocator(d);
    const originalLiquidatedAccount = d.deserializeBool() ? readAdlAccountLocator(d) : null;
    return {
        schemaVersion,
        algorithmVersion,
        priceVersion,
        preAdlStateVersion,
        queueKey,
        triggerSource,
        triggerReasons,
        sourceLocator,
        sourceRiskHolder,
        originalLiquidatedAccount,
        sourcePositionKey: readAdlPositionKey(d),
        bankruptcySubticks: d.deserializeU64(),
        targetQuantums: d.deserializeU64(),
        totalExecutedQuantums: d.deserializeU64(),
        stopReason: d.deserializeU8() as AdlStopReason,
    };
}

function readAdlAuditEntry(d: Deserializer): DexAdlAuditEntry {
    return {
        schemaVersion: d.deserializeU16(),
        auditEntryIndex: d.deserializeU64(),
        executionPass: d.deserializeU8() as AdlExecutionPass,
        rankIndex: d.deserializeU64(),
        positionKey: readAdlPositionKey(d),
        rawSideQuantumsBefore: d.deserializeU64(),
        oppositeSideQuantumsBefore: d.deserializeU64(),
        scoreNumeratorSigned: readAdlSignedValue(d),
        scoreDenominator: d.deserializeU128(),
        executionStatus: d.deserializeU8() as AdlExecutionStatus,
        executedQuantums: d.deserializeU64(),
        realizedPnlSigned: readAdlSignedValue(d),
        skipReasonCode: d.deserializeU8() as AdlSkipReasonCode,
    };
}

function readAdlVaultTakeoverFill(d: Deserializer): DexAdlVaultTakeoverFill {
    return {
        schemaVersion: d.deserializeU16(),
        vaultAccount: readAdlAccountLocator(d),
        leftoverQuantums: d.deserializeU64(),
        bankruptcySubticks: d.deserializeU64(),
        feeCharged: d.deserializeU64(),
    };
}

function validateAdlExecutionEventChunk(event: DexAdlExecutionEvent): void {
    if (event.schemaVersion !== ADL_EVENT_SCHEMA_VERSION_V5) {
        throw new Error("unsupported ADL event schema version");
    }
    if (event.selectedPrefixHeader.schemaVersion !== event.schemaVersion) {
        throw new Error("ADL event and header schema versions must match");
    }
    if (!ADL_ALGORITHM_VERSIONS_SUPPORTED.includes(event.selectedPrefixHeader.algorithmVersion)) {
        throw new Error("unsupported ADL algorithm version");
    }
    if (event.selectedPrefixHeader.sourceLocator.directLiquidationLocator === null) {
        throw new Error("ADL direct liquidation source requires a locator");
    }
    if (event.auditEntries.some((entry) => entry.schemaVersion !== event.schemaVersion)) {
        throw new Error("ADL event and audit schema versions must match");
    }
    if (
        event.vaultTakeoverFill !== null &&
        event.vaultTakeoverFill.schemaVersion !== event.schemaVersion
    ) {
        throw new Error("ADL event and Vault schema versions must match");
    }
    if (event.totalChunks === 0n) {
        throw new Error("ADL total_chunks must be positive");
    }
    if (event.chunkIndex >= event.totalChunks) {
        throw new Error("ADL chunk_index must be below total_chunks");
    }
    if (event.auditEntriesEndIndexExclusive < event.auditEntriesStartIndex) {
        throw new Error("ADL audit range must not be inverted");
    }
    const declared = event.auditEntriesEndIndexExclusive - event.auditEntriesStartIndex;
    if (BigInt(event.auditEntries.length) !== declared) {
        throw new Error("ADL chunk must carry exactly the audit entries it declares");
    }
    if (
        event.auditEntries.some(
            (entry, offset) =>
                entry.auditEntryIndex !== event.auditEntriesStartIndex + BigInt(offset),
        )
    ) {
        throw new Error("ADL audit entry indexes must match the declared range");
    }
    if (
        event.vaultTakeoverFill !== null &&
        event.chunkIndex !== event.totalChunks - 1n
    ) {
        throw new Error("ADL Vault takeover is only allowed on the final chunk");
    }
}

function structurallyEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (left instanceof Uint8Array && right instanceof Uint8Array) {
        return (
            left.length === right.length &&
            left.every((value, index) => value === right[index])
        );
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return (
            left.length === right.length &&
            left.every((value, index) => structurallyEqual(value, right[index]))
        );
    }
    if (isRecord(left) && isRecord(right)) {
        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);
        return (
            leftKeys.length === rightKeys.length &&
            leftKeys.every(
                (key) =>
                    Object.prototype.hasOwnProperty.call(right, key) &&
                    structurallyEqual(left[key], right[key]),
            )
        );
    }
    return false;
}

/**
 * Validate an ordered, complete physical chunk set for one logical ADL event.
 * Individual chunks are checked first; cross-chunk commitments and audit ranges
 * must then remain identical and contiguous.
 */
export function validateAdlExecutionEventChunks(
    chunks: readonly DexAdlExecutionEvent[],
): void {
    if (chunks.length === 0) {
        throw new Error("ADL chunk set must not be empty");
    }
    for (const chunk of chunks) {
        validateAdlExecutionEventChunk(chunk);
    }
    const first = chunks[0];
    if (BigInt(chunks.length) !== first.totalChunks) {
        throw new Error("ADL validation requires a complete physical chunk set");
    }
    if (chunks.some((chunk, index) => chunk.chunkIndex !== BigInt(index))) {
        throw new Error("ADL chunk indexes must be contiguous and ordered");
    }
    const logicalIdentity = [
        first.adlEventId,
        first.totalChunks,
        first.selectedPrefixHeader,
        first.inputSnapshotHash,
        first.selectedPrefixHash,
        first.executionFillsDigest,
    ];
    if (
        chunks.slice(1).some(
            (chunk) =>
                !structurallyEqual(
                    [
                        chunk.adlEventId,
                        chunk.totalChunks,
                        chunk.selectedPrefixHeader,
                        chunk.inputSnapshotHash,
                        chunk.selectedPrefixHash,
                        chunk.executionFillsDigest,
                    ],
                    logicalIdentity,
                ),
        )
    ) {
        throw new Error("ADL chunks must belong to the same logical ADL event");
    }
    let expectedAuditStart = 0n;
    for (const chunk of chunks) {
        if (chunk.auditEntriesStartIndex !== expectedAuditStart) {
            throw new Error("ADL chunk audit ranges must be contiguous");
        }
        expectedAuditStart = chunk.auditEntriesEndIndexExclusive;
    }
}

function decodeAdlExecutionEvent(bytes: Uint8Array): DexAdlExecutionEvent {
    const d = new Deserializer(bytes);
    const schemaVersion = d.deserializeU16();
    const adlEventId = readAdlEventId(d);
    const chunkIndex = d.deserializeU64();
    const totalChunks = d.deserializeU64();
    const auditEntriesStartIndex = d.deserializeU64();
    const auditEntriesEndIndexExclusive = d.deserializeU64();
    const selectedPrefixHeader = readAdlSelectedPrefixHeader(d);
    const auditEntryCount = d.deserializeU32FromUleb128();
    const auditEntries: DexAdlAuditEntry[] = [];
    for (let index = 0; index < auditEntryCount; index += 1) {
        auditEntries.push(readAdlAuditEntry(d));
    }
    const vaultTakeoverFill = d.deserializeBool() ? readAdlVaultTakeoverFill(d) : null;
    const event: DexAdlExecutionEvent = {
        schemaVersion,
        adlEventId,
        chunkIndex,
        totalChunks,
        auditEntriesStartIndex,
        auditEntriesEndIndexExclusive,
        selectedPrefixHeader,
        auditEntries,
        vaultTakeoverFill,
        inputSnapshotHash: d.deserializeFixedBytes(ADL_HASH_LENGTH),
        selectedPrefixHash: d.deserializeFixedBytes(ADL_HASH_LENGTH),
        executionFillsDigest: d.deserializeFixedBytes(ADL_HASH_LENGTH),
    };
    if (d.remaining !== 0) {
        throw new Error(
            `BCS deserialize: unexpected ${d.remaining} trailing AdlExecutionEvent bytes`,
        );
    }
    validateAdlExecutionEventChunk(event);
    return event;
}

function decodeAdlVaultInitializedEvent(bytes: Uint8Array): DexAdlVaultInitializedEvent {
    const d = new Deserializer(bytes);
    const event: DexAdlVaultInitializedEvent = {
        schemaVersion: d.deserializeU16(),
        vaultAddress: readAddress(d),
        vaultSubAddress: readAddress(d),
        vaultConfigVersion: d.deserializeU64(),
    };
    if (d.remaining !== 0) {
        throw new Error(
            `BCS deserialize: unexpected ${d.remaining} trailing AdlVaultInitializedEvent bytes`,
        );
    }
    return event;
}

function decodeLiquidationDirectAdlEvent(bytes: Uint8Array): DexLiquidationDirectAdlEvent {
    const d = new Deserializer(bytes);
    const event: DexLiquidationDirectAdlEvent = {
        flowInstanceId: d.deserializeBytes(),
        sourceRiskUnitId: d.deserializeBytes(),
        sourceAccount: readAddress(d),
        subAddress: readAddress(d),
        subaccountNumber: d.deserializeU32(),
        symbolId: d.deserializeU32(),
        riskUnitType: d.deserializeU8(),
        side: d.deserializeU8(),
        targetQuantums: d.deserializeU64(),
        bankruptcySubticks: d.deserializeU64(),
        sourceFeeBits: d.deserializeU64(),
        sourceRealizedPnlBits: d.deserializeU64(),
        sourceResidualSettledBits: d.deserializeU64(),
        sourceResidualBoundQuantums: d.deserializeU64(),
        blockHeight: d.deserializeU64(),
        timestampUs: d.deserializeU64(),
        actionSeq: d.deserializeU32(),
        txIndex: d.deserializeU32(),
    };
    if (d.remaining !== 0) {
        throw new Error(
            `BCS deserialize: unexpected ${d.remaining} trailing LiquidationDirectAdlEvent bytes`,
        );
    }
    return event;
}

function decodeLiquidationDirectAdlEventJson(
    d: Record<string, unknown>,
): DexLiquidationDirectAdlEvent {
    return {
        flowInstanceId: jBytes(d.flow_instance_id),
        sourceRiskUnitId: jBytes(d.source_risk_unit_id),
        sourceAccount: jAddr(d.source_account),
        subAddress: jAddr(d.sub_address),
        subaccountNumber: jNum(d.subaccount_number),
        symbolId: jNum(d.symbol_id),
        riskUnitType: jNum(d.risk_unit_type),
        side: jNum(d.side),
        targetQuantums: jBig(d.target_quantums),
        bankruptcySubticks: jBig(d.bankruptcy_subticks),
        sourceFeeBits: jBig(d.source_fee_bits),
        sourceRealizedPnlBits: jBig(d.source_realized_pnl_bits),
        sourceResidualSettledBits: jBig(d.source_residual_settled_bits ?? 0),
        sourceResidualBoundQuantums: jBig(d.source_residual_bound_quantums ?? 0),
        blockHeight: jBig(d.block_height),
        timestampUs: jBig(d.timestamp_us),
        actionSeq: jNum(d.action_seq),
        txIndex: jNum(d.tx_index),
    };
}

function decodeLiquidationFailedEvent(bytes: Uint8Array): DexLiquidationFailedEvent {
    const d = new Deserializer(bytes);
    return {
        flowInstanceId: d.deserializeBytes(),
        sourceRiskUnitId: d.deserializeBytes(),
        sourceAccount: readAddress(d),
        subAddress: readAddress(d),
        subaccountNumber: d.deserializeU32(),
        symbolId: d.deserializeU32(),
        riskUnitType: d.deserializeU8(),
        step: d.deserializeU8(),
        reasonCode: d.deserializeU8(),
        blockHeight: d.deserializeU64(),
        timestampUs: d.deserializeU64(),
        actionSeq: d.deserializeU32(),
        txIndex: d.deserializeU32(),
        ...decodeOptionalLiquidationTriggerSnapshot(d),
    };
}

// ============================================================================
// DexEventVariant - all parsed event types
// ============================================================================

export type DexEventType =
    | "DexReferralFeeEvent"
    | "FillEvent"
    | "OrderPlacedEvent"
    | "OrderCancelledEvent"
    | "OrderAmendedEvent"
    | "OrderRejectedEvent"
    | "OrderFilledEvent"
    | "ConditionOrderPlacedEvent"
    | "ConditionOrderActivatedEvent"
    | "ConditionOrderParentReboundEvent"
    | "ConditionOrderTriggeredEvent"
    | "WholePositionOcoUpdatedEvent"
    | "FundingRateEvent"
    | "AccountEvent"
    | "MarkPriceEvent"
    | "IndexPriceEvent"
    | "FundingPredictionEvent"
    | "SetSymbolTradingPolicyEvent"
    | "SetSymbolLeverageTierEvent"
    | "SetSymbolDisplayInfoEvent"
    | "SymbolOpenedEvent"
    | "DelistingPlanSetEvent"
    | "DelistingPricedEvent"
    | "DelistingSettledEvent"
    | "SymbolClosedEvent"
    | "LiquidationRiskTransferEvent"
    | "LiquidationInternalOffsetEvent"
    | "LiquidationFailedEvent"
    | "LiquidationDirectAdlEvent"
    | "AdlExecutionEvent"
    | "AdlVaultInitializedEvent"
    | "FaucetMintEvent"
    | "InternalTransferEvent"
    | "AccountTransferEvent"
    | "AuthorityChangedEvent"
    | "MultisigOperationExecutedEvent"
    | "CrossTransferEvent"
    | "CreateSubAccountEvent"
    | "ModifySubAccountEvent"
    | "SetUserLeverageEvent"
    | "ChangePositionModeEvent"
    | "ChangeMarginModeEvent"
    | "AdjustIsolatedMarginEvent"
    | "VaultCreatedEvent"
    | "VaultUpdatedEvent"
    | "VaultDepositedEvent"
    | "VaultWithdrawRequestedEvent"
    | "VaultWithdrawCompletedEvent"
    | "VaultWithdrawRejectedEvent"
    | "VaultWithdrawFailedEvent"
    | "VaultSharesBurnedEvent"
    | "VaultLeaderFeePaidEvent"
    | "VaultDistributeEvent"
    | "VaultDistributeDepositorEvent"
    | "CreateSpotEvent"
    | "CreatePerpetualEvent"
    | "UpdateLeverageEvent"
    | "SetAccountFeeRateEvent"
    | "SetFeeConfigEvent"
    | "UpdateBridgeSignersEvent"
    | "SetBridgeFeesEvent"
    | "SetFaucetMintEnabledEvent"
    | "FeeStatement"
    | "BatchSystemConfigEvent"
    | "BatchOpFailedEvent"
    | "AdminControlInitializedEvent"
    | "AdminControlEnabledEvent"
    | "AdminActionScheduledEvent"
    | "AdminActionExecutedEvent"
    | "AdminActionCancelledEvent"
    | "AdminActionExpiredEvent"
    | "AdminActionInvalidatedEvent"
    | "AdminControlRotatedEvent"
    | "AdminControlPolicyUpdatedEvent"
    | "AdminControlListingSignerSetUpdatedEvent"
    | "FeeSignerSetUpdatedEvent"
    | "FeeConfigUpdatedEvent"
    | "AdminControlRoleUpdatedEvent"
    | `${string}Event`;

export interface DecodedDexEvent {
    eventType: DexEventType;
    event:
        | ReferralEvent
        | DexVaultInternalOffsetEvent
        | DexFillEvent
        | DexOrderPlacedEvent
        | DexOrderCancelledEvent
        | DexOrderAmendedEvent
        | DexOrderRejectedEvent
        | DexOrderFilledEvent
        | DexConditionOrderPlacedEvent
        | DexConditionOrderActivatedEvent
        | DexConditionOrderParentReboundEvent
        | DexConditionOrderTriggeredEvent
        | DexWholePositionOcoUpdatedEvent
        | DexFundingRateEvent
        | DexAccountEvent
        | DexMarkPriceEvent
        | DexIndexPriceEvent
        | DexFundingPredictionEvent
        | DexSetSymbolTradingPolicyEvent
        | DexSetSymbolLeverageTierEvent
        | DexSetSymbolDisplayInfoEvent
        | DexSymbolOpenedEvent
        | DexDelistingPlanSetEvent
        | DexDelistingPricedEvent
        | DexDelistingSettledEvent
        | DexSymbolClosedEvent
        | DexLiquidationRiskTransferEvent
        | DexLiquidationInternalOffsetEvent
        | DexLiquidationFailedEvent
        | DexLiquidationDirectAdlEvent
        | DexAdlExecutionEvent
        | DexAdlVaultInitializedEvent
        | FaucetMintEvent
        | InternalTransferEvent
        | AccountTransferEvent
        | AuthorityChangedEvent
        | MultisigOperationExecutedEvent
        | CrossTransferEvent
        | CreateSubAccountEvent
        | ModifySubAccountEvent
        | SetUserLeverageEvent
        | ChangePositionModeEvent
        | ChangeMarginModeEvent
        | AdjustIsolatedMarginEvent
        | VaultCreatedEvent
        | VaultUpdatedEvent
        | VaultDepositedEvent
        | VaultWithdrawRequestedEvent
        | VaultWithdrawCompletedEvent
        | VaultWithdrawErrorEvent
        | VaultSharesBurnedEvent
        | VaultLeaderFeePaidEvent
        | VaultDistributeEvent
        | VaultDistributeDepositorEvent
        | SuccessEvent
        | DexFeeStatementEvent
        | BatchSystemConfigEvent
        | BatchOpFailedEvent
        | DexAdminControlInitializedEvent
        | DexAdminControlEnabledEvent
        | DexAdminActionScheduledEvent
        | DexAdminActionExecutedEvent
        | DexAdminActionCancelledEvent
        | DexAdminActionExpiredEvent
        | DexAdminActionInvalidatedEvent
        | DexAdminControlCommitteeUpdatedEvent
        | DexAdminControlPolicyUpdatedEvent
        | DexFeeConfigUpdatedEvent
        | DexAdminControlRoleUpdatedEvent
        | Readonly<Record<string, unknown>>;
}

// ============================================================================
// JSON transport decode - the chain REST returns Move-ABI events (the three
// liquidation events) with `data` as a JSON object (wide ints as strings,
// bytes/address as 0x hex), while native-executor events arrive as hex BCS.
// These mirror the BCS decoders above and MUST produce identical output.
// ============================================================================

function jBig(v: unknown): bigint {
    return BigInt(v as string | number | bigint);
}

function jNum(v: unknown): number {
    return Number(v);
}

function jBytes(v: unknown): Uint8Array {
    return hexToBytes(String(v));
}

function jAddr(v: unknown): string {
    const raw = String(v);
    const stripped = raw.startsWith("0x") ? raw.slice(2) : raw;
    const padded = stripped.padStart(ACCOUNT_ID_LENGTH * 2, "0");
    return new AccountAddress(hexToBytes(padded)).toString();
}

function decodeLiquidationTriggerSnapshotJson(
    d: Record<string, unknown>,
): {
    triggerNc: bigint;
    triggerMmr: bigint;
    triggerMarks: DexLiquidationTriggerMark[];
} {
    if (!("trigger_nc_bits" in d)) {
        return { triggerNc: 0n, triggerMmr: 0n, triggerMarks: [] };
    }
    return {
        triggerNc: BigInt.asIntN(128, jBig(d.trigger_nc_bits)),
        triggerMmr: jBig(d.trigger_mmr),
        triggerMarks: ((d.trigger_marks ?? []) as Array<Record<string, unknown>>).map(
            (mark) => ({
                symbolId: jNum(mark.symbol_id),
                markSubticks: jBig(mark.mark_subticks),
            }),
        ),
    };
}

function decodeLiquidationRiskTransferEventJson(
    d: Record<string, unknown>,
): DexLiquidationRiskTransferEvent {
    return {
        flowInstanceId: jBytes(d.flow_instance_id),
        sourceRiskUnitId: jBytes(d.source_risk_unit_id),
        sourceAccount: jAddr(d.source_account),
        subAddress: jAddr(d.sub_address),
        subaccountNumber: jNum(d.subaccount_number),
        symbolId: jNum(d.symbol_id),
        riskUnitType: jNum(d.risk_unit_type),
        side: jNum(d.side),
        takeoverAccount: jAddr(d.takeover_account),
        quantums: jBig(d.quantums),
        price: jBig(d.price),
        feeBits: jBig(d.fee_bits),
        realizedPnlBits: jBig(d.realized_pnl_bits),
        sourceResidualSettledBits: jBig(d.source_residual_settled_bits ?? 0),
        sourceResidualBoundQuantums: jBig(d.source_residual_bound_quantums ?? 0),
        blockHeight: jBig(d.block_height),
        timestampUs: jBig(d.timestamp_us),
        actionSeq: jNum(d.action_seq),
        txIndex: requireSystemTxIndex(
            jNum(d.tx_index),
            "LiquidationRiskTransferEvent",
        ),
        ...decodeLiquidationTriggerSnapshotJson(d),
    };
}

function decodeLiquidationInternalOffsetEventJson(
    d: Record<string, unknown>,
): DexLiquidationInternalOffsetEvent {
    return {
        flowInstanceId: jBytes(d.flow_instance_id),
        sourceRiskUnitId: jBytes(d.source_risk_unit_id),
        sourceAccount: jAddr(d.source_account),
        subAddress: jAddr(d.sub_address),
        subaccountNumber: jNum(d.subaccount_number),
        symbolId: jNum(d.symbol_id),
        riskUnitType: jNum(d.risk_unit_type),
        quantums: jBig(d.quantums),
        price: jBig(d.price),
        totalFeeBits: jBig(d.total_fee_bits),
        totalRealizedPnlBits: jBig(d.total_realized_pnl_bits),
        longRealizedPnlBits: jBig(d.long_realized_pnl_bits),
        shortRealizedPnlBits: jBig(d.short_realized_pnl_bits),
        blockHeight: jBig(d.block_height),
        timestampUs: jBig(d.timestamp_us),
        actionSeq: jNum(d.action_seq),
        txIndex: jNum(d.tx_index),
        ...decodeLiquidationTriggerSnapshotJson(d),
    };
}

function decodeLiquidationFailedEventJson(
    d: Record<string, unknown>,
): DexLiquidationFailedEvent {
    return {
        flowInstanceId: jBytes(d.flow_instance_id),
        sourceRiskUnitId: jBytes(d.source_risk_unit_id),
        sourceAccount: jAddr(d.source_account),
        subAddress: jAddr(d.sub_address),
        subaccountNumber: jNum(d.subaccount_number),
        symbolId: jNum(d.symbol_id),
        riskUnitType: jNum(d.risk_unit_type),
        step: jNum(d.step),
        reasonCode: jNum(d.reason_code),
        blockHeight: jBig(d.block_height),
        timestampUs: jBig(d.timestamp_us),
        actionSeq: jNum(d.action_seq),
        txIndex: jNum(d.tx_index),
        ...decodeLiquidationTriggerSnapshotJson(d),
    };
}

/*
 * The delisting events as JSON, on a chain whose `dex.move` mirrors them: u64
 * and u128 are decimal strings, a `_bits` field is the unsigned reading of the two's-complement
 * bits, and addresses are written in their 20-byte form. These give the same values as the BCS
 * decoders above.
 */

function jSigned128(v: unknown): bigint {
    return BigInt.asIntN(128, jBig(v));
}

function decodeDelistingPlanSetEventJson(d: Record<string, unknown>): DexDelistingPlanSetEvent {
    return {
        perpetualId: jNum(d.perpetual_id),
        symbolId: jNum(d.symbol_id),
        planVersion: jNum(d.plan_version),
        t0Secs: jBig(d.t0_secs),
        reduceOnlyLeadSecs: jNum(d.reduce_only_lead_secs),
        twapWindowSecs: jNum(d.twap_window_secs),
        reduceOnlyAtSecs: jBig(d.reduce_only_at_secs),
        maxCancelPerBlock: jNum(d.max_cancel_per_block),
        maxSettlePerBlock: jNum(d.max_settle_per_block),
        blockHeight: jBig(d.block_height),
        timestampUs: jBig(d.timestamp_us),
    };
}

function decodeDelistingPricedEventJson(d: Record<string, unknown>): DexDelistingPricedEvent {
    return {
        perpetualId: jNum(d.perpetual_id),
        symbolId: jNum(d.symbol_id),
        planVersion: jNum(d.plan_version),
        finalPriceSubticks: jBig(d.final_price_subticks),
        sampleWeightUs: jBig(d.sample_weight_us),
        priceSource: jNum(d.price_source),
        expectedTotalPnl: jSigned128(d.expected_total_pnl_bits),
        blockHeight: jBig(d.block_height),
        timestampUs: jBig(d.timestamp_us),
    };
}

function decodeDelistingSettledEventJson(d: Record<string, unknown>): DexDelistingSettledEvent {
    if (!Array.isArray(d.legs)) throw new Error("DelistingSettledEvent.legs must be an array");
    return {
        perpetualId: jNum(d.perpetual_id),
        symbolId: jNum(d.symbol_id),
        owner: jAddr(d.owner),
        subAddress: jAddr(d.sub_address),
        subaccountNumber: jNum(d.subaccount_number),
        finalPriceSubticks: jBig(d.final_price_subticks),
        legs: (d.legs as Array<Record<string, unknown>>).map((leg) => ({
            side: jNum(leg.side),
            marginMode: jNum(leg.margin_mode),
            quantums: jBig(leg.quantums),
            quoteQuantums: jBig(leg.quote_quantums),
            realizedPnl: jSigned128(leg.realized_pnl_bits),
            isolatedShortfall: jBig(leg.isolated_shortfall),
        })),
        crossShortfall: jBig(d.cross_shortfall),
        blockHeight: jBig(d.block_height),
        timestampUs: jBig(d.timestamp_us),
    };
}

function decodeSymbolClosedEventJson(d: Record<string, unknown>): DexSymbolClosedEvent {
    return {
        perpetualId: jNum(d.perpetual_id),
        symbolId: jNum(d.symbol_id),
        planVersion: jNum(d.plan_version),
        finalPriceSubticks: jBig(d.final_price_subticks),
        settledAccounts: jBig(d.settled_accounts),
        settledQuantums: jBig(d.settled_quantums),
        settledQuoteQuantums: jBig(d.settled_quote_quantums),
        canceledOrders: jBig(d.canceled_orders),
        realizedPnlSum: jSigned128(d.realized_pnl_sum_bits),
        shortfallQuote: jBig(d.shortfall_quote),
        blockHeight: jBig(d.block_height),
        timestampUs: jBig(d.timestamp_us),
    };
}

/**
 * Extract the event name from a structured DEX REST event. Structured payloads
 * have already been decoded against the Move ABI by the node, so preserving an
 * otherwise unknown object is safer than coupling every SDK release to the
 * complete on-chain event registry.
 */
function structuredDexEventType(typeStr: string): DexEventType | null {
    const match = typeStr.match(/::dex::([A-Za-z_][A-Za-z0-9_]*Event)$/);
    if (match) {
        return match[1] as DexEventType;
    }
    if (typeStr.endsWith(EVENT_TAGS.FEE_STATEMENT)) {
        return "FeeStatement";
    }
    return null;
}

/**
 * Decode a DEX event whose `data` is a JSON object (chain REST Move-ABI form).
 * Events with a dedicated JSON decoder retain their strongly typed result;
 * every other DEX event is returned losslessly as its structured REST object.
 */
function decodeDexEventFromJson(
    typeStr: string,
    data: Record<string, unknown>,
): DecodedDexEvent | null {
    try {
        if (typeStr.endsWith(EVENT_TAGS.CONDITION_ORDER_ACTIVATED)) {
            return {
                eventType: "ConditionOrderActivatedEvent",
                event: decodeConditionOrderActivatedEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.CONDITION_ORDER_PARENT_REBOUND)) {
            return {
                eventType: "ConditionOrderParentReboundEvent",
                event: decodeConditionOrderParentReboundEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.WHOLE_POSITION_OCO_UPDATED)) {
            return {
                eventType: "WholePositionOcoUpdatedEvent",
                event: decodeWholePositionOcoUpdatedEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.LIQUIDATION_RISK_TRANSFER)) {
            return {
                eventType: "LiquidationRiskTransferEvent",
                event: decodeLiquidationRiskTransferEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.LIQUIDATION_INTERNAL_OFFSET)) {
            return {
                eventType: "LiquidationInternalOffsetEvent",
                event: decodeLiquidationInternalOffsetEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.LIQUIDATION_FAILED)) {
            return {
                eventType: "LiquidationFailedEvent",
                event: decodeLiquidationFailedEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.LIQUIDATION_DIRECT_ADL)) {
            return {
                eventType: "LiquidationDirectAdlEvent",
                event: decodeLiquidationDirectAdlEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.DELISTING_PLAN_SET)) {
            return {
                eventType: "DelistingPlanSetEvent",
                event: decodeDelistingPlanSetEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.DELISTING_PRICED)) {
            return {
                eventType: "DelistingPricedEvent",
                event: decodeDelistingPricedEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.DELISTING_SETTLED)) {
            return {
                eventType: "DelistingSettledEvent",
                event: decodeDelistingSettledEventJson(data),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.SYMBOL_CLOSED)) {
            return {
                eventType: "SymbolClosedEvent",
                event: decodeSymbolClosedEventJson(data),
            };
        }
    } catch {
        return null;
    }

    const eventType = structuredDexEventType(typeStr);
    return eventType === null ? null : { eventType, event: data };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check if a Move event type string is a known DEX event.
 */
export function isDexEvent(typeStr: string): boolean {
    return (
        isReferralEvent(typeStr) ||
        structuredDexEventType(typeStr) !== null ||
        Object.values(EVENT_TAGS).some((tag) => typeStr.endsWith(tag))
    );
}

/**
 * Decode a DEX event from its Move type string and `data`.
 *
 * `data` may be either transport the chain REST uses:
 * - a hex-encoded BCS string (native-executor events), or
 * - a JSON object (Move-ABI events, e.g. the liquidation events).
 *
 * @param typeStr - The Move event type (e.g., "0x...::dex::FillEvent")
 * @param data - Hex-encoded BCS bytes (string) or a decoded JSON object
 * @returns Decoded event with type info, or null if unknown/failed
 */
export function decodeDexEvent(
    typeStr: string,
    data: string | Record<string, unknown>,
): DecodedDexEvent | null {
    if(isReferralEvent(typeStr)) {
        try { const referral=decodeReferralEvent(typeStr,data);if(referral)return referral; } catch {return null;}
    }
    const vaultName = VAULT_EVENT_NAMES.find((name) => typeStr.endsWith("::dex::" + name));
    if (vaultName !== undefined) {
        try {
            return { eventType: vaultName, event: decodeVaultEvent(vaultName, data) };
        } catch {
            return null;
        }
    }
    if (data !== null && typeof data === "object" && !Array.isArray(data)) {
        return decodeDexEventFromJson(typeStr, data);
    }
    if (typeof data !== "string") {
        return null;
    }
    let bytes: Uint8Array;
    try {
        bytes = hexToBytes(data);
    } catch {
        return null;
    }

    try {
        if (typeStr.endsWith(EVENT_TAGS.FILL)) {
            return { eventType: "FillEvent", event: decodeFillEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ORDER_PLACED)) {
            return { eventType: "OrderPlacedEvent", event: decodeOrderPlacedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ORDER_CANCELLED)) {
            return { eventType: "OrderCancelledEvent", event: decodeOrderCancelledEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ORDER_AMENDED)) {
            return { eventType: "OrderAmendedEvent", event: decodeOrderAmendedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ORDER_REJECTED)) {
            return { eventType: "OrderRejectedEvent", event: decodeOrderRejectedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ORDER_FILLED)) {
            return { eventType: "OrderFilledEvent", event: decodeOrderFilledEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.CONDITION_ORDER_PLACED)) {
            return { eventType: "ConditionOrderPlacedEvent", event: decodeOrderPlacedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.CONDITION_ORDER_ACTIVATED)) {
            return {
                eventType: "ConditionOrderActivatedEvent",
                event: decodeConditionOrderActivatedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.CONDITION_ORDER_PARENT_REBOUND)) {
            return {
                eventType: "ConditionOrderParentReboundEvent",
                event: decodeConditionOrderParentReboundEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.CONDITION_ORDER_TRIGGERED)) {
            return { eventType: "ConditionOrderTriggeredEvent", event: decodeConditionOrderTriggeredEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.WHOLE_POSITION_OCO_UPDATED)) {
            return {
                eventType: "WholePositionOcoUpdatedEvent",
                event: decodeWholePositionOcoUpdatedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.FUNDING_RATE)) {
            return { eventType: "FundingRateEvent", event: decodeFundingRateEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ACCOUNT)) {
            return { eventType: "AccountEvent", event: decodeAccountEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.MARK_PRICE)) {
            return { eventType: "MarkPriceEvent", event: decodeMarkPriceEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.INDEX_PRICE)) {
            return { eventType: "IndexPriceEvent", event: decodeIndexPriceEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.FUNDING_PREDICTION)) {
            return { eventType: "FundingPredictionEvent", event: decodeFundingPredictionEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.SET_SYMBOL_TRADING_POLICY)) {
            return { eventType: "SetSymbolTradingPolicyEvent", event: decodeSetSymbolTradingPolicyEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.SET_SYMBOL_LEVERAGE_TIER)) {
            return { eventType: "SetSymbolLeverageTierEvent", event: decodeSetSymbolLeverageTierEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.SET_SYMBOL_DISPLAY_INFO)) {
            return { eventType: "SetSymbolDisplayInfoEvent", event: decodeSetSymbolDisplayInfoEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.SYMBOL_OPENED)) {
            return { eventType: "SymbolOpenedEvent", event: decodeSymbolOpenedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.DELISTING_PLAN_SET)) {
            return {
                eventType: "DelistingPlanSetEvent",
                event: decodeDelistingPlanSetEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.DELISTING_PRICED)) {
            return {
                eventType: "DelistingPricedEvent",
                event: decodeDelistingPricedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.DELISTING_SETTLED)) {
            return {
                eventType: "DelistingSettledEvent",
                event: decodeDelistingSettledEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.SYMBOL_CLOSED)) {
            return { eventType: "SymbolClosedEvent", event: decodeSymbolClosedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.LIQUIDATION_RISK_TRANSFER)) {
            return {
                eventType: "LiquidationRiskTransferEvent",
                event: decodeLiquidationRiskTransferEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.LIQUIDATION_INTERNAL_OFFSET)) {
            return {
                eventType: "LiquidationInternalOffsetEvent",
                event: decodeLiquidationInternalOffsetEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.LIQUIDATION_FAILED)) {
            return {
                eventType: "LiquidationFailedEvent",
                event: decodeLiquidationFailedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.LIQUIDATION_DIRECT_ADL)) {
            return {
                eventType: "LiquidationDirectAdlEvent",
                event: decodeLiquidationDirectAdlEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADL_EXECUTION)) {
            return {
                eventType: "AdlExecutionEvent",
                event: decodeAdlExecutionEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADL_VAULT_INITIALIZED)) {
            return {
                eventType: "AdlVaultInitializedEvent",
                event: decodeAdlVaultInitializedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.FAUCET_MINT)) {
            return { eventType: "FaucetMintEvent", event: decodeFaucetMintEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.INTERNAL_TRANSFER)) {
            return { eventType: "InternalTransferEvent", event: decodeInternalTransferEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ACCOUNT_TRANSFER)) {
            return { eventType: "AccountTransferEvent", event: decodeAccountTransferEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.AUTHORITY_CHANGED)) {
            return { eventType: "AuthorityChangedEvent", event: decodeAuthorityChangedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.MULTISIG_OPERATION_EXECUTED)) {
            return {
                eventType: "MultisigOperationExecutedEvent",
                event: decodeMultisigOperationExecutedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.CROSS_TRANSFER)) {
            return { eventType: "CrossTransferEvent", event: decodeCrossTransferEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.CREATE_SUB_ACCOUNT)) {
            return { eventType: "CreateSubAccountEvent", event: decodeCreateSubAccountEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.MODIFY_SUB_ACCOUNT)) {
            return { eventType: "ModifySubAccountEvent", event: decodeModifySubAccountEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.SET_USER_LEVERAGE)) {
            return { eventType: "SetUserLeverageEvent", event: decodeSetUserLeverageEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.CHANGE_POSITION_MODE)) {
            return { eventType: "ChangePositionModeEvent", event: decodeChangePositionModeEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.CHANGE_MARGIN_MODE)) {
            return { eventType: "ChangeMarginModeEvent", event: decodeChangeMarginModeEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADJUST_ISOLATED_MARGIN)) {
            return {
                eventType: "AdjustIsolatedMarginEvent",
                event: decodeAdjustIsolatedMarginEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_CREATED)) {
            return { eventType: "VaultCreatedEvent", event: decodeVaultCreatedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_UPDATED)) {
            return { eventType: "VaultUpdatedEvent", event: decodeVaultUpdatedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_DEPOSITED)) {
            return { eventType: "VaultDepositedEvent", event: decodeVaultDepositedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_WITHDRAW_REQUESTED)) {
            return {
                eventType: "VaultWithdrawRequestedEvent",
                event: decodeVaultWithdrawRequestedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_WITHDRAW_COMPLETED)) {
            return {
                eventType: "VaultWithdrawCompletedEvent",
                event: decodeVaultWithdrawCompletedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_WITHDRAW_REJECTED)) {
            return {
                eventType: "VaultWithdrawRejectedEvent",
                event: decodeVaultWithdrawRejectedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_WITHDRAW_FAILED)) {
            return {
                eventType: "VaultWithdrawFailedEvent",
                event: decodeVaultWithdrawFailedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_SHARES_BURNED)) {
            return {
                eventType: "VaultSharesBurnedEvent",
                event: decodeVaultSharesBurnedEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_LEADER_FEE_PAID)) {
            return {
                eventType: "VaultLeaderFeePaidEvent",
                event: decodeVaultLeaderFeePaidEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_DISTRIBUTE)) {
            return {
                eventType: "VaultDistributeEvent",
                event: decodeVaultDistributeEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.VAULT_DISTRIBUTE_DEPOSITOR)) {
            return {
                eventType: "VaultDistributeDepositorEvent",
                event: decodeVaultDistributeDepositorEvent(bytes),
            };
        }
        if (typeStr.endsWith(EVENT_TAGS.CREATE_SPOT)) {
            return { eventType: "CreateSpotEvent", event: decodeCreateSpotEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.CREATE_PERPETUAL)) {
            return { eventType: "CreatePerpetualEvent", event: decodeCreatePerpetualEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.UPDATE_LEVERAGE)) {
            return { eventType: "UpdateLeverageEvent", event: decodeUpdateLeverageEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.SET_ACCOUNT_FEE_RATE)) {
            return { eventType: "SetAccountFeeRateEvent", event: decodeSetAccountFeeRateEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.SET_FEE_CONFIG)) {
            return { eventType: "SetFeeConfigEvent", event: decodeSetFeeConfigEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.UPDATE_BRIDGE_SIGNERS)) {
            return { eventType: "UpdateBridgeSignersEvent", event: decodeUpdateBridgeSignersEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.SET_BRIDGE_FEES)) {
            return { eventType: "SetBridgeFeesEvent", event: decodeSetBridgeFeesEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.SET_FAUCET_MINT_ENABLED)) {
            return { eventType: "SetFaucetMintEnabledEvent", event: decodeSetFaucetMintEnabledEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.BATCH_SYSTEM_CONFIG)) {
            return { eventType: "BatchSystemConfigEvent", event: decodeBatchSystemConfigEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.BATCH_OP_FAILED)) {
            return { eventType: "BatchOpFailedEvent", event: decodeBatchOpFailedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_CONTROL_INITIALIZED)) {
            return { eventType: "AdminControlInitializedEvent", event: decodeAdminControlInitializedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_CONTROL_ENABLED)) {
            return { eventType: "AdminControlEnabledEvent", event: decodeAdminControlEnabledEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_ACTION_SCHEDULED)) {
            return { eventType: "AdminActionScheduledEvent", event: decodeAdminActionScheduledEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_ACTION_EXECUTED)) {
            return { eventType: "AdminActionExecutedEvent", event: decodeAdminActionExecutedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_ACTION_CANCELLED)) {
            return { eventType: "AdminActionCancelledEvent", event: decodeAdminActionCancelledEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_ACTION_EXPIRED)) {
            return { eventType: "AdminActionExpiredEvent", event: decodeAdminActionExpiredEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_ACTION_INVALIDATED)) {
            return { eventType: "AdminActionInvalidatedEvent", event: decodeAdminActionInvalidatedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_CONTROL_ROTATED)) {
            return { eventType: "AdminControlRotatedEvent", event: decodeAdminControlCommitteeUpdatedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_CONTROL_POLICY_UPDATED)) {
            return { eventType: "AdminControlPolicyUpdatedEvent", event: decodeAdminControlPolicyUpdatedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_CONTROL_LISTING_SIGNER_SET_UPDATED)) {
            return { eventType: "AdminControlListingSignerSetUpdatedEvent", event: decodeAdminControlCommitteeUpdatedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.FEE_SIGNER_SET_UPDATED)) {
            return { eventType: "FeeSignerSetUpdatedEvent", event: decodeAdminControlCommitteeUpdatedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.FEE_CONFIG_UPDATED)) {
            return { eventType: "FeeConfigUpdatedEvent", event: decodeFeeConfigUpdatedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.ADMIN_CONTROL_ROLE_UPDATED)) {
            return { eventType: "AdminControlRoleUpdatedEvent", event: decodeAdminControlRoleUpdatedEvent(bytes) };
        }
        if (typeStr.endsWith(EVENT_TAGS.FEE_STATEMENT)) {
            return { eventType: "FeeStatement", event: decodeFeeStatementEvent(bytes) };
        }
    } catch {
        return null;
    }

    return null;
}

/**
 * Batch decode all events from a transaction response.
 * Skips non-DEX events and events that fail to decode.
 *
 * @param events - Array of events with `type` and `data` fields
 * @returns Array of successfully decoded events with their index
 */
export function decodeTransactionEvents(
    events: Array<{ type: string; data: unknown }>,
): Array<{ index: number; eventType: DexEventType; event: DecodedDexEvent["event"] }> {
    const results: Array<{ index: number; eventType: DexEventType; event: DecodedDexEvent["event"] }> = [];

    for (let i = 0; i < events.length; i++) {
        const evt = events[i];
        if (!isDexEvent(evt.type)) continue;
        // `data` may be a hex BCS string or a JSON object (chain REST delivers
        // Move-ABI events, e.g. liquidations, as JSON). Skip only empty data.
        if (evt.data == null) continue;

        const decoded = decodeDexEvent(evt.type, evt.data as string | Record<string, unknown>);
        if (decoded) {
            results.push({ index: i, ...decoded });
        }
    }

    return results;
}

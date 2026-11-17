// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * DEX Event Types - BCS-encoded event definitions and decode functions.
 *
 * Events are emitted as BCS-encoded bytes in transaction output.
 * Use the decode functions to parse them into typed structures.
 */

import { Deserializer } from "../bcs/deserializer";
import { AccountAddress } from "../core/accountAddress";

function readAddress(d: Deserializer): AccountAddress {
    return new AccountAddress(d.deserializeFixedBytes(32));
}

function readOptionString(d: Deserializer): string | null {
    return d.deserializeBool() ? d.deserializeStr() : null;
}

function readOptionU64(d: Deserializer): bigint | null {
    return d.deserializeBool() ? d.deserializeU64() : null;
}

function readTrailingOptionU32(d: Deserializer): number | null {
    if (d.remaining === 0) return null;
    return d.deserializeBool() ? d.deserializeU32() : null;
}

export interface SubaccountId {
    address: AccountAddress;
    number: number;
    subAddress: AccountAddress;
    userName: Uint8Array;
}

function readSubaccountId(d: Deserializer): SubaccountId {
    return {
        address: readAddress(d),
        number: d.deserializeU32(),
        subAddress: readAddress(d),
        userName: d.deserializeFixedBytes(16),
    };
}

// ---------------------------------------------------------------------------
// dex_transfer events
// ---------------------------------------------------------------------------

export interface InternalTransferEvent {
    success: boolean;
}

export function decodeInternalTransferEvent(data: Uint8Array): InternalTransferEvent {
    const d = new Deserializer(data);
    return { success: d.deserializeBool() };
}

/**
 * AccountTransferEvent is emitted once per account-transfer item, mirroring
 * the on-chain Rust definition for DEX account transfers.
 * Only emitted after a successful transfer (no `success` field - its
 * presence implies success). The event is self-describing (carries both
 * sender and recipient) so consumers can rebuild the full transfer without
 * re-parsing the payload.
 */
export interface AccountTransferEvent {
    fromAccount: AccountAddress;
    /** The owner the chain resolved the recipient address to. */
    toAccount: AccountAddress;
    /**
     * Set when the money landed on a subaccount; zero when it landed on the main
     * account. The payload carries one recipient address and the chain decides
     * which it was, so without this field there is no way to tell them apart.
     */
    toSubaccount: AccountAddress;
    assetId: number;
    originalAmount: bigint;
    netAmount: bigint;
    feeAmount: bigint;
    /** Set when an activation fee was charged (recipient was newly created). */
    feeAccount?: AccountAddress;
}

export function decodeAccountTransferEvent(data: Uint8Array): AccountTransferEvent {
    const d = new Deserializer(data);
    const fromAccount = readAddress(d);
    const toAccount = readAddress(d);
    const toSubaccount = readAddress(d);
    const assetId = d.deserializeU32();
    const originalAmount = d.deserializeU64();
    const netAmount = d.deserializeU64();
    const feeAmount = d.deserializeU64();
    const hasAccount = d.deserializeBool();
    let feeAccount: AccountAddress | undefined;
    if (hasAccount) {
        feeAccount = readAddress(d);
    }
    return {
        fromAccount,
        toAccount,
        toSubaccount,
        assetId,
        originalAmount,
        netAmount,
        feeAmount,
        feeAccount,
    };
}

export interface CrossTransferEvent {
    success: boolean;
    msgId: Uint8Array;
    toAccount: AccountAddress;
    originalAmount: bigint;
    netAmount: bigint;
    feeAmount: bigint;
    feeAccount?: AccountAddress;
    /** Transfer direction: 0 = Mint (deposit), 1 = Burn (withdrawal) */
    option: number;
}

export function decodeCrossTransferEvent(data: Uint8Array): CrossTransferEvent {
    const d = new Deserializer(data);
    const success = d.deserializeBool();
    const msgId = d.deserializeBytes();
    const toAccount = readAddress(d);
    const originalAmount = d.deserializeU64();
    const netAmount = d.deserializeU64();
    const feeAmount = d.deserializeU64();
    const hasAccount = d.deserializeBool();
    let feeAccount: AccountAddress | undefined;
    if (hasAccount) {
        feeAccount = readAddress(d);
    }
    const option = d.deserializeU8();
    return { success, msgId, toAccount, originalAmount, netAmount, feeAmount, feeAccount, option };
}

export interface FaucetMintEvent {
    success: boolean;
    toAccount: AccountAddress;
    assetId: number;
    originalAmount: bigint;
    netAmount: bigint;
    feeAmount: bigint;
    feeAccount?: AccountAddress;
}

export function decodeFaucetMintEvent(data: Uint8Array): FaucetMintEvent {
    const d = new Deserializer(data);
    const success = d.deserializeBool();
    const toAccount = readAddress(d);
    const assetId = d.deserializeU32();
    const originalAmount = d.deserializeU64();
    const netAmount = d.deserializeU64();
    const feeAmount = d.deserializeU64();
    const hasAccount = d.deserializeBool();
    let feeAccount: AccountAddress | undefined;
    if (hasAccount) {
        feeAccount = readAddress(d);
    }
    return { success, toAccount, assetId, originalAmount, netAmount, feeAmount, feeAccount };
}

// ---------------------------------------------------------------------------
// dex_sys_config events (all success-only)
// ---------------------------------------------------------------------------

export interface SuccessEvent {
    success: boolean;
}

function decodeSuccessEvent(data: Uint8Array): SuccessEvent {
    const d = new Deserializer(data);
    return { success: d.deserializeBool() };
}

export const decodeCreateSpotEvent = decodeSuccessEvent;
export const decodeCreatePerpetualEvent = decodeSuccessEvent;
export const decodeUpdateLeverageEvent = decodeSuccessEvent;
export const decodeSetAccountFeeRateEvent = decodeSuccessEvent;
export const decodeSetFeeConfigEvent = decodeSuccessEvent;
export const decodeUpdateBridgeSignersEvent = decodeSuccessEvent;
export const decodeSetBridgeFeesEvent = decodeSuccessEvent;
export const decodeSetFaucetMintEnabledEvent = decodeSuccessEvent;
export interface SetSymbolTradingPolicyEvent {
    perpetualId: number;
}

export function decodeSetSymbolTradingPolicyEvent(data: Uint8Array): SetSymbolTradingPolicyEvent {
    const d = new Deserializer(data);
    return { perpetualId: d.deserializeU32() };
}

export interface SetSymbolLeverageTierEvent {
    perpetualId: number;
    tier: number;
}

export function decodeSetSymbolLeverageTierEvent(data: Uint8Array): SetSymbolLeverageTierEvent {
    const d = new Deserializer(data);
    return {
        perpetualId: d.deserializeU32(),
        tier: d.deserializeU32(),
    };
}

export interface SetSymbolDisplayInfoEvent {
    perpetualId: number;
}

export function decodeSetSymbolDisplayInfoEvent(data: Uint8Array): SetSymbolDisplayInfoEvent {
    const d = new Deserializer(data);
    return { perpetualId: d.deserializeU32() };
}

export interface SymbolOpenedEvent {
    perpetualId: number;
    listingTime: bigint;
    openingMarkPrice: bigint;
}

export function decodeSymbolOpenedEvent(data: Uint8Array): SymbolOpenedEvent {
    const d = new Deserializer(data);
    return {
        perpetualId: d.deserializeU32(),
        listingTime: d.deserializeU64(),
        openingMarkPrice: d.deserializeU64(),
    };
}

/** Batch summary emitted once per `BatchSystemConfig` tx (mirrors the on-chain system config). */
export interface BatchSystemConfigEvent {
    total: number;
    succeeded: number;
    failed: number;
}

export function decodeBatchSystemConfigEvent(data: Uint8Array): BatchSystemConfigEvent {
    const d = new Deserializer(data);
    return {
        total: d.deserializeU32(),
        succeeded: d.deserializeU32(),
        failed: d.deserializeU32(),
    };
}

/**
 * Per-sub-op failure emitted for each failed op when an all-or-nothing batch is rejected.
 * `id` = perpetual_id/symbol_id; `subOpKind` = DexSystemConfigSubOp tag; `reasonCode` =
 * the sub-op's ExecutionErrorCode.
 */
export interface BatchOpFailedEvent {
    index: number;
    id: number;
    subOpKind: number;
    reasonCode: bigint;
}

export function decodeBatchOpFailedEvent(data: Uint8Array): BatchOpFailedEvent {
    const d = new Deserializer(data);
    return {
        index: d.deserializeU32(),
        id: d.deserializeU32(),
        subOpKind: d.deserializeU8(),
        reasonCode: d.deserializeU64(),
    };
}

// ---------------------------------------------------------------------------
// dex_user_config events
// ---------------------------------------------------------------------------

export interface CreateSubAccountEvent {
    subAddress: AccountAddress;
}

export function decodeCreateSubAccountEvent(data: Uint8Array): CreateSubAccountEvent {
    const d = new Deserializer(data);
    const addrBytes = d.deserializeFixedBytes(32);
    return { subAddress: new AccountAddress(addrBytes) };
}

export interface ModifySubAccountEvent {
    subAddress: AccountAddress;
    name: string;
}

export function decodeModifySubAccountEvent(data: Uint8Array): ModifySubAccountEvent {
    const d = new Deserializer(data);
    const addrBytes = d.deserializeFixedBytes(32);
    const name = d.deserializeStr();
    return { subAddress: new AccountAddress(addrBytes), name };
}

export interface SetUserLeverageEvent {
    subAddress: AccountAddress;
}

export function decodeSetUserLeverageEvent(data: Uint8Array): SetUserLeverageEvent {
    const d = new Deserializer(data);
    const addrBytes = d.deserializeFixedBytes(32);
    return { subAddress: new AccountAddress(addrBytes) };
}

export interface ChangePositionModeEvent {
    subAddress: AccountAddress;
}

export function decodeChangePositionModeEvent(data: Uint8Array): ChangePositionModeEvent {
    const d = new Deserializer(data);
    const addrBytes = d.deserializeFixedBytes(32);
    return { subAddress: new AccountAddress(addrBytes) };
}

export interface ChangeMarginModeEvent {
    subAddress: AccountAddress;
}

export function decodeChangeMarginModeEvent(data: Uint8Array): ChangeMarginModeEvent {
    const d = new Deserializer(data);
    const addrBytes = d.deserializeFixedBytes(32);
    return { subAddress: new AccountAddress(addrBytes) };
}

export interface AdjustIsolatedMarginEvent {
    subAddress: AccountAddress;
}

export function decodeAdjustIsolatedMarginEvent(data: Uint8Array): AdjustIsolatedMarginEvent {
    const d = new Deserializer(data);
    return { subAddress: readAddress(d) };
}

// ---------------------------------------------------------------------------
// vault_events user-facing events
// ---------------------------------------------------------------------------

export interface VaultCreatedEvent {
    vaultId: bigint;
    vaultType: number;
    creator: AccountAddress;
    vaultAccount: SubaccountId;
    lockupSeconds: number;
    alwaysProportionalClose: boolean;
    vaultName: string;
    strategyDescription: string;
    timestampUs: bigint;
}

export function decodeVaultCreatedEvent(data: Uint8Array): VaultCreatedEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        vaultType: d.deserializeU8(),
        creator: readAddress(d),
        vaultAccount: readSubaccountId(d),
        lockupSeconds: d.deserializeU32(),
        alwaysProportionalClose: d.deserializeBool(),
        vaultName: d.deserializeStr(),
        strategyDescription: d.deserializeStr(),
        timestampUs: d.deserializeU64(),
    };
}

export interface VaultUpdatedEvent {
    vaultId: bigint;
    fieldsMask: number;
    navE6: bigint | null;
    tvlUsdc: bigint | null;
    status: number | null;
    timestampUs: bigint;
}

export function decodeVaultUpdatedEvent(data: Uint8Array): VaultUpdatedEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        fieldsMask: d.deserializeU32(),
        navE6: d.deserializeBool() ? d.deserializeI128() : null,
        tvlUsdc: d.deserializeBool() ? d.deserializeI128() : null,
        status: d.deserializeBool() ? d.deserializeU8() : null,
        timestampUs: d.deserializeU64(),
    };
}

export interface VaultDepositedEvent {
    vaultId: bigint;
    depositor: SubaccountId;
    nonce: bigint;
    amountUsdc: bigint;
    mintShares: bigint;
    navE6: bigint;
    timestampUs: bigint;
}

export function decodeVaultDepositedEvent(data: Uint8Array): VaultDepositedEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        depositor: readSubaccountId(d),
        nonce: d.deserializeU64(),
        amountUsdc: d.deserializeI128(),
        mintShares: d.deserializeI128(),
        navE6: d.deserializeI128(),
        timestampUs: d.deserializeU64(),
    };
}

export interface VaultWithdrawRequestedEvent {
    vaultId: bigint;
    requester: SubaccountId;
    nonce: bigint;
    withdrawShares: bigint;
    quotedAmountUsdc: bigint;
    status: number;
    timestampUs: bigint;
}

export function decodeVaultWithdrawRequestedEvent(data: Uint8Array): VaultWithdrawRequestedEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        requester: readSubaccountId(d),
        nonce: d.deserializeU64(),
        withdrawShares: d.deserializeI128(),
        quotedAmountUsdc: d.deserializeI128(),
        status: d.deserializeU8(),
        timestampUs: d.deserializeU64(),
    };
}

export interface VaultWithdrawCompletedEvent {
    vaultId: bigint;
    requester: SubaccountId;
    nonce: bigint;
    withdrawShares: bigint;
    settledAmountUsdc: bigint;
    leaderFeeUsdc: bigint;
    timestampUs: bigint;
}

export function decodeVaultWithdrawCompletedEvent(data: Uint8Array): VaultWithdrawCompletedEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        requester: readSubaccountId(d),
        nonce: d.deserializeU64(),
        withdrawShares: d.deserializeI128(),
        settledAmountUsdc: d.deserializeI128(),
        leaderFeeUsdc: d.deserializeI128(),
        timestampUs: d.deserializeU64(),
    };
}

export interface VaultWithdrawErrorEvent {
    vaultId: bigint;
    requester: SubaccountId;
    nonce: bigint;
    errorCode: number;
    timestampUs: bigint;
}

function decodeVaultWithdrawErrorEvent(data: Uint8Array): VaultWithdrawErrorEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        requester: readSubaccountId(d),
        nonce: d.deserializeU64(),
        errorCode: d.deserializeU8(),
        timestampUs: d.deserializeU64(),
    };
}

export const decodeVaultWithdrawRejectedEvent = decodeVaultWithdrawErrorEvent;
export const decodeVaultWithdrawFailedEvent = decodeVaultWithdrawErrorEvent;

export interface VaultSharesBurnedEvent {
    vaultId: bigint;
    burnShares: bigint;
    totalSharesAfter: bigint;
    timestampUs: bigint;
}

export function decodeVaultSharesBurnedEvent(data: Uint8Array): VaultSharesBurnedEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        burnShares: d.deserializeI128(),
        totalSharesAfter: d.deserializeI128(),
        timestampUs: d.deserializeU64(),
    };
}

export interface VaultLeaderFeePaidEvent {
    vaultId: bigint;
    leader: AccountAddress;
    feeUsdc: bigint;
    nonce: bigint;
    timestampUs: bigint;
}

export function decodeVaultLeaderFeePaidEvent(data: Uint8Array): VaultLeaderFeePaidEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        leader: readAddress(d),
        feeUsdc: d.deserializeI128(),
        nonce: d.deserializeU64(),
        timestampUs: d.deserializeU64(),
    };
}

export interface VaultDistributeEvent {
    vaultId: bigint;
    nonce: bigint;
    totalDistributedUsdc: bigint;
    totalLeaderFeeUsdc: bigint;
    totalSharesBurned: bigint;
    depositorCount: number;
    timestampUs: bigint;
}

export function decodeVaultDistributeEvent(data: Uint8Array): VaultDistributeEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        nonce: d.deserializeU64(),
        totalDistributedUsdc: d.deserializeI128(),
        totalLeaderFeeUsdc: d.deserializeI128(),
        totalSharesBurned: d.deserializeI128(),
        depositorCount: d.deserializeU32(),
        timestampUs: d.deserializeU64(),
    };
}

export interface VaultDistributeDepositorEvent {
    vaultId: bigint;
    depositor: SubaccountId;
    nonce: bigint;
    amountUsdc: bigint;
    sharesBurned: bigint;
    leaderFeeUsdc: bigint;
    timestampUs: bigint;
}

export function decodeVaultDistributeDepositorEvent(
    data: Uint8Array,
): VaultDistributeDepositorEvent {
    const d = new Deserializer(data);
    return {
        vaultId: d.deserializeU64(),
        depositor: readSubaccountId(d),
        nonce: d.deserializeU64(),
        amountUsdc: d.deserializeI128(),
        sharesBurned: d.deserializeI128(),
        leaderFeeUsdc: d.deserializeI128(),
        timestampUs: d.deserializeU64(),
    };
}

// ---------------------------------------------------------------------------
// trading events
// ---------------------------------------------------------------------------

export interface OrderPlacedEvent {
    subaccountId: SubaccountId;
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
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
    /** Maker-risk fee rate captured by the order; null for old or pending conditional events. */
    reservationFeeRatePpm: number | null;
}

export function decodeOrderPlacedEvent(data: Uint8Array): OrderPlacedEvent {
    const d = new Deserializer(data);
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
        clientOrderId: readOptionString(d),
        blockHeight: d.deserializeU64(),
        blockTimestamp: d.deserializeU64(),
        reservationFeeRatePpm: readTrailingOptionU32(d),
    };
}

export type ConditionOrderPlacedEvent = OrderPlacedEvent;

export function decodeConditionOrderPlacedEvent(data: Uint8Array): ConditionOrderPlacedEvent {
    return decodeOrderPlacedEvent(data);
}

export interface ConditionOrderActivatedEvent {
    orderId: bigint;
    parentOrderId: bigint;
    owner: AccountAddress;
    subAddress: AccountAddress;
    symbolId: number;
    conditionType: number;
    clientOrderId: string | null;
    isActivated: boolean;
    activationState: number;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export function decodeConditionOrderActivatedEvent(
    data: Uint8Array,
): ConditionOrderActivatedEvent {
    const d = new Deserializer(data);
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

export interface ConditionOrderParentReboundEvent {
    orderId: bigint;
    oldParentOrderId: bigint;
    newParentOrderId: bigint;
    owner: AccountAddress;
    subAddress: AccountAddress;
    symbolId: number;
    conditionType: number;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export function decodeConditionOrderParentReboundEvent(
    data: Uint8Array,
): ConditionOrderParentReboundEvent {
    const d = new Deserializer(data);
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

export interface ConditionOrderTriggeredEvent {
    orderId: bigint;
    owner: AccountAddress;
    subAddress: AccountAddress;
    symbolId: number;
    conditionType: number;
    state: number;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export function decodeConditionOrderTriggeredEvent(data: Uint8Array): ConditionOrderTriggeredEvent {
    const d = new Deserializer(data);
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

export interface WholePositionOcoUpdatedEvent {
    owner: AccountAddress;
    subAddress: AccountAddress;
    symbolId: number;
    positionSide: number;
    groupId: bigint;
    takeProfitOrderId: bigint | null;
    stopLossOrderId: bigint | null;
    updateType: number;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export function decodeWholePositionOcoUpdatedEvent(
    data: Uint8Array,
): WholePositionOcoUpdatedEvent {
    const d = new Deserializer(data);
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

export interface OrderFilledEvent {
    orderId: bigint;
    owner: AccountAddress;
    subAddress: AccountAddress;
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

export function decodeOrderFilledEvent(data: Uint8Array): OrderFilledEvent {
    const d = new Deserializer(data);
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

export interface OrderCancelledEvent {
    orderId: bigint;
    owner: AccountAddress;
    subAddress: AccountAddress;
    symbolId: number;
    remainingQuantums: bigint;
    canceledBy: number;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export function decodeOrderCancelledEvent(data: Uint8Array): OrderCancelledEvent {
    const d = new Deserializer(data);
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

export interface OrderAmendedEvent {
    orderId: bigint;
    owner: AccountAddress;
    subAddress: AccountAddress;
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

export function decodeOrderAmendedEvent(data: Uint8Array): OrderAmendedEvent {
    const d = new Deserializer(data);
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

export interface OrderRejectedEvent {
    orderId: bigint;
    owner: AccountAddress;
    subAddress: AccountAddress;
    symbolId: number;
    rejectReason: number;
    transactionId: Uint8Array;
    clientOrderId: string | null;
    blockHeight: bigint;
    blockTimestamp: bigint;
}

export function decodeOrderRejectedEvent(data: Uint8Array): OrderRejectedEvent {
    const d = new Deserializer(data);
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

export interface FillEvent {
    symbolId: number;
    fillOrderId: bigint;
    makerOrderId: bigint;
    takerOrderId: bigint;
    filledQuantums: bigint;
    matchSubticks: bigint;
    blockHeight: bigint;
    fillTimestamp: bigint;
    makerSubaccountId: SubaccountId;
    makerDirection: number;
    makerOpenQuantums: bigint;
    makerCloseQuantums: bigint;
    makerOpeningFee: bigint;
    makerClosingFee: bigint;
    makerNewState: number;
    makerRealizedPnl: bigint;
    makerClientOrderId: string | null;
    takerSubaccountId: SubaccountId;
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
    isLiquidation: boolean;
}

export function decodeFillEvent(data: Uint8Array): FillEvent {
    const d = new Deserializer(data);
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

// Per-symbol funding rate event. Replaces the removed per-account
// FundingSettlementEvent - the chain no longer emits per-account funding flow;
// it emits this per-symbol event (the chain's dex.move FundingRateEvent).
export interface FundingRateEvent {
    symbolId: number;
    fundingRatePpm: number;
    markPrice: bigint;
    blockHeight: bigint;
    timestamp: bigint;
}

export function decodeFundingRateEvent(data: Uint8Array): FundingRateEvent {
    const d = new Deserializer(data);
    return {
        symbolId: d.deserializeU32(),
        fundingRatePpm: d.deserializeI32(),
        markPrice: d.deserializeU64(),
        blockHeight: d.deserializeU64(),
        timestamp: d.deserializeU64(),
    };
}

export interface AccountUpdatedEvent {
    owner: AccountAddress;
    subAddress: AccountAddress;
    assetId: number;
    newBalance: bigint;
    reason: number;
    blockHeight: bigint;
    timestamp: bigint;
}

export function decodeAccountUpdatedEvent(data: Uint8Array): AccountUpdatedEvent {
    const d = new Deserializer(data);
    return {
        owner: readAddress(d),
        subAddress: readAddress(d),
        assetId: d.deserializeU32(),
        newBalance: d.deserializeU64(),
        reason: d.deserializeU8(),
        blockHeight: d.deserializeU64(),
        timestamp: d.deserializeU64(),
    };
}

// ---------------------------------------------------------------------------
// Account authority (native multisig) events
//
// `auth_key`, `owners_digest` and `op_id` are declared `Vec<u8>` on the chain
// rather than `[u8; 32]`, so each one carries a ULEB length byte. They are read
// with `deserializeBytes` for that reason; reading them as fixed 32 bytes would
// consume the length byte as data and shift every field after it.
// ---------------------------------------------------------------------------

/**
 * Emitted by every authority change, whichever of the five operations made it.
 *
 * One event for all of them, with `opKind` saying which, so "how did control of
 * this account change" is a single stream to follow.
 */
export interface AuthorityChangedEvent {
    account: AccountAddress;
    /** The epoch being replaced; zero when the account had no record. */
    oldEpoch: bigint;
    /**
     * The epoch now in force. Monotonic for the life of the account, which is
     * what retires every approval signed against an earlier owner set.
     */
    newEpoch: bigint;
    /** 0 = a named control key, 1 = a k-of-n policy ({@link AuthorityKindVariant}). */
    kind: number;
    /** The named control key, or 32 zero bytes for a policy. */
    authKey: Uint8Array;
    /** Approvals required. Zero for a key record. */
    threshold: number;
    /** Size of the owner set. Zero for a key record. */
    ownerCount: number;
    /**
     * Commitment to the owner list, or 32 zero bytes for a key record. The
     * members themselves are not in the event - an owner set is up to ten
     * addresses of consensus-visible payload - so a reader that holds a set
     * checks it against this (`multisigOwnersDigest`) and reads the record when
     * it needs the addresses.
     */
    ownersDigest: Uint8Array;
    /** Which multisig operation made the change ({@link MultisigOpVariant}). */
    opKind: number;
    /** Who submitted the change. */
    executor: AccountAddress;
}

export function decodeAuthorityChangedEvent(data: Uint8Array): AuthorityChangedEvent {
    const d = new Deserializer(data);
    return {
        account: readAddress(d),
        oldEpoch: d.deserializeU64(),
        newEpoch: d.deserializeU64(),
        kind: d.deserializeU8(),
        authKey: d.deserializeBytes(),
        threshold: d.deserializeU8(),
        ownerCount: d.deserializeU32(),
        ownersDigest: d.deserializeBytes(),
        opKind: d.deserializeU8(),
        executor: readAddress(d),
    };
}

/** Emitted when an account under a policy executes a gated payload. */
export interface MultisigOperationExecutedEvent {
    /** The account the payload executed as, not the owner who submitted it. */
    account: AccountAddress;
    /**
     * The replay key the owners signed. The chain records it as spent, so the
     * same approved operation cannot be handed in twice.
     */
    opId: Uint8Array;
    /** Which payload ran ({@link GatedPayloadVariant}). */
    payloadKind: number;
    /** The authority epoch the approvals were counted against. */
    authorityEpoch: bigint;
    /** Which owner submitted it. */
    executor: AccountAddress;
    /** Approvals counted. */
    signatureCount: number;
}

export function decodeMultisigOperationExecutedEvent(
    data: Uint8Array,
): MultisigOperationExecutedEvent {
    const d = new Deserializer(data);
    return {
        account: readAddress(d),
        opId: d.deserializeBytes(),
        payloadKind: d.deserializeU8(),
        authorityEpoch: d.deserializeU64(),
        executor: readAddress(d),
        signatureCount: d.deserializeU8(),
    };
}

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { AccountAddress } from "../core/accountAddress";
import { AccountAuthenticatorSingleKey } from "./authenticator";
import { RawTransaction, SimpleTransaction } from "./rawTransaction";
import {
    AdjustIsolatedMargin,
    RegisterReferralCode,
    ClaimReferralRewards,
    AgentApprove,
    AgentRevoke,
    AccountTransferItem,
    BridgeProof,
    BridgeSignature,
    ChangeMarginMode,
    ChangePositionMode,
    CreateSubAccount,
    CrossTransferItem,
    DexAgentTx,
    DexOrderlessTx,
    DexCancelOrder,
    DexConditionReplaceOrder,
    DexOrders,
    DexPlaceOrder,
    DexPlaceOrders,
    DexReplaceOrder,
    DexTransferTx,
    DexTx,
    DexUserConfigTx,
    InternalTransferItem,
    isCrossTransferOrderlessPayload,
    ModifySubAccount,
    SetUserLeverage,
    SymbolMarginMode,
    TransactionPayloadDexOrderless,
    UserSymbolLeverage,
} from "./dexPayloads";
import {
    SubaccountId,
    SymbolAccountsEntry,
    ClpTraderAllowlistEntry,
    VaultTx,
    VaultCreateTx,
    VaultDepositTx,
    VaultWithdrawTx,
    VaultDistributeTx,
    VaultClpConfigTx,
    VaultClpManagedAccountTx,
    VaultClpTraderAllowlistUpdateTx,
    VaultClpBatchCreateManagedAccountsTx,
    VaultSetParamsTx,
    VaultSetStatusTx,
} from "./vaultPayloads";
import {
    AccountType,
    AgentOperationVariant,
    ClpTraderAllowlistAction,
    ConditionType,
    CrossTransferOption,
    DexOrderlessTxVariant,
    DexOrdersVariant,
    DexTransferVariant,
    DexUserConfigTxVariant,
    ManagedAccountAction,
    MarginMode,
    OrderBasicType,
    OrderPositionMode,
    Side,
    StpMode,
    SymbolType,
    TimeInForce,
    TriggerPriceType,
    GatedPayloadVariant,
    VaultStatus,
    VaultTxVariant,
} from "../types/enums";
import {
    DexMultisigTx,
    GatedPayload,
    KeyProof,
    KeyProofEd25519,
    KeyProofSecp256k1,
    MultisigOpCreate,
    MultisigOpExecute,
    MultisigOpInstall,
    MultisigOpRemove,
    MultisigOpRotateKey,
    MultisigOpUpdatePolicy,
    submitOperationName,
} from "./multisigPayloads";
import type { EvmSignature } from "./multisigPayloads";

export interface SubmitTransactionRequestJson {
    sender: string;
    sequence_number: string;
    max_gas_amount: string;
    gas_unit_price: string;
    expiration_timestamp_secs: string;
    payload: SubmitTransactionPayloadJson;
    signature: Secp256k1EcdsaSignatureJson;
    replay_protection_nonce: string | null;
}

export type SubmitTransactionPayloadJson = DexOrderlessPayloadJson;

export type DexOrderlessPayloadJson =
    | DexPayloadJson
    | DexNoopPayloadJson
    | DexAgentPayloadJson
    | DexTransferPayloadJson
    | DexUserConfigPayloadJson
    | VaultPayloadJson;

/**
 * A noop: the nonce it consumes and nothing else.
 *
 * It has its own shape because the node's noop payload type declares no orders field, so a noop
 * cannot reuse {@link DexPayloadJson}, whose `orders` is required.
 */
export interface DexNoopPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_payload";
    operation: "noop";
    nonce: string;
    created_by: number;
    on_behalf_of?: string;
}

export interface DexPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_payload";
    operation: "place" | "cancel" | "replace" | "replace_maker_only" | "replace_condition";
    nonce: string;
    orders:
        | DexPlaceOrderJson[]
        | DexCancelOrderJson[]
        | DexReplaceOrderJson[]
        | DexConditionReplaceOrderJson[];
    order_groups?: DexPlaceOrderGroupJson[];
    created_by: number;
    on_behalf_of?: string;
}

export interface DexPlaceOrderGroupJson {
    grouping: number;
    orders: DexPlaceOrderJson[];
}

export type DexAgentPayloadJson =
    | DexAgentApprovePayloadJson
    | DexAgentRevokePayloadJson
    | DexAgentRevokeAllPayloadJson;

export interface DexAgentApprovePayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_agent_payload";
    agent_operation: "approve";
    nonce: string;
    name: string;
    agent_address: string;
    expiry_timestamp: string;
}

export interface DexAgentRevokePayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_agent_payload";
    agent_operation: "revoke";
    nonce: string;
    name: string;
}

/**
 * Revoke every grant. Carries a nonce and nothing else.
 *
 * Its own discriminator rather than a `revoke` with an empty name: the chain
 * answers that shape with `DexAgentNotFound`, an error about the target of a
 * request that was actually shaped wrong.
 */
export interface DexAgentRevokeAllPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_agent_payload";
    agent_operation: "revoke_all";
    nonce: string;
}

export type DexTransferPayloadJson =
    | DexTransferInternalTransferPayloadJson
    | DexTransferAccountTransferPayloadJson
    | DexTransferCrossTransferPayloadJson
    | DexTransferFaucetMintPayloadJson
    | DexClaimReferralRewardsPayloadJson;

export interface DexClaimReferralRewardsPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_transfer_payload";
    transfer_type: "claim_referral_rewards";
    nonce: string;
    on_behalf_of?: string;
}

export interface DexTransferInternalTransferPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_transfer_payload";
    transfer_type: "internal_transfer";
    nonce: string;
    transfers: DexInternalTransferItemJson[];
}

export interface DexInternalTransferItemJson {
    from_subaccount: string;
    to_subaccount: string;
    asset_id: number;
    amount: string;
    account_type: AccountTypeJson;
}

export interface DexTransferAccountTransferPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_transfer_payload";
    transfer_type: "account_transfer";
    nonce: string;
    transfers: DexAccountTransferItemJson[];
}

export interface DexAccountTransferItemJson {
    to_account: string;
    asset_id: number;
    amount: string;
    account_type: AccountTypeJson;
}

export interface DexTransferCrossTransferPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_transfer_payload";
    transfer_type: "cross_transfer";
    nonce: string;
    option: CrossTransferOptionJson;
    transfers: DexCrossTransferItemJson[];
    bridge_proof?: DexBridgeProofJson;
}

export interface DexBridgeSignatureJson {
    r: string;
    s: string;
    v: number;
}

export interface DexBridgeProofJson {
    msg_id: string;
    signer_epoch: string;
    signatures: DexBridgeSignatureJson[];
}

export interface DexCrossTransferItemJson {
    to_account: string;
    asset_id: number;
    amount: string;
    account_type: AccountTypeJson;
}

export interface DexTransferFaucetMintPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_transfer_payload";
    transfer_type: "faucet_mint";
    nonce: string;
    transfers: DexCrossTransferItemJson[];
}

export type DexUserConfigPayloadJson =
    | DexUserConfigSetUserLeveragePayloadJson
    | DexUserConfigChangePositionModePayloadJson
    | DexUserConfigChangeMarginModePayloadJson
    | DexUserConfigCreateSubAccountPayloadJson
    | DexUserConfigModifySubAccountPayloadJson
    | DexUserConfigAdjustIsolatedMarginPayloadJson
    | DexReferralCodePayloadJson;

export interface DexReferralCodePayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_user_config_payload";
    user_config_type: "register_referral_code" | "bind_referrer";
    nonce: string;
    code: string;
}

export interface DexUserLeverageInfoJson {
    symbol_id: number;
    tier: number;
    min_notional: string;
    max_notional: string;
    im_leverage: number;
    mm_leverage: number;
    exponent: number;
    maintenance_deduction: string;
}

export interface DexUserConfigSetUserLeveragePayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_user_config_payload";
    user_config_type: "set_user_leverage";
    nonce: string;
    sub_address: string;
    leverage_info: DexUserLeverageInfoJson[];
    on_behalf_of?: string;
}

export interface DexUserConfigChangePositionModePayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_user_config_payload";
    user_config_type: "change_position_mode";
    nonce: string;
    sub_address: string;
    position_mode: number;
    on_behalf_of?: string;
}

export interface DexUserConfigSymbolMarginModeJson {
    symbol_id: number;
    margin_mode: number;
}

export interface DexUserConfigChangeMarginModePayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_user_config_payload";
    user_config_type: "change_margin_mode";
    nonce: string;
    sub_address: string;
    margin_modes: DexUserConfigSymbolMarginModeJson[];
    on_behalf_of?: string;
}

export interface DexUserConfigCreateSubAccountPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_user_config_payload";
    user_config_type: "create_sub_account";
    nonce: string;
    name: string;
}

export interface DexUserConfigModifySubAccountPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_user_config_payload";
    user_config_type: "modify_sub_account";
    nonce: string;
    name: string;
    sub_address: string;
    on_behalf_of?: string;
}

export interface DexUserConfigAdjustIsolatedMarginPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "dex_user_config_payload";
    user_config_type: "adjust_isolated_margin";
    nonce: string;
    sub_address: string;
    symbol_id: number;
    delta_long: number;
    delta_short: number;
    on_behalf_of?: string;
}

export type VaultManagedAccountActionJson = "upsert" | "disable" | "remove";
export type VaultAllowlistActionJson = "add" | "remove";
export type VaultStatusJson = "active" | "paused" | "closed";

export interface VaultSubaccountIdJson {
    address: string;
    number: number;
    sub_address: string;
}

export interface VaultSymbolAccountsEntryJson {
    symbol_id: number;
    accounts: VaultSubaccountIdJson[];
}

export interface VaultClpTraderAllowlistEntryJson {
    clp_account: VaultSubaccountIdJson;
    traders: string[];
}

export type VaultPayloadJson =
    | VaultCreatePayloadJson
    | VaultDepositPayloadJson
    | VaultWithdrawPayloadJson
    | VaultDistributePayloadJson
    | VaultClpConfigPayloadJson
    | VaultClpManagedAccountPayloadJson
    | VaultClpTraderAllowlistUpdatePayloadJson
    | VaultClpBatchCreateManagedAccountsPayloadJson
    | VaultSetParamsPayloadJson
    | VaultSetStatusPayloadJson;

export interface VaultCreatePayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "create";
    nonce: string;
    lockup_seconds: number;
    always_proportional_close: boolean;
    initial_deposit_usdc: string;
    vault_name: string;
    strategy_description: string;
}

export interface VaultDepositPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "deposit";
    vault_id: string;
    nonce: string;
    amount_usdc: string;
}

export interface VaultWithdrawPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "withdraw";
    vault_id: string;
    nonce: string;
    withdraw_shares: string;
}

export interface VaultDistributePayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "distribute";
    vault_id: string;
    nonce: string;
    distribute_amount_usdc: string;
}

export interface VaultClpConfigPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "clp_config";
    nonce: string;
    bootstrap: boolean;
    primary_account?: VaultSubaccountIdJson;
    symbol_accounts?: VaultSymbolAccountsEntryJson[];
    allowlist?: VaultClpTraderAllowlistEntryJson[];
}

export interface VaultClpManagedAccountPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "clp_managed_account";
    nonce: string;
    account: VaultSubaccountIdJson;
    action: VaultManagedAccountActionJson;
    memo?: string;
}

export interface VaultClpTraderAllowlistUpdatePayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "clp_trader_allowlist_update";
    nonce: string;
    clp_account: VaultSubaccountIdJson;
    action: VaultAllowlistActionJson;
    traders: string[];
}

export interface VaultClpBatchCreateManagedAccountsPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "clp_batch_create_managed_accounts";
    nonce: string;
    address: string;
    start_number: number;
    count: number;
    user_name_prefix: string;
    memo: string;
}

export interface VaultSetParamsPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "set_params";
    nonce: string;
    vault_id: string;
    daily_withdraw_limit_bps?: number;
    min_free_balance_ratio_bps?: number;
    lockup_seconds?: number;
    always_proportional_close?: boolean;
}

export interface VaultSetStatusPayloadJson {
    type: "dex_orderless_payload";
    dex_type: "vault_payload";
    vault_type: "set_status";
    nonce: string;
    vault_id: string;
    target_status: VaultStatusJson;
}

export type AccountTypeJson = "perp" | "spot";
export type CrossTransferOptionJson = "mint" | "burn";

export interface DexPlaceOrderJson {
    sub_address: string;
    symbol_id: number;
    symbol_type: number;
    side: number;
    quantums: string;
    subticks: string;
    trigger_subticks: string;
    order_basic_type: number;
    time_in_force: number;
    condition_type: number;
    trigger_price_type: number;
    target_order_id: string;
    reduce_only: boolean;
    position_mode: number;
    slippage_tolerance_ppm: number;
    grouping: number;
    client_order_id?: string;
    stp_mode: number;
}

export type DexOrderTargetJson =
    | {
          target_type: "order_id";
          target_order_id: string;
      }
    | {
          target_type: "client_order_id";
          client_order_id: string;
      }
    | {
          target_type: "order_id_with_context";
          target_order_id: string;
          symbol_id: number;
          symbol_type: number;
      };

export type DexCancelTargetJson = DexOrderTargetJson;
export type DexReplaceTargetJson = DexOrderTargetJson;

export interface DexCancelOrderJson {
    sub_address: string;
    target: DexCancelTargetJson;
    symbol_type: number;
}

export interface DexReplaceOrderJson {
    sub_address: string;
    target: DexReplaceTargetJson;
    quantums?: string;
    subticks?: string;
    new_client_order_id?: string;
}

export interface DexConditionReplaceOrderJson {
    sub_address: string;
    target: DexReplaceTargetJson;
    quantums: string;
    subticks: string;
    trigger_subticks: string;
    order_basic_type: number;
    condition_type: number;
    trigger_price_type: number;
    new_client_order_id?: string;
}

export interface Secp256k1EcdsaSignatureJson {
    type: "secp256k1_ecdsa_signature";
    public_key: string;
    signature: string;
}

export class UnsupportedJsonPayloadError extends Error {
    constructor(payloadDescription: string) {
        super(
            `JSON submit request does not support ${payloadDescription}; submit this transaction with BCS`,
        );
        this.name = "UnsupportedJsonPayloadError";
    }
}

export function generateSubmitTransactionRequest(args: {
    transaction: SimpleTransaction | RawTransaction;
    senderAuthenticator: AccountAuthenticatorSingleKey;
}): SubmitTransactionRequestJson {
    const rawTransaction =
        args.transaction instanceof SimpleTransaction
            ? args.transaction.rawTransaction
            : args.transaction;

    return {
        sender: rawTransaction.sender.toString(),
        sequence_number: rawTransaction.sequence_number.toString(),
        max_gas_amount: rawTransaction.max_gas_amount.toString(),
        gas_unit_price: rawTransaction.gas_unit_price.toString(),
        expiration_timestamp_secs:
            rawTransaction.expiration_timestamp_secs.toString(),
        payload: renderPayload(rawTransaction.payload),
        signature: renderSecp256k1Signature(args.senderAuthenticator),
        replay_protection_nonce: replayProtectionNonce(rawTransaction),
    };
}

function renderPayload(payload: RawTransaction["payload"]): SubmitTransactionPayloadJson {
    if (payload instanceof TransactionPayloadDexOrderless) {
        return renderDexOrderlessPayload(payload.dexOrderlessTx);
    }

    throw unsupportedJsonPayload("non-Dex orderless payloads");
}

/**
 * A multisig transaction in the shape the node accepts on submission.
 *
 * One payload has two shapes and they are not interchangeable. What the chain
 * *renders* is a summary -- the operation as a name, the approvals as a count --
 * because that is what an explorer needs. What a caller *submits* has to say
 * exactly what is being authorized and carry the approvals, which is what this
 * builds: `op` in full, `proof` beside it.
 *
 * Field drift is not a formatting problem here. The owners signed
 * `keccak256(BCS(op))`, and the node recomputes it from the value it rebuilds
 * out of this JSON -- so a field left out or renamed changes that value, which
 * changes the operation id, and the chain reports a proof naming a different
 * operation rather than a parse error. Everything the operation carries is
 * rendered; nothing is abbreviated.
 */
function renderMultisigPayload(tx: DexMultisigTx): DexOrderlessPayloadJson {
    const op = tx.op;
    let renderedOp: Record<string, unknown>;

    if (op instanceof MultisigOpCreate) {
        renderedOp = {
            operation: "create_policy",
            owners: op.owners.map(renderOwner),
            threshold: op.threshold,
            salt: hexOf(op.salt),
        };
    } else if (op instanceof MultisigOpInstall) {
        renderedOp = {
            operation: "install_policy",
            owners: op.owners.map(renderOwner),
            threshold: op.threshold,
        };
    } else if (op instanceof MultisigOpUpdatePolicy) {
        renderedOp = {
            operation: "update_policy",
            owners: op.owners.map(renderOwner),
            threshold: op.threshold,
        };
    } else if (op instanceof MultisigOpRemove) {
        renderedOp = {
            operation: "remove_policy",
            new_auth_key: hexOf(op.newAuthKey),
            new_key_proof: renderKeyProof(op.newKeyProof),
        };
    } else if (op instanceof MultisigOpRotateKey) {
        renderedOp = {
            operation: "rotate_key",
            new_auth_key: hexOf(op.newAuthKey),
            new_key_proof: renderKeyProof(op.newKeyProof),
        };
    } else if (op instanceof MultisigOpExecute) {
        // The inner payload keeps its own `dex_type` but loses the outer
        // `type`: it is the operation being authorized, not a transaction of
        // its own, and a nested `dex_orderless_payload` would read as one.
        const { type: _outerType, ...inner } = renderGatedPayload(op.payload);
        renderedOp = { operation: "execute", ...inner };
    } else {
        throw unsupportedJsonPayload("this multisig operation");
    }

    const payload: Record<string, unknown> = {
        type: "dex_orderless_payload",
        dex_type: "multisig_payload",
        nonce: tx.nonce.toString(),
        account: tx.account.toString(),
        // The summary fields stay in the body: the node ignores them on
        // submission, and dropping them would make a submitted payload and a
        // rendered one two shapes rather than one with two halves.
        operation: submitOperationName(op),
        signatures_count: tx.proof ? tx.proof.signatures.length : 0,
        op: renderedOp,
    };
    if (tx.proof) {
        payload.authority_epoch = tx.proof.authorityEpoch.toString();
        payload.expires_at_secs = tx.proof.expiresAtSecs.toString();
        payload.proof = {
            op_id: hexOf(tx.proof.opId),
            authority_epoch: tx.proof.authorityEpoch.toString(),
            expires_at_secs: tx.proof.expiresAtSecs.toString(),
            signatures: tx.proof.signatures.map(renderEvmSignature),
        };
    }
    return payload as unknown as DexOrderlessPayloadJson;
}

/**
 * The inner operation, in the same shape a single key submits it with.
 *
 * A gated payload is a wrapper around the unchanged transaction type, so the
 * variant decides and the inner value goes to the same function that renders it
 * on its own. Matching on the wrapper's own class would be matching on the
 * envelope, which is a different value every time.
 */
function renderGatedPayload(payload: GatedPayload): Record<string, unknown> {
    switch (payload.variant) {
        case GatedPayloadVariant.DexTransfer:
            return renderDexTransferPayload(
                payload.inner as DexTransferTx,
            ) as unknown as Record<string, unknown>;
        case GatedPayloadVariant.Vault:
            return renderVaultPayload(
                payload.inner as VaultTx,
            ) as unknown as Record<string, unknown>;
        case GatedPayloadVariant.DexAgent:
            return renderDexAgentPayload(
                payload.inner as DexAgentTx,
            ) as unknown as Record<string, unknown>;
        case GatedPayloadVariant.CreateSubAccount:
            // The chain's gated arm is the create-subaccount transaction itself,
            // while the JSON shape is the user-config union it belongs to.
            // Wrapping it back into that union is what keeps the field names
            // from drifting: the union's discriminator is `user_config_type`,
            // and spelling it by hand here once got it wrong.
            return renderDexUserConfigPayload(
                new DexUserConfigTx(
                    DexUserConfigTxVariant.CreateSubAccount,
                    payload.inner as CreateSubAccount,
                ),
            ) as unknown as Record<string, unknown>;
        default:
            throw unsupportedJsonPayload("this gated payload");
    }
}

/** The incoming key's challenge answer. */
function renderKeyProof(proof: KeyProof): Record<string, unknown> {
    if (proof instanceof KeyProofSecp256k1) {
        return { scheme: "secp256k1", signature: renderEvmSignature(proof.signature) };
    }
    if (proof instanceof KeyProofEd25519) {
        return {
            scheme: "ed25519",
            public_key: hexOf(proof.publicKey),
            signature: hexOf(proof.signature),
        };
    }
    throw unsupportedJsonPayload("this key proof");
}

/**
 * One owner approval as sixty-five bytes of `r || s || v`.
 *
 * Not three fields: the node reads the compact form, and splitting it here
 * would be a second layout to keep in step with the one the owners signed.
 */
function renderEvmSignature(signature: EvmSignature): string {
    const raw = new Uint8Array(65);
    raw.set(signature.r, 0);
    raw.set(signature.s, 32);
    raw[64] = signature.v;
    return hexOf(raw);
}

/** An owner as the chain's padded address form. */
function renderOwner(owner: Uint8Array): string {
    if (owner.length === 32) {
        return hexOf(owner);
    }
    if (owner.length !== 20) {
        throw unsupportedJsonPayload("an owner must be 20 or 32 bytes");
    }
    const padded = new Uint8Array(32);
    padded.set(owner, 12);
    return hexOf(padded);
}

function hexOf(bytes: Uint8Array): string {
    return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function renderDexOrderlessPayload(
    dexOrderlessTx: DexOrderlessTx,
): DexOrderlessPayloadJson {
    if (
        dexOrderlessTx.variant === DexOrderlessTxVariant.DexTransfer &&
        dexOrderlessTx.inner instanceof DexTransferTx
    ) {
        return renderDexTransferPayload(dexOrderlessTx.inner);
    }

    if (
        dexOrderlessTx.variant === DexOrderlessTxVariant.DexAgent &&
        dexOrderlessTx.inner instanceof DexAgentTx
    ) {
        return renderDexAgentPayload(dexOrderlessTx.inner);
    }

    if (
        dexOrderlessTx.variant === DexOrderlessTxVariant.DexUserConfig &&
        dexOrderlessTx.inner instanceof DexUserConfigTx
    ) {
        return renderDexUserConfigPayload(dexOrderlessTx.inner);
    }

    if (
        dexOrderlessTx.variant === DexOrderlessTxVariant.Vault &&
        dexOrderlessTx.inner instanceof VaultTx
    ) {
        return renderVaultPayload(dexOrderlessTx.inner);
    }

    if (dexOrderlessTx.variant === DexOrderlessTxVariant.Multisig) {
        return renderMultisigPayload(dexOrderlessTx.inner as DexMultisigTx);
    }

    if (
        dexOrderlessTx.variant !== DexOrderlessTxVariant.Dex ||
        !(dexOrderlessTx.inner instanceof DexTx)
    ) {
        throw unsupportedJsonPayload(describeDexOrderlessPayload(dexOrderlessTx));
    }

    const dexTx = dexOrderlessTx.inner;
    if (!(dexTx.orders instanceof DexOrders)) {
        throw new Error("JSON submit request currently supports Dex place/cancel/replace orders only");
    }

    if (dexTx.orders.variant === DexOrdersVariant.Noop) {
        const noop: DexNoopPayloadJson = {
            type: "dex_orderless_payload",
            dex_type: "dex_payload",
            operation: "noop",
            nonce: dexTx.nonce.toString(),
            created_by: dexTx.created_by,
        };
        if (dexTx.onBehalfOf !== undefined) {
            noop.on_behalf_of = dexTx.onBehalfOf.toString();
        }
        return noop;
    }

    let operation: DexPayloadJson["operation"];
    let orders: DexPayloadJson["orders"];
    let orderGroups: DexPlaceOrderGroupJson[] | undefined;
    switch (dexTx.orders.variant) {
        case DexOrdersVariant.Place: {
            const placeOrderGroups = dexTx.orders.orders as DexPlaceOrders[];
            operation = "place";
            orders = renderPlaceOrders(placeOrderGroups);
            orderGroups = renderPlaceOrderGroups(placeOrderGroups);
            break;
        }
        case DexOrdersVariant.Cancel:
            operation = "cancel";
            orders = renderCancelOrders(dexTx.orders.orders as DexCancelOrder[]);
            break;
        case DexOrdersVariant.Replace:
            operation = "replace";
            orders = renderReplaceOrders(dexTx.orders.orders as DexReplaceOrder[]);
            break;
        case DexOrdersVariant.ReplaceMakerOnly:
            // Same orders as a replace; the operation name is what asks the node to hold the
            // replacement to maker-only entry rules.
            operation = "replace_maker_only";
            orders = renderReplaceOrders(dexTx.orders.orders as DexReplaceOrder[]);
            break;
        case DexOrdersVariant.ReplaceCondition:
            operation = "replace_condition";
            orders = renderConditionReplaceOrders(
                dexTx.orders.orders as DexConditionReplaceOrder[],
            );
            break;
    }

    const payload: DexPayloadJson =
        orderGroups === undefined
            ? {
                type: "dex_orderless_payload",
                dex_type: "dex_payload",
                operation,
                nonce: dexTx.nonce.toString(),
                orders,
                created_by: dexTx.created_by,
            }
            : {
                type: "dex_orderless_payload",
                dex_type: "dex_payload",
                operation,
                nonce: dexTx.nonce.toString(),
                orders,
                order_groups: orderGroups,
                created_by: dexTx.created_by,
            };

    if (dexTx.onBehalfOf !== undefined) {
        payload.on_behalf_of = dexTx.onBehalfOf.toString();
    }

    return payload;
}

function renderDexTransferPayload(
    transferTx: DexTransferTx,
): DexTransferPayloadJson {
    switch (transferTx.variant) {
        case DexTransferVariant.ClaimReferralRewards: {
            const claim = transferTx as ClaimReferralRewards;
            return {
                type: "dex_orderless_payload", dex_type: "dex_transfer_payload", transfer_type: "claim_referral_rewards",
                nonce: claim.nonce.toString(),
                ...(claim.onBehalfOf === undefined ? {} : { on_behalf_of: claim.onBehalfOf.toStringLong() }),
            };
        }
        case DexTransferVariant.InternalTransfer:
            return {
                type: "dex_orderless_payload",
                dex_type: "dex_transfer_payload",
                transfer_type: "internal_transfer",
                nonce: transferTx.nonce.toString(),
                transfers: (transferTx.payload as InternalTransferItem[]).map(
                    renderInternalTransferItem,
                ),
            };
        case DexTransferVariant.AccountTransfer:
            return {
                type: "dex_orderless_payload",
                dex_type: "dex_transfer_payload",
                transfer_type: "account_transfer",
                nonce: transferTx.nonce.toString(),
                transfers: (transferTx.payload as AccountTransferItem[]).map(
                    renderAccountTransferItem,
                ),
            };
        case DexTransferVariant.CrossTransfer: {
            const crossPayload: DexTransferCrossTransferPayloadJson = {
                type: "dex_orderless_payload",
                dex_type: "dex_transfer_payload",
                transfer_type: "cross_transfer",
                nonce: transferTx.nonce.toString(),
                option: renderCrossTransferOption(
                    transferTx.option as CrossTransferOption,
                ),
                transfers: (transferTx.payload as CrossTransferItem[]).map(
                    renderCrossTransferItem,
                ),
            };
            if (transferTx.bridgeProof !== undefined) {
                crossPayload.bridge_proof = renderBridgeProof(transferTx.bridgeProof);
            }
            return crossPayload;
        }
        case DexTransferVariant.FaucetMint:
            return {
                type: "dex_orderless_payload",
                dex_type: "dex_transfer_payload",
                transfer_type: "faucet_mint",
                nonce: transferTx.nonce.toString(),
                transfers: (transferTx.payload as CrossTransferItem[]).map(
                    renderCrossTransferItem,
                ),
            };
        default:
            throw unsupportedJsonPayload(describeDexTransferPayload(transferTx));
    }
}

function renderInternalTransferItem(
    item: InternalTransferItem,
): DexInternalTransferItemJson {
    return {
        from_subaccount: renderSubAddress(item.from_subaddress),
        to_subaccount: renderSubAddress(item.to_subaddress),
        asset_id: item.asset_id,
        amount: item.amount.toString(),
        account_type: renderAccountType(item.account_type),
    };
}

function renderAccountTransferItem(
    item: AccountTransferItem,
): DexAccountTransferItemJson {
    return {
        to_account: item.to_account.toStringLong(),
        asset_id: item.asset_id,
        amount: item.amount.toString(),
        account_type: renderAccountType(item.account_type),
    };
}

function renderCrossTransferItem(
    item: CrossTransferItem,
): DexCrossTransferItemJson {
    return {
        to_account: item.to_account.toStringLong(),
        asset_id: item.asset_id,
        amount: item.amount.toString(),
        account_type: renderAccountType(item.account_type),
    };
}

function renderBridgeProof(proof: BridgeProof): DexBridgeProofJson {
    return {
        msg_id: renderFixed32Hex(proof.msgId, "bridge_proof msg_id"),
        signer_epoch: proof.signerEpoch.toString(),
        signatures: proof.signatures.map(renderBridgeSignature),
    };
}

function renderBridgeSignature(sig: BridgeSignature): DexBridgeSignatureJson {
    if (!Number.isInteger(sig.v) || sig.v < 0 || sig.v > 255) {
        throw new Error(`Invalid bridge_proof signature v: ${String(sig.v)}`);
    }
    return {
        r: renderFixed32Hex(sig.r, "bridge_proof signature r"),
        s: renderFixed32Hex(sig.s, "bridge_proof signature s"),
        v: sig.v,
    };
}

function renderFixed32Hex(bytes: Uint8Array, field: string): string {
    if (bytes.length !== 32) {
        throw new Error(
            `Invalid ${field} length: expected 32 bytes, got ${bytes.length}`,
        );
    }
    return hex(bytes);
}

function renderDexAgentPayload(agentTx: DexAgentTx): DexAgentPayloadJson {
    switch (agentTx.variant) {
        case AgentOperationVariant.Approve:
            if (!(agentTx.operation instanceof AgentApprove)) {
                throw new Error("DexAgent approve transaction must contain AgentApprove operation");
            }
            return {
                type: "dex_orderless_payload",
                dex_type: "dex_agent_payload",
                agent_operation: "approve",
                nonce: agentTx.nonce.toString(),
                name: agentTx.operation.name,
                agent_address: agentTx.operation.agentAddress.toStringLong(),
                expiry_timestamp: agentTx.operation.expiryTimestamp.toString(),
            };
        case AgentOperationVariant.Revoke:
            if (!(agentTx.operation instanceof AgentRevoke)) {
                throw new Error("DexAgent revoke transaction must contain AgentRevoke operation");
            }
            return {
                type: "dex_orderless_payload",
                dex_type: "dex_agent_payload",
                agent_operation: "revoke",
                nonce: agentTx.nonce.toString(),
                name: agentTx.operation.name,
            };
        case AgentOperationVariant.RevokeAll:
            return {
                type: "dex_orderless_payload",
                dex_type: "dex_agent_payload",
                agent_operation: "revoke_all",
                nonce: agentTx.nonce.toString(),
            };
    }
}

function renderDexUserConfigPayload(
    userConfigTx: DexUserConfigTx,
): DexUserConfigPayloadJson {
    switch (userConfigTx.variant) {
        case DexUserConfigTxVariant.SetUserLeverage: {
            const config = userConfigTx.payload as SetUserLeverage;
            const payload: DexUserConfigSetUserLeveragePayloadJson = {
                type: "dex_orderless_payload",
                dex_type: "dex_user_config_payload",
                user_config_type: "set_user_leverage",
                nonce: config.nonce.toString(),
                sub_address: renderSubAddress(config.subAddress),
                leverage_info: config.leverageInfo.map(renderUserSymbolLeverage),
            };
            if (config.onBehalfOf !== undefined) {
                payload.on_behalf_of = config.onBehalfOf.toStringLong();
            }
            return payload;
        }
        case DexUserConfigTxVariant.ChangePositionMode: {
            const config = userConfigTx.payload as ChangePositionMode;
            const payload: DexUserConfigChangePositionModePayloadJson = {
                type: "dex_orderless_payload",
                dex_type: "dex_user_config_payload",
                user_config_type: "change_position_mode",
                nonce: config.nonce.toString(),
                sub_address: renderSubAddress(config.subAddress),
                position_mode: renderPositionMode(config.positionMode),
            };
            if (config.onBehalfOf !== undefined) {
                payload.on_behalf_of = config.onBehalfOf.toStringLong();
            }
            return payload;
        }
        case DexUserConfigTxVariant.ChangeMarginMode: {
            const config = userConfigTx.payload as ChangeMarginMode;
            const payload: DexUserConfigChangeMarginModePayloadJson = {
                type: "dex_orderless_payload",
                dex_type: "dex_user_config_payload",
                user_config_type: "change_margin_mode",
                nonce: config.nonce.toString(),
                sub_address: renderSubAddress(config.subAddress),
                margin_modes: config.marginModes.map(renderSymbolMarginMode),
            };
            if (config.onBehalfOf !== undefined) {
                payload.on_behalf_of = config.onBehalfOf.toStringLong();
            }
            return payload;
        }
        case DexUserConfigTxVariant.CreateSubAccount: {
            const config = userConfigTx.payload as CreateSubAccount;
            return {
                type: "dex_orderless_payload",
                dex_type: "dex_user_config_payload",
                user_config_type: "create_sub_account",
                nonce: config.nonce.toString(),
                name: config.name,
            };
        }
        case DexUserConfigTxVariant.ModifySubAccount: {
            const config = userConfigTx.payload as ModifySubAccount;
            const payload: DexUserConfigModifySubAccountPayloadJson = {
                type: "dex_orderless_payload",
                dex_type: "dex_user_config_payload",
                user_config_type: "modify_sub_account",
                nonce: config.nonce.toString(),
                name: config.name,
                sub_address: renderSubAddress(config.subAddress),
            };
            if (config.onBehalfOf !== undefined) {
                payload.on_behalf_of = config.onBehalfOf.toStringLong();
            }
            return payload;
        }
        case DexUserConfigTxVariant.AdjustIsolatedMargin: {
            const config = userConfigTx.payload as AdjustIsolatedMargin;
            const payload: DexUserConfigAdjustIsolatedMarginPayloadJson = {
                type: "dex_orderless_payload",
                dex_type: "dex_user_config_payload",
                user_config_type: "adjust_isolated_margin",
                nonce: config.nonce.toString(),
                sub_address: renderSubAddress(config.subAddress),
                symbol_id: config.symbolId,
                delta_long: Number(config.deltaLong),
                delta_short: Number(config.deltaShort),
            };
            if (config.onBehalfOf !== undefined) {
                payload.on_behalf_of = config.onBehalfOf.toStringLong();
            }
            return payload;
        }
        case DexUserConfigTxVariant.RegisterReferralCode:
        case DexUserConfigTxVariant.BindReferrer: {
            const code = userConfigTx.payload as RegisterReferralCode;
            return {
                type: "dex_orderless_payload", dex_type: "dex_user_config_payload",
                user_config_type: userConfigTx.variant === DexUserConfigTxVariant.RegisterReferralCode ? "register_referral_code" : "bind_referrer",
                nonce: code.nonce.toString(), code: code.code,
            };
        }
        default:
            throw unsupportedJsonPayload(describeDexUserConfigPayload(userConfigTx));
    }
}

/**
 * Render a single user leverage entry.
 *
 * Mirrors the chain's `From<SymbolLeverage> for LeverageInfoPayload`: only
 * `symbol_id` / `im_leverage` / `exponent` carry meaning for user leverage, so
 * the tier / notional / mm_leverage / maintenance fields are emitted as the same
 * placeholders the chain ignores in `TryFrom<LeverageInfoPayload>`. `im_leverage`
 * and `exponent` come from the BCS-serialized values so JSON and BCS submission
 * describe an identical `SymbolLeverage`.
 */
function renderUserSymbolLeverage(
    leverage: UserSymbolLeverage,
): DexUserLeverageInfoJson {
    return {
        symbol_id: leverage.symbolId,
        tier: 0,
        min_notional: "0",
        max_notional: "0",
        im_leverage: leverage.imLeverage,
        mm_leverage: 0,
        exponent: leverage.exponent,
        maintenance_deduction: "0",
    };
}

function renderSymbolMarginMode(
    marginMode: SymbolMarginMode,
): DexUserConfigSymbolMarginModeJson {
    return {
        symbol_id: marginMode.symbolId,
        margin_mode: renderMarginMode(marginMode.marginMode),
    };
}

function renderPositionMode(positionMode: OrderPositionMode): number {
    return validateEnumValue("position_mode", positionMode, [
        OrderPositionMode.Net,
        OrderPositionMode.Hedge,
    ]);
}

function renderMarginMode(marginMode: MarginMode): number {
    return validateEnumValue("margin_mode", marginMode, [
        MarginMode.Cross,
        MarginMode.Isolated,
        MarginMode.Portfolio,
    ]);
}

function describeDexUserConfigPayload(userConfigTx: DexUserConfigTx): string {
    switch (userConfigTx.variant) {
        case DexUserConfigTxVariant.SetUserLeverage:
            return "DexUserConfig set_user_leverage payloads";
        case DexUserConfigTxVariant.ChangePositionMode:
            return "DexUserConfig change_position_mode payloads";
        case DexUserConfigTxVariant.ChangeMarginMode:
            return "DexUserConfig change_margin_mode payloads";
        case DexUserConfigTxVariant.CreateSubAccount:
            return "DexUserConfig create_sub_account payloads";
        case DexUserConfigTxVariant.ModifySubAccount:
            return "DexUserConfig modify_sub_account payloads";
        case DexUserConfigTxVariant.AdjustIsolatedMargin:
            return "DexUserConfig adjust_isolated_margin payloads";
        default:
            return "DexUserConfig payloads (unknown variant)";
    }
}

function renderVaultPayload(vaultTx: VaultTx): VaultPayloadJson {
    switch (vaultTx.variant) {
        case VaultTxVariant.Create: {
            const v = vaultTx.inner as VaultCreateTx;
            return {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "create",
                nonce: v.nonce.toString(),
                lockup_seconds: v.lockup_seconds,
                always_proportional_close: v.always_proportional_close,
                initial_deposit_usdc: v.initial_deposit_usdc.toString(),
                vault_name: v.vault_name,
                strategy_description: v.strategy_description,
            };
        }
        case VaultTxVariant.Deposit: {
            const v = vaultTx.inner as VaultDepositTx;
            return {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "deposit",
                vault_id: v.vault_id.toString(),
                nonce: v.nonce.toString(),
                amount_usdc: v.amount_usdc.toString(),
            };
        }
        case VaultTxVariant.Withdraw: {
            const v = vaultTx.inner as VaultWithdrawTx;
            return {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "withdraw",
                vault_id: v.vault_id.toString(),
                nonce: v.nonce.toString(),
                withdraw_shares: v.withdraw_shares.toString(),
            };
        }
        case VaultTxVariant.Distribute: {
            const v = vaultTx.inner as VaultDistributeTx;
            return {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "distribute",
                vault_id: v.vault_id.toString(),
                nonce: v.nonce.toString(),
                distribute_amount_usdc: v.distribute_amount_usdc.toString(),
            };
        }
        case VaultTxVariant.ClpConfig: {
            const v = vaultTx.inner as VaultClpConfigTx;
            const payload: VaultClpConfigPayloadJson = {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "clp_config",
                nonce: v.nonce.toString(),
                bootstrap: v.bootstrap,
            };
            if (v.primary_account !== undefined) {
                payload.primary_account = renderVaultSubaccountId(v.primary_account);
            }
            if (v.symbol_accounts !== undefined) {
                payload.symbol_accounts = v.symbol_accounts.map(renderVaultSymbolAccountsEntry);
            }
            if (v.allowlist !== undefined) {
                payload.allowlist = v.allowlist.map(renderVaultClpTraderAllowlistEntry);
            }
            return payload;
        }
        case VaultTxVariant.ClpManagedAccount: {
            const v = vaultTx.inner as VaultClpManagedAccountTx;
            const payload: VaultClpManagedAccountPayloadJson = {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "clp_managed_account",
                nonce: v.nonce.toString(),
                account: renderVaultSubaccountId(v.account),
                action: renderManagedAccountAction(v.action),
            };
            if (v.memo !== undefined) {
                payload.memo = v.memo;
            }
            return payload;
        }
        case VaultTxVariant.ClpTraderAllowlistUpdate: {
            const v = vaultTx.inner as VaultClpTraderAllowlistUpdateTx;
            return {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "clp_trader_allowlist_update",
                nonce: v.nonce.toString(),
                clp_account: renderVaultSubaccountId(v.clp_account),
                action: renderAllowlistAction(v.action),
                traders: v.traders.map((trader) => trader.toStringLong()),
            };
        }
        case VaultTxVariant.ClpBatchCreateManagedAccounts: {
            const v = vaultTx.inner as VaultClpBatchCreateManagedAccountsTx;
            return {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "clp_batch_create_managed_accounts",
                nonce: v.nonce.toString(),
                address: v.address.toStringLong(),
                start_number: v.start_number,
                count: v.count,
                user_name_prefix: v.user_name_prefix,
                memo: v.memo,
            };
        }
        case VaultTxVariant.SetParams: {
            const v = vaultTx.inner as VaultSetParamsTx;
            const payload: VaultSetParamsPayloadJson = {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "set_params",
                nonce: v.nonce.toString(),
                vault_id: v.vault_id.toString(),
            };
            if (v.daily_withdraw_limit_bps !== undefined) {
                payload.daily_withdraw_limit_bps = v.daily_withdraw_limit_bps;
            }
            if (v.min_free_balance_ratio_bps !== undefined) {
                payload.min_free_balance_ratio_bps = v.min_free_balance_ratio_bps;
            }
            if (v.lockup_seconds !== undefined) {
                payload.lockup_seconds = v.lockup_seconds;
            }
            if (v.always_proportional_close !== undefined) {
                payload.always_proportional_close = v.always_proportional_close;
            }
            return payload;
        }
        case VaultTxVariant.SetStatus: {
            const v = vaultTx.inner as VaultSetStatusTx;
            return {
                type: "dex_orderless_payload",
                dex_type: "vault_payload",
                vault_type: "set_status",
                nonce: v.nonce.toString(),
                vault_id: v.vault_id.toString(),
                target_status: renderVaultStatus(v.target_status),
            };
        }
        default:
            throw unsupportedJsonPayload("Vault payloads (unknown variant)");
    }
}

function renderVaultSubaccountId(sub: SubaccountId): VaultSubaccountIdJson {
    return {
        address: hex(sub.address),
        number: sub.number,
        sub_address: hex(sub.sub_address),
    };
}

function renderVaultSymbolAccountsEntry(
    entry: SymbolAccountsEntry,
): VaultSymbolAccountsEntryJson {
    return {
        symbol_id: entry.symbol_id,
        accounts: entry.accounts.map(renderVaultSubaccountId),
    };
}

function renderVaultClpTraderAllowlistEntry(
    entry: ClpTraderAllowlistEntry,
): VaultClpTraderAllowlistEntryJson {
    return {
        clp_account: renderVaultSubaccountId(entry.clp_account),
        traders: entry.traders.map((trader) => trader.toStringLong()),
    };
}

function renderManagedAccountAction(
    action: ManagedAccountAction,
): VaultManagedAccountActionJson {
    switch (action) {
        case ManagedAccountAction.Upsert:
            return "upsert";
        case ManagedAccountAction.Disable:
            return "disable";
        case ManagedAccountAction.Remove:
            return "remove";
        default:
            throw new Error(`Invalid managed_account action: ${String(action)}`);
    }
}

function renderAllowlistAction(
    action: ClpTraderAllowlistAction,
): VaultAllowlistActionJson {
    switch (action) {
        case ClpTraderAllowlistAction.Add:
            return "add";
        case ClpTraderAllowlistAction.Remove:
            return "remove";
        default:
            throw new Error(`Invalid allowlist action: ${String(action)}`);
    }
}

function renderVaultStatus(status: VaultStatus): VaultStatusJson {
    switch (status) {
        case VaultStatus.Active:
            return "active";
        case VaultStatus.Paused:
            return "paused";
        case VaultStatus.Closed:
            return "closed";
        default:
            throw new Error(`Invalid target_status: ${String(status)}`);
    }
}

function unsupportedJsonPayload(payloadDescription: string): UnsupportedJsonPayloadError {
    return new UnsupportedJsonPayloadError(payloadDescription);
}

function describeDexOrderlessPayload(dexOrderlessTx: DexOrderlessTx): string {
    if (dexOrderlessTx.inner instanceof DexTransferTx) {
        return describeDexTransferPayload(dexOrderlessTx.inner);
    }

    switch (dexOrderlessTx.variant) {
        case DexOrderlessTxVariant.DexUserConfig:
            return "DexUserConfig payloads";
        case DexOrderlessTxVariant.DexSystemConfig:
            return "DexSystemConfig payloads";
        case DexOrderlessTxVariant.DexTransfer:
            return "DexTransfer payloads";
        case DexOrderlessTxVariant.DexAgent:
            return "DexAgent payloads";
        case DexOrderlessTxVariant.Vault:
            return "Vault payloads";
        default:
            return "this Dex orderless payload";
    }
}

function describeDexTransferPayload(transferTx: DexTransferTx): string {
    if (
        transferTx.variant === DexTransferVariant.CrossTransfer &&
        transferTx.bridgeProof !== undefined
    ) {
        return "DexTransfer cross-transfer payloads with bridge proof";
    }

    return "DexTransfer payloads";
}

function renderPlaceOrders(groups: DexPlaceOrders[]): DexPlaceOrderJson[] {
    return groups.flatMap((group) =>
        group.orders.map((order) => renderPlaceOrder(order, group.grouping)),
    );
}

function renderPlaceOrderGroups(
    groups: DexPlaceOrders[],
): DexPlaceOrderGroupJson[] {
    return groups.map((group) => ({
        grouping: group.grouping,
        orders: group.orders.map((order) => renderPlaceOrder(order, group.grouping)),
    }));
}

function renderPlaceOrder(order: DexPlaceOrder, grouping: number): DexPlaceOrderJson {
    const payload: DexPlaceOrderJson = {
        sub_address: renderSubAddress(order.subAddress),
        symbol_id: order.symbol_id,
        symbol_type: order.symbol_type,
        side: validateEnumValue("side", order.side, [
            Side.Unspecified,
            Side.Buy,
            Side.Sell,
            Side.CloseallLong,
            Side.CloseallShort,
        ]),
        quantums: order.quantums.toString(),
        subticks: order.subticks.toString(),
        trigger_subticks: order.trigger_subticks.toString(),
        order_basic_type: validateEnumValue("order_basic_type", order.order_basic_type, [
            OrderBasicType.Unspecified,
            OrderBasicType.Market,
            OrderBasicType.Limit,
        ]),
        time_in_force: validateEnumValue("time_in_force", order.time_in_force, [
            TimeInForce.Unspecified,
            TimeInForce.Ioc,
            TimeInForce.Fok,
            TimeInForce.Aon,
            TimeInForce.Gtc,
            TimeInForce.Alo,
            TimeInForce.Gtd,
            TimeInForce.Gtb,
        ]),
        condition_type: validateEnumValue("condition_type", order.condition_type, [
            ConditionType.Unspecified,
            ConditionType.StopLoss,
            ConditionType.TakeProfit,
        ]),
        trigger_price_type: validateEnumValue("trigger_price_type", order.trigger_price_type, [
            TriggerPriceType.LastPrice,
            TriggerPriceType.MarkPrice,
        ]),
        target_order_id: order.target_order_id.toString(),
        reduce_only: order.reduce_only,
        position_mode: validateEnumValue("position_mode", order.position_mode, [
            OrderPositionMode.Net,
            OrderPositionMode.Hedge,
        ]),
        slippage_tolerance_ppm: order.slippage_tolerance_ppm,
        grouping,
        stp_mode: validateEnumValue("stp_mode", order.stp_mode, [
            StpMode.ExpireTaker,
            StpMode.ExpireMaker,
            StpMode.ExpireBoth,
        ]),
    };

    if (order.client_order_id !== null && order.client_order_id !== undefined) {
        payload.client_order_id = order.client_order_id;
    }

    return payload;
}

function validateEnumValue<T extends number>(
    field: string,
    value: T,
    allowedValues: readonly T[],
): T {
    if (!Number.isInteger(value) || !allowedValues.includes(value)) {
        throw new Error(`Invalid ${field}: ${String(value)}`);
    }
    return value;
}

function renderCancelOrders(orders: DexCancelOrder[]): DexCancelOrderJson[] {
    return orders.map((order) => ({
        sub_address: renderSubAddress(order.subAddress),
        target: renderOrderTarget(order.target),
        symbol_type: order.symbol_type,
    }));
}

function renderReplaceOrders(orders: DexReplaceOrder[]): DexReplaceOrderJson[] {
    return orders.map((order) => {
        const payload: DexReplaceOrderJson = {
            sub_address: renderSubAddress(order.subAddress),
            target: renderOrderTarget(order.target),
        };

        if (order.quantums !== undefined) {
            payload.quantums = order.quantums.toString();
        }
        if (order.subticks !== undefined) {
            payload.subticks = order.subticks.toString();
        }
        if (order.new_client_order_id !== undefined) {
            payload.new_client_order_id = order.new_client_order_id;
        }

        return payload;
    });
}

function renderConditionReplaceOrders(
    orders: DexConditionReplaceOrder[],
): DexConditionReplaceOrderJson[] {
    return orders.map((order) => {
        const payload: DexConditionReplaceOrderJson = {
            sub_address: renderSubAddress(order.subAddress),
            target: renderOrderTarget(order.target),
            quantums: order.quantums.toString(),
            subticks: order.subticks.toString(),
            trigger_subticks: order.trigger_subticks.toString(),
            order_basic_type: validateEnumValue(
                "order_basic_type",
                order.order_basic_type,
                [OrderBasicType.Market, OrderBasicType.Limit],
            ),
            condition_type: validateEnumValue(
                "condition_type",
                order.condition_type,
                [ConditionType.StopLoss, ConditionType.TakeProfit],
            ),
            trigger_price_type: validateEnumValue(
                "trigger_price_type",
                order.trigger_price_type,
                [TriggerPriceType.LastPrice, TriggerPriceType.MarkPrice],
            ),
        };
        if (order.new_client_order_id !== undefined) {
            payload.new_client_order_id = order.new_client_order_id;
        }
        return payload;
    });
}

function renderOrderTarget(
    target:
        | DexCancelOrder["target"]
        | DexReplaceOrder["target"]
        | DexConditionReplaceOrder["target"],
): DexOrderTargetJson {
    switch (target.kind) {
        case "OrderId":
            return {
                target_type: "order_id",
                target_order_id: target.target_order_id.toString(),
            };
        case "ClientOrderId":
            return {
                target_type: "client_order_id",
                client_order_id: target.client_order_id,
            };
        case "OrderIdWithContext":
            return {
                target_type: "order_id_with_context",
                target_order_id: target.target_order_id.toString(),
                symbol_id: target.symbol_id,
                symbol_type: target.symbol_type,
            };
    }
}

function renderSubAddress(address: AccountAddress): string {
    if (address.equals(AccountAddress.ZERO)) return "0x0";
    return address.toStringLong();
}

function renderAccountType(accountType: AccountType): AccountTypeJson {
    switch (
        validateEnumValue("account_type", accountType, [
            AccountType.Perp,
            AccountType.Spot,
        ])
    ) {
        case AccountType.Perp:
            return "perp";
        case AccountType.Spot:
            return "spot";
    }
}

function renderCrossTransferOption(
    option: CrossTransferOption,
): CrossTransferOptionJson {
    switch (
        validateEnumValue("cross_transfer_option", option, [
            CrossTransferOption.Mint,
            CrossTransferOption.Burn,
        ])
    ) {
        case CrossTransferOption.Mint:
            return "mint";
        case CrossTransferOption.Burn:
            return "burn";
    }
}

function replayProtectionNonce(rawTransaction: RawTransaction): string | null {
    const payload = rawTransaction.payload;
    if (payload instanceof TransactionPayloadDexOrderless) {
        if (isCrossTransferOrderlessPayload(payload)) {
            return rawTransaction.sequence_number.toString();
        }
        return payload.dexOrderlessTx.nonce.toString();
    }

    return null;
}

function renderSecp256k1Signature(
    senderAuthenticator: AccountAuthenticatorSingleKey,
): Secp256k1EcdsaSignatureJson {
    return {
        type: "secp256k1_ecdsa_signature",
        public_key: hex(senderAuthenticator.public_key.publicKey.toUint8Array()),
        signature: hex(senderAuthenticator.signature.signature.data),
    };
}

function hex(bytes: Uint8Array): string {
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

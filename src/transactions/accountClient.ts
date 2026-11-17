// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * High-level subaccount, agent-wallet and DEX transfer APIs.
 *
 * AccountIntents only builds wire transactions and can be reused by wallet
 * adapters. AccountClient adds Account-based signing, submission and waiting.
 */

import { Account } from "../core/account";
import {
    AccountAddress,
    type AccountAddressInput,
} from "../core/accountAddress";
import type {
    DexOrderlessExecutionOptions,
    DexOrderlessExecutionResult,
    DexOrderlessSubmitOptions,
    Intention,
} from "../api/intention";
import type { PendingTransactionResponse } from "../api/client";
import {
    AccountTransferItem,
    AdjustIsolatedMargin,
    AgentApprove,
    AgentRevoke,
    BridgeProof,
    ChangeMarginMode,
    ChangePositionMode,
    CreateSubAccount,
    CrossTransferItem,
    DexAgentTx,
    DexOrderlessTx,
    DexTransferTx,
    DexUserConfigTx,
    InternalTransferItem,
    ModifySubAccount,
    SetUserLeverage,
    SymbolMarginMode,
    UserSymbolLeverage,
    type DexUserConfigTxPayload,
} from "./dexPayloads";
import {
    AccountType,
    AgentOperationVariant,
    CrossTransferOption,
    DexOrderlessTxVariant,
    DexTransferVariant,
    DexUserConfigTxVariant,
    MarginMode,
    OrderPositionMode,
} from "../types/enums";
import type { CreateSubAccountEvent } from "../events/events";
import { floorScaleToBigInt } from "./marketResolver";
import type { MarketResolver } from "./orderIntents";

export const MAX_SUBACCOUNT_NAME_BYTES = 16;
export const MAX_AGENT_NAME_BYTES = 20;
export const MAX_AGENT_EXPIRY_SECONDS = 15_552_000;
export const DEFAULT_AGENT_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const MAX_U32 = 0xffff_ffff;
const MAX_I32 = 0x7fff_ffff;
const MAX_I64 = 0x7fff_ffff_ffff_ffffn;

export interface AccountActionSubmitOptions extends DexOrderlessSubmitOptions {}

export interface AccountActionExecutionOptions extends DexOrderlessExecutionOptions {}

export interface AccountClientContext {
    intention: Intention;
    signer: Account;
    /** Optional market metadata used to resolve friendly symbol strings. */
    resolver?: Pick<MarketResolver, "symbolId">;
    /** Default gas and expiration overrides shared by all actions. */
    submitOptions?: DexOrderlessSubmitOptions;
}

export interface AccountIntentsContext {
    /** Optional market metadata used to resolve friendly symbol strings. */
    resolver?: Pick<MarketResolver, "symbolId">;
}

export interface CreateSubaccountInput {
    name: string;
    nonce?: bigint;
}

export interface ModifySubaccountInput {
    name: string;
    subAddress: AccountAddressInput;
    onBehalfOf?: AccountAddressInput;
    nonce?: bigint;
}

export type MarketSymbolInput =
    | { symbol: string; symbolId?: never }
    | { symbolId: number; symbol?: never };

export type LeverageUpdate = MarketSymbolInput & {
    leverage: number | string;
};

export interface SetLeverageInput {
    subAddress: AccountAddressInput;
    updates: LeverageUpdate[];
    onBehalfOf?: AccountAddressInput;
    nonce?: bigint;
}

export type UserPositionMode = "one-way" | "hedge" | OrderPositionMode;

export interface SetPositionModeInput {
    subAddress: AccountAddressInput;
    mode: UserPositionMode;
    onBehalfOf?: AccountAddressInput;
    nonce?: bigint;
}

export type UserMarginMode = "cross" | "isolated" | "portfolio" | MarginMode;

export type MarginModeUpdate = MarketSymbolInput & {
    mode: UserMarginMode;
};

export interface SetMarginModeInput {
    subAddress: AccountAddressInput;
    updates: MarginModeUpdate[];
    onBehalfOf?: AccountAddressInput;
    nonce?: bigint;
}

export interface ApproveAgentInput {
    name: string;
    agent: Account | AccountAddressInput;
    /** Absolute unix timestamp in seconds. Mutually exclusive with expiresInSecs. */
    expiryTimestamp?: bigint;
    /** Relative lifetime in seconds. Defaults to 30 days. */
    expiresInSecs?: number;
    nonce?: bigint;
}

export interface RevokeAgentInput {
    name: string;
    nonce?: bigint;
}

export type AssetAmountInput =
    | {
          /** Atomic on-chain amount; preferred for protocol integrations. */
          amountAtomic: bigint;
          amount?: never;
          decimals?: never;
      }
    | {
          /** Human-readable decimal amount. */
          amount: number | string;
          /** Asset decimal places. Defaults to 6 (USDC). */
          decimals?: number;
          amountAtomic?: never;
      };

interface TransferBetweenSubaccountsBase {
    fromSubAddress: AccountAddressInput;
    toSubAddress: AccountAddressInput;
    assetId?: number;
    accountType?: AccountType;
    nonce?: bigint;
}

export type TransferBetweenSubaccountsInput =
    TransferBetweenSubaccountsBase & AssetAmountInput;

interface DepositToSubaccountBase {
    subAddress: AccountAddressInput;
    /** Defaults to the AccountClient signer address. */
    mainAddress?: AccountAddressInput;
    assetId?: number;
    accountType?: AccountType;
    nonce?: bigint;
}

export type DepositToSubaccountInput =
    DepositToSubaccountBase & AssetAmountInput;

interface WithdrawToMainBase {
    subAddress: AccountAddressInput;
    /** Defaults to the AccountClient signer address. */
    mainAddress?: AccountAddressInput;
    assetId?: number;
    accountType?: AccountType;
    nonce?: bigint;
}

export type WithdrawToMainInput = WithdrawToMainBase & AssetAmountInput;

interface TransferToAccountBase {
    toAccount: AccountAddressInput;
    assetId?: number;
    accountType?: AccountType;
    nonce?: bigint;
}

export type TransferToAccountInput = TransferToAccountBase & AssetAmountInput;

interface BridgeWithdrawBase {
    destination: AccountAddressInput;
    assetId?: number;
    accountType?: AccountType;
    nonce?: bigint;
}

export type BridgeWithdrawInput = BridgeWithdrawBase & AssetAmountInput;

type WithoutNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;

export interface TransferBetweenSubaccountsBatchInput {
    transfers: Array<WithoutNonce<TransferBetweenSubaccountsInput>>;
    nonce?: bigint;
}

export interface DepositToSubaccountsInput {
    transfers: Array<WithoutNonce<DepositToSubaccountInput>>;
    nonce?: bigint;
}

export interface WithdrawToMainBatchInput {
    transfers: Array<WithoutNonce<WithdrawToMainInput>>;
    nonce?: bigint;
}

export interface TransferToAccountsInput {
    transfers: Array<WithoutNonce<TransferToAccountInput>>;
    nonce?: bigint;
}

export interface BridgeWithdrawBatchInput {
    transfers: Array<WithoutNonce<BridgeWithdrawInput>>;
    nonce?: bigint;
}

interface BridgeDepositItemBase {
    toAccount: AccountAddressInput;
    assetId?: number;
    accountType?: AccountType;
}

export type BridgeDepositItem = BridgeDepositItemBase & AssetAmountInput;

export interface BridgeDepositInput {
    transfers: BridgeDepositItem[];
    proof: BridgeProof;
    nonce?: bigint;
}

interface AdjustIsolatedMarginBase {
    subAddress: AccountAddressInput;
    side: "long" | "short";
    action: "add" | "remove";
    onBehalfOf?: AccountAddressInput;
    nonce?: bigint;
}

export type AdjustIsolatedMarginInput =
    AdjustIsolatedMarginBase & MarketSymbolInput & AssetAmountInput;

export interface CreateSubaccountResult extends DexOrderlessExecutionResult {
    /** Decoded from CreateSubAccountEvent; null when a node omits event data. */
    subAddress: AccountAddress | null;
}

export interface AgentAuthorizationInfo {
    name: string;
    agentAddress: AccountAddress;
    expiryTimestamp: bigint;
    createdAt: bigint;
}

export interface AgentAuthorizations {
    masterAddress: AccountAddress;
    agents: AgentAuthorizationInfo[];
}

export interface AgentBinding {
    agentAddress: AccountAddress;
    masterAddress: AccountAddress;
    name: string;
}

function nextNonce(nonce?: bigint): bigint {
    const value = nonce ?? BigInt(Date.now());
    assertU64(value, "nonce");
    return value;
}

function assertU64(value: bigint, field: string): void {
    if (value < 0n || value > MAX_U64) {
        throw new Error(`${field} must be a u64`);
    }
}

function assertAmount(value: bigint): void {
    if (value <= 0n || value > MAX_U64) {
        throw new Error("resolved atomic amount must be between 1 and u64::MAX");
    }
}

function assertU32(value: number, field: string): number {
    if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
        throw new Error(`${field} must be a u32`);
    }
    return value;
}

/** Resolve exactly one atomic or human-readable amount into a wire u64. */
export function resolveAssetAmount(input: AssetAmountInput): bigint {
    const hasAtomic = input.amountAtomic != null;
    const hasHuman = input.amount != null;
    if (hasAtomic === hasHuman) {
        throw new Error("Provide exactly one of amountAtomic or amount");
    }
    const result = hasAtomic
        ? input.amountAtomic!
        : (() => {
              const decimals = input.decimals ?? 6;
              if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
                  throw new Error("decimals must be an integer between 0 and 18");
              }
              const value = input.amount!;
              const scaled = floorScaleToBigInt(value, decimals);
              if (typeof value === "string") {
                  const raw = value.trim().replace(/^[+-]/, "");
                  const match = raw.match(/^\d*(?:\.(\d*))?$/);
                  const fractional = match?.[1] ?? "";
                  if (fractional.slice(decimals).replace(/0/g, "") !== "") {
                      throw new Error(
                          `amount has more than ${decimals} decimal places`,
                      );
                  }
              } else {
                  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) {
                      throw new Error("large human amounts must be passed as strings");
                  }
                  if (Number(scaled) / 10 ** decimals !== value) {
                      throw new Error(
                          `amount has more than ${decimals} decimal places`,
                      );
                  }
              }
              return scaled;
          })();
    assertAmount(result);
    return result;
}

function assetId(value = 0): number {
    return assertU32(value, "assetId");
}

function address(value: AccountAddressInput): AccountAddress {
    return AccountAddress.from(value, { maxMissingChars: 64 });
}

function normalizedName(value: string, field: string, maxBytes: number): string {
    const result = value.trim();
    const length = new TextEncoder().encode(result).length;
    if (length === 0) throw new Error(`${field} cannot be empty`);
    if (length > maxBytes) {
        throw new Error(`${field} cannot exceed ${maxBytes} UTF-8 bytes`);
    }
    return result;
}

function resolveSymbolId(
    input: MarketSymbolInput,
    resolver?: Pick<MarketResolver, "symbolId">,
): number {
    const hasSymbol = input.symbol != null;
    const hasSymbolId = input.symbolId != null;
    if (hasSymbol === hasSymbolId) {
        throw new Error("Provide exactly one of symbol or symbolId");
    }
    if (hasSymbol) {
        const symbol = input.symbol.trim();
        if (!symbol) throw new Error("symbol cannot be empty");
        if (!resolver) {
            throw new Error(
                "A market resolver is required when using symbol; pass resolver to AccountIntents/AccountClient or use symbolId",
            );
        }
        return assertU32(resolver.symbolId(symbol), "resolved symbolId");
    }
    return assertU32(input.symbolId!, "symbolId");
}

function resolveLeverage(value: number | string): number {
    if (typeof value === "string" && value.trim() === "") {
        throw new Error("leverage cannot be empty");
    }
    if (
        typeof value === "string" &&
        !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
    ) {
        throw new Error("leverage must be a decimal number");
    }
    const leverage = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(leverage) || leverage <= 0) {
        throw new Error("leverage must be a finite positive number");
    }
    const imLeverage = Math.ceil(10_000 / leverage);
    if (imLeverage <= 0 || imLeverage > MAX_I32) {
        throw new Error("leverage is outside the supported wire range");
    }
    return leverage;
}

function resolvePositionMode(mode: UserPositionMode): OrderPositionMode {
    if (mode === "one-way") return OrderPositionMode.Net;
    if (mode === "hedge") return OrderPositionMode.Hedge;
    if (mode === OrderPositionMode.Net || mode === OrderPositionMode.Hedge) return mode;
    throw new Error("mode must be one-way or hedge");
}

function resolveMarginMode(mode: UserMarginMode): MarginMode {
    if (mode === "cross") return MarginMode.Cross;
    if (mode === "isolated") return MarginMode.Isolated;
    if (mode === "portfolio") return MarginMode.Portfolio;
    if (
        mode === MarginMode.Cross ||
        mode === MarginMode.Isolated ||
        mode === MarginMode.Portfolio
    ) {
        return mode;
    }
    throw new Error("mode must be cross, isolated or portfolio");
}

function assertUniqueSymbolIds(symbolIds: number[], field: string): void {
    if (new Set(symbolIds).size !== symbolIds.length) {
        throw new Error(`${field} cannot contain duplicate symbols`);
    }
}

function wrapUserConfig(
    variant: DexUserConfigTxVariant,
    payload: DexUserConfigTxPayload,
): DexOrderlessTx {
    return new DexOrderlessTx(
        DexOrderlessTxVariant.DexUserConfig,
        new DexUserConfigTx(variant, payload),
    );
}

function wrapAgent(
    nonce: bigint,
    variant: AgentOperationVariant,
    operation: AgentApprove | AgentRevoke,
): DexOrderlessTx {
    return new DexOrderlessTx(
        DexOrderlessTxVariant.DexAgent,
        new DexAgentTx(nonce, variant, operation),
    );
}

function wrapTransfer(transfer: DexTransferTx): DexOrderlessTx {
    return new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer);
}

/** Pure wire builder; suitable for AccountClient or an external wallet adapter. */
export class AccountIntents {
    private readonly resolver?: Pick<MarketResolver, "symbolId">;

    constructor(context: AccountIntentsContext = {}) {
        this.resolver = context.resolver;
    }

    createSubaccount(input: CreateSubaccountInput): DexOrderlessTx {
        const name = normalizedName(input.name, "subaccount name", MAX_SUBACCOUNT_NAME_BYTES);
        const nonce = nextNonce(input.nonce);
        return wrapUserConfig(
            DexUserConfigTxVariant.CreateSubAccount,
            new CreateSubAccount(nonce, name),
        );
    }

    modifySubaccount(input: ModifySubaccountInput): DexOrderlessTx {
        const name = normalizedName(input.name, "subaccount name", MAX_SUBACCOUNT_NAME_BYTES);
        const nonce = nextNonce(input.nonce);
        return wrapUserConfig(
            DexUserConfigTxVariant.ModifySubAccount,
            new ModifySubAccount(
                nonce,
                name,
                address(input.subAddress),
                input.onBehalfOf == null ? undefined : address(input.onBehalfOf),
            ),
        );
    }

    setLeverage(input: SetLeverageInput): DexOrderlessTx {
        if (input.updates.length === 0) {
            throw new Error("updates must contain at least one leverage setting");
        }
        const leverageInfo = input.updates.map((update) =>
            new UserSymbolLeverage(
                resolveSymbolId(update, this.resolver),
                resolveLeverage(update.leverage),
            ),
        );
        assertUniqueSymbolIds(
            leverageInfo.map((update) => update.symbolId),
            "updates",
        );
        return wrapUserConfig(
            DexUserConfigTxVariant.SetUserLeverage,
            new SetUserLeverage(
                nextNonce(input.nonce),
                address(input.subAddress),
                leverageInfo,
                input.onBehalfOf == null ? undefined : address(input.onBehalfOf),
            ),
        );
    }

    setPositionMode(input: SetPositionModeInput): DexOrderlessTx {
        return wrapUserConfig(
            DexUserConfigTxVariant.ChangePositionMode,
            new ChangePositionMode(
                nextNonce(input.nonce),
                address(input.subAddress),
                resolvePositionMode(input.mode),
                input.onBehalfOf == null ? undefined : address(input.onBehalfOf),
            ),
        );
    }

    setMarginMode(input: SetMarginModeInput): DexOrderlessTx {
        if (input.updates.length === 0) {
            throw new Error("updates must contain at least one margin-mode setting");
        }
        const marginModes = input.updates.map(
            (update) =>
                new SymbolMarginMode(
                    resolveSymbolId(update, this.resolver),
                    resolveMarginMode(update.mode),
                ),
        );
        assertUniqueSymbolIds(
            marginModes.map((update) => update.symbolId),
            "updates",
        );
        return wrapUserConfig(
            DexUserConfigTxVariant.ChangeMarginMode,
            new ChangeMarginMode(
                nextNonce(input.nonce),
                address(input.subAddress),
                marginModes,
                input.onBehalfOf == null ? undefined : address(input.onBehalfOf),
            ),
        );
    }

    adjustIsolatedMargin(input: AdjustIsolatedMarginInput): DexOrderlessTx {
        if (input.side !== "long" && input.side !== "short") {
            throw new Error("side must be long or short");
        }
        if (input.action !== "add" && input.action !== "remove") {
            throw new Error("action must be add or remove");
        }
        const amount = resolveAssetAmount(input);
        if (amount > MAX_I64) {
            throw new Error("resolved atomic amount must fit in an i64");
        }
        const delta = input.action === "add" ? amount : -amount;
        const deltaLong = input.side === "long" ? delta : 0n;
        const deltaShort = input.side === "short" ? delta : 0n;
        return wrapUserConfig(
            DexUserConfigTxVariant.AdjustIsolatedMargin,
            new AdjustIsolatedMargin(
                nextNonce(input.nonce),
                address(input.subAddress),
                resolveSymbolId(input, this.resolver),
                deltaLong,
                deltaShort,
                input.onBehalfOf == null ? undefined : address(input.onBehalfOf),
            ),
        );
    }

    approveAgent(input: ApproveAgentInput): DexOrderlessTx {
        if (input.expiryTimestamp != null && input.expiresInSecs != null) {
            throw new Error("Provide expiryTimestamp or expiresInSecs, not both");
        }
        const name = normalizedName(input.name, "agent name", MAX_AGENT_NAME_BYTES);
        const agentAddress =
            input.agent instanceof Account ? input.agent.accountAddress : address(input.agent);
        if (!agentAddress.isEvmCompatible()) {
            throw new Error("agent address must be EVM compatible");
        }
        const now = BigInt(Math.floor(Date.now() / 1000));
        const lifetime = input.expiresInSecs ?? DEFAULT_AGENT_EXPIRY_SECONDS;
        if (!Number.isInteger(lifetime) || lifetime <= 0 || lifetime > MAX_AGENT_EXPIRY_SECONDS) {
            throw new Error(
                `expiresInSecs must be between 1 and ${MAX_AGENT_EXPIRY_SECONDS}`,
            );
        }
        const expiryTimestamp =
            input.expiryTimestamp ?? now + BigInt(lifetime);
        assertU64(expiryTimestamp, "expiryTimestamp");
        if (expiryTimestamp <= now) {
            throw new Error("expiryTimestamp must be in the future");
        }
        if (expiryTimestamp > now + BigInt(MAX_AGENT_EXPIRY_SECONDS)) {
            throw new Error(
                `expiryTimestamp cannot exceed ${MAX_AGENT_EXPIRY_SECONDS} seconds from now`,
            );
        }
        const nonce = nextNonce(input.nonce);
        return wrapAgent(
            nonce,
            AgentOperationVariant.Approve,
            new AgentApprove(name, agentAddress, expiryTimestamp),
        );
    }

    revokeAgent(input: RevokeAgentInput): DexOrderlessTx {
        const name = normalizedName(input.name, "agent name", MAX_AGENT_NAME_BYTES);
        const nonce = nextNonce(input.nonce);
        return wrapAgent(
            nonce,
            AgentOperationVariant.Revoke,
            new AgentRevoke(name),
        );
    }

    transferBetweenSubaccounts(input: TransferBetweenSubaccountsInput): DexOrderlessTx {
        const amount = resolveAssetAmount(input);
        const from = address(input.fromSubAddress);
        const to = address(input.toSubAddress);
        if (from.equals(to)) throw new Error("fromSubAddress and toSubAddress must differ");
        return wrapTransfer(
            new DexTransferTx(nextNonce(input.nonce), DexTransferVariant.InternalTransfer, [
                new InternalTransferItem(
                    from,
                    to,
                    assetId(input.assetId),
                    amount,
                    input.accountType ?? AccountType.Perp,
                ),
            ]),
        );
    }

    transferBetweenSubaccountsBatch(
        input: TransferBetweenSubaccountsBatchInput,
    ): DexOrderlessTx {
        if (input.transfers.length === 0) throw new Error("transfers cannot be empty");
        const items = input.transfers.map((transfer) => {
            const from = address(transfer.fromSubAddress);
            const to = address(transfer.toSubAddress);
            if (from.equals(to)) throw new Error("fromSubAddress and toSubAddress must differ");
            return new InternalTransferItem(
                from,
                to,
                assetId(transfer.assetId),
                resolveAssetAmount(transfer),
                transfer.accountType ?? AccountType.Perp,
            );
        });
        return wrapTransfer(
            new DexTransferTx(nextNonce(input.nonce), DexTransferVariant.InternalTransfer, items),
        );
    }

    depositToSubaccount(
        input: DepositToSubaccountInput,
        defaultMainAddress?: AccountAddress,
    ): DexOrderlessTx {
        const amount = resolveAssetAmount(input);
        const main =
            input.mainAddress == null
                ? defaultMainAddress
                : address(input.mainAddress);
        if (!main) throw new Error("mainAddress is required");
        return wrapTransfer(
            new DexTransferTx(nextNonce(input.nonce), DexTransferVariant.InternalTransfer, [
                new InternalTransferItem(
                    main,
                    address(input.subAddress),
                    assetId(input.assetId),
                    amount,
                    input.accountType ?? AccountType.Perp,
                ),
            ]),
        );
    }

    depositToSubaccounts(
        input: DepositToSubaccountsInput,
        defaultMainAddress?: AccountAddress,
    ): DexOrderlessTx {
        if (input.transfers.length === 0) throw new Error("transfers cannot be empty");
        const items = input.transfers.map((transfer) => {
            const main =
                transfer.mainAddress == null ? defaultMainAddress : address(transfer.mainAddress);
            if (!main) throw new Error("mainAddress is required");
            return new InternalTransferItem(
                main,
                address(transfer.subAddress),
                assetId(transfer.assetId),
                resolveAssetAmount(transfer),
                transfer.accountType ?? AccountType.Perp,
            );
        });
        return wrapTransfer(
            new DexTransferTx(nextNonce(input.nonce), DexTransferVariant.InternalTransfer, items),
        );
    }

    withdrawToMain(
        input: WithdrawToMainInput,
        defaultMainAddress?: AccountAddress,
    ): DexOrderlessTx {
        const amount = resolveAssetAmount(input);
        const main =
            input.mainAddress == null
                ? defaultMainAddress
                : address(input.mainAddress);
        if (!main) throw new Error("mainAddress is required");
        return wrapTransfer(
            new DexTransferTx(nextNonce(input.nonce), DexTransferVariant.InternalTransfer, [
                new InternalTransferItem(
                    address(input.subAddress),
                    main,
                    assetId(input.assetId),
                    amount,
                    input.accountType ?? AccountType.Perp,
                ),
            ]),
        );
    }

    withdrawToMainBatch(
        input: WithdrawToMainBatchInput,
        defaultMainAddress?: AccountAddress,
    ): DexOrderlessTx {
        if (input.transfers.length === 0) throw new Error("transfers cannot be empty");
        const items = input.transfers.map((transfer) => {
            const main =
                transfer.mainAddress == null ? defaultMainAddress : address(transfer.mainAddress);
            if (!main) throw new Error("mainAddress is required");
            return new InternalTransferItem(
                address(transfer.subAddress),
                main,
                assetId(transfer.assetId),
                resolveAssetAmount(transfer),
                transfer.accountType ?? AccountType.Perp,
            );
        });
        return wrapTransfer(
            new DexTransferTx(nextNonce(input.nonce), DexTransferVariant.InternalTransfer, items),
        );
    }

    transferToAccount(input: TransferToAccountInput): DexOrderlessTx {
        const amount = resolveAssetAmount(input);
        return wrapTransfer(
            new DexTransferTx(nextNonce(input.nonce), DexTransferVariant.AccountTransfer, [
                new AccountTransferItem(
                    address(input.toAccount),
                    assetId(input.assetId),
                    amount,
                    input.accountType ?? AccountType.Spot,
                ),
            ]),
        );
    }

    transferToAccounts(input: TransferToAccountsInput): DexOrderlessTx {
        if (input.transfers.length === 0) throw new Error("transfers cannot be empty");
        return wrapTransfer(
            new DexTransferTx(
                nextNonce(input.nonce),
                DexTransferVariant.AccountTransfer,
                input.transfers.map(
                    (transfer) =>
                        new AccountTransferItem(
                            address(transfer.toAccount),
                            assetId(transfer.assetId),
                            resolveAssetAmount(transfer),
                            transfer.accountType ?? AccountType.Spot,
                        ),
                ),
            ),
        );
    }

    bridgeWithdraw(input: BridgeWithdrawInput): DexOrderlessTx {
        const amount = resolveAssetAmount(input);
        const destination = address(input.destination);
        if (!destination.isEvmCompatible()) {
            throw new Error("bridge withdrawal destination must be EVM compatible");
        }
        return wrapTransfer(
            new DexTransferTx(
                nextNonce(input.nonce),
                DexTransferVariant.CrossTransfer,
                [
                    new CrossTransferItem(
                        destination,
                        assetId(input.assetId),
                        amount,
                        input.accountType ?? AccountType.Perp,
                    ),
                ],
                CrossTransferOption.Burn,
            ),
        );
    }

    bridgeWithdrawBatch(input: BridgeWithdrawBatchInput): DexOrderlessTx {
        if (input.transfers.length === 0) throw new Error("transfers cannot be empty");
        const items = input.transfers.map((transfer) => {
            const destination = address(transfer.destination);
            if (!destination.isEvmCompatible()) {
                throw new Error("bridge withdrawal destination must be EVM compatible");
            }
            return new CrossTransferItem(
                destination,
                assetId(transfer.assetId),
                resolveAssetAmount(transfer),
                transfer.accountType ?? AccountType.Perp,
            );
        });
        return wrapTransfer(
            new DexTransferTx(
                nextNonce(input.nonce),
                DexTransferVariant.CrossTransfer,
                items,
                CrossTransferOption.Burn,
            ),
        );
    }

    /** Build a proof-backed bridge mint/deposit supplied by a trusted bridge service. */
    bridgeDeposit(input: BridgeDepositInput): DexOrderlessTx {
        if (input.transfers.length === 0) throw new Error("transfers cannot be empty");
        if (input.proof.signatures.length === 0) {
            throw new Error("bridge proof must contain at least one signature");
        }
        return wrapTransfer(
            new DexTransferTx(
                nextNonce(input.nonce),
                DexTransferVariant.CrossTransfer,
                input.transfers.map(
                    (transfer) =>
                        new CrossTransferItem(
                            address(transfer.toAccount),
                            assetId(transfer.assetId),
                            resolveAssetAmount(transfer),
                            transfer.accountType ?? AccountType.Perp,
                        ),
                ),
                CrossTransferOption.Mint,
                input.proof,
            ),
        );
    }
}

/**
 * Account-based execution client. Browser wallets can reuse AccountIntents and
 * submit the returned DexOrderlessTx with their wallet adapter instead.
 */
export class AccountClient {
    private readonly intention: Intention;
    private readonly signer: Account;
    private readonly submitOptions?: DexOrderlessSubmitOptions;
    private readonly intents: AccountIntents;

    constructor(context: AccountClientContext) {
        this.intention = context.intention;
        this.signer = context.signer;
        this.submitOptions = context.submitOptions;
        this.intents = new AccountIntents({ resolver: context.resolver });
    }

    get build(): AccountIntents {
        return this.intents;
    }

    /**
     * Generate an ephemeral Secp256k1 agent account for server/script use.
     * Browser applications should use their wallet/secure signer instead.
     * The caller exclusively owns secure private-key storage.
     */
    generateAgentAccount(): Account {
        return Account.generate();
    }

    private submit(
        orderlessTx: DexOrderlessTx,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.intention.submitDexOrderless({
            signer: this.signer,
            orderlessTx,
            options: { ...this.submitOptions, ...options },
        });
    }

    private execute(
        orderlessTx: DexOrderlessTx,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.intention.executeDexOrderless({
            signer: this.signer,
            orderlessTx,
            options: { ...this.submitOptions, ...options },
        });
    }

    async createSubaccount(
        input: CreateSubaccountInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<CreateSubaccountResult> {
        const result = await this.execute(this.intents.createSubaccount(input), options);
        const event = result.events.find(
            (candidate) => candidate.eventType === "CreateSubAccountEvent",
        )?.event as CreateSubAccountEvent | undefined;
        return { ...result, subAddress: event?.subAddress ?? null };
    }

    submitCreateSubaccount(
        input: CreateSubaccountInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.createSubaccount(input), options);
    }

    modifySubaccount(
        input: ModifySubaccountInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.modifySubaccount(input), options);
    }

    submitModifySubaccount(
        input: ModifySubaccountInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.modifySubaccount(input), options);
    }

    setLeverage(
        input: SetLeverageInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.setLeverage(input), options);
    }

    submitSetLeverage(
        input: SetLeverageInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.setLeverage(input), options);
    }

    setPositionMode(
        input: SetPositionModeInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.setPositionMode(input), options);
    }

    submitSetPositionMode(
        input: SetPositionModeInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.setPositionMode(input), options);
    }

    setMarginMode(
        input: SetMarginModeInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.setMarginMode(input), options);
    }

    submitSetMarginMode(
        input: SetMarginModeInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.setMarginMode(input), options);
    }

    adjustIsolatedMargin(
        input: AdjustIsolatedMarginInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.adjustIsolatedMargin(input), options);
    }

    submitAdjustIsolatedMargin(
        input: AdjustIsolatedMarginInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.adjustIsolatedMargin(input), options);
    }

    approveAgent(
        input: ApproveAgentInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        const orderless = this.intents.approveAgent(input);
        const operation = (orderless.inner as DexAgentTx).operation as AgentApprove;
        if (operation.agentAddress.equals(this.signer.accountAddress)) {
            throw new Error("Cannot authorize the signer as its own agent");
        }
        return this.execute(orderless, options);
    }

    submitApproveAgent(
        input: ApproveAgentInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        const orderless = this.intents.approveAgent(input);
        const operation = (orderless.inner as DexAgentTx).operation as AgentApprove;
        if (operation.agentAddress.equals(this.signer.accountAddress)) {
            throw new Error("Cannot authorize the signer as its own agent");
        }
        return this.submit(orderless, options);
    }

    revokeAgent(
        input: RevokeAgentInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.revokeAgent(input), options);
    }

    submitRevokeAgent(
        input: RevokeAgentInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.revokeAgent(input), options);
    }

    transferBetweenSubaccounts(
        input: TransferBetweenSubaccountsInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.transferBetweenSubaccounts(input), options);
    }

    submitTransferBetweenSubaccounts(
        input: TransferBetweenSubaccountsInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.transferBetweenSubaccounts(input), options);
    }

    transferBetweenSubaccountsBatch(
        input: TransferBetweenSubaccountsBatchInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.transferBetweenSubaccountsBatch(input), options);
    }

    submitTransferBetweenSubaccountsBatch(
        input: TransferBetweenSubaccountsBatchInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.transferBetweenSubaccountsBatch(input), options);
    }

    depositToSubaccount(
        input: DepositToSubaccountInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(
            this.intents.depositToSubaccount(input, this.signer.accountAddress),
            options,
        );
    }

    submitDepositToSubaccount(
        input: DepositToSubaccountInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(
            this.intents.depositToSubaccount(input, this.signer.accountAddress),
            options,
        );
    }

    depositToSubaccounts(
        input: DepositToSubaccountsInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(
            this.intents.depositToSubaccounts(input, this.signer.accountAddress),
            options,
        );
    }

    submitDepositToSubaccounts(
        input: DepositToSubaccountsInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(
            this.intents.depositToSubaccounts(input, this.signer.accountAddress),
            options,
        );
    }

    withdrawToMain(
        input: WithdrawToMainInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(
            this.intents.withdrawToMain(input, this.signer.accountAddress),
            options,
        );
    }

    submitWithdrawToMain(
        input: WithdrawToMainInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(
            this.intents.withdrawToMain(input, this.signer.accountAddress),
            options,
        );
    }

    withdrawToMainBatch(
        input: WithdrawToMainBatchInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(
            this.intents.withdrawToMainBatch(input, this.signer.accountAddress),
            options,
        );
    }

    submitWithdrawToMainBatch(
        input: WithdrawToMainBatchInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(
            this.intents.withdrawToMainBatch(input, this.signer.accountAddress),
            options,
        );
    }

    private buildTransferToAccount(input: TransferToAccountInput): DexOrderlessTx {
        const orderless = this.intents.transferToAccount(input);
        const transfer = orderless.inner as DexTransferTx;
        const item = transfer.payload[0] as AccountTransferItem;
        if (item.to_account.equals(this.signer.accountAddress)) {
            throw new Error("Cannot transfer funds to the signer account itself");
        }
        return orderless;
    }

    private buildTransferToAccounts(input: TransferToAccountsInput): DexOrderlessTx {
        const orderless = this.intents.transferToAccounts(input);
        const transfer = orderless.inner as DexTransferTx;
        if (
            (transfer.payload as AccountTransferItem[]).some((item) =>
                item.to_account.equals(this.signer.accountAddress),
            )
        ) {
            throw new Error("Cannot transfer funds to the signer account itself");
        }
        return orderless;
    }

    transferToAccount(
        input: TransferToAccountInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.buildTransferToAccount(input), options);
    }

    submitTransferToAccount(
        input: TransferToAccountInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.buildTransferToAccount(input), options);
    }

    transferToAccounts(
        input: TransferToAccountsInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.buildTransferToAccounts(input), options);
    }

    submitTransferToAccounts(
        input: TransferToAccountsInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.buildTransferToAccounts(input), options);
    }

    bridgeWithdraw(
        input: BridgeWithdrawInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.bridgeWithdraw(input), options);
    }

    submitBridgeWithdraw(
        input: BridgeWithdrawInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.bridgeWithdraw(input), options);
    }

    bridgeWithdrawBatch(
        input: BridgeWithdrawBatchInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.bridgeWithdrawBatch(input), options);
    }

    submitBridgeWithdrawBatch(
        input: BridgeWithdrawBatchInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.bridgeWithdrawBatch(input), options);
    }

    bridgeDeposit(
        input: BridgeDepositInput,
        options: AccountActionExecutionOptions = {},
    ): Promise<DexOrderlessExecutionResult> {
        return this.execute(this.intents.bridgeDeposit(input), options);
    }

    submitBridgeDeposit(
        input: BridgeDepositInput,
        options: AccountActionSubmitOptions = {},
    ): Promise<PendingTransactionResponse> {
        return this.submit(this.intents.bridgeDeposit(input), options);
    }

    async getAgents(
        masterAddress: AccountAddressInput = this.signer.accountAddress,
    ): Promise<AgentAuthorizations> {
        const master = address(masterAddress);
        const nodeUrl = this.intention.config.nodeUrl.replace(/\/+$/, "");
        const response = await fetch(
            `${nodeUrl}/dex/agents/${master.toString()}`,
            {
                headers: {
                    Accept: "application/json",
                    ...this.intention.config.clientConfig?.HEADERS,
                },
            },
        );
        if (!response.ok) {
            throw new Error(
                `Failed to get agents: ${response.status} ${response.statusText}`,
            );
        }
        const body = (await response.json()) as {
            master_address: string;
            agents: Array<{
                name: string;
                agent_address: string;
                expiry_timestamp: string | number;
                created_at: string | number;
            }>;
        };
        return {
            masterAddress: address(body.master_address),
            agents: body.agents.map((agent) => ({
                name: agent.name,
                agentAddress: address(agent.agent_address),
                expiryTimestamp: BigInt(agent.expiry_timestamp),
                createdAt: BigInt(agent.created_at),
            })),
        };
    }

    async getAgentBinding(agentAddress: AccountAddressInput): Promise<AgentBinding | null> {
        const agent = address(agentAddress);
        const nodeUrl = this.intention.config.nodeUrl.replace(/\/+$/, "");
        const response = await fetch(
            `${nodeUrl}/dex/agent_binding/${agent.toString()}`,
            {
                headers: {
                    Accept: "application/json",
                    ...this.intention.config.clientConfig?.HEADERS,
                },
            },
        );
        if (response.status === 404) return null;
        if (!response.ok) {
            throw new Error(
                `Failed to get agent binding: ${response.status} ${response.statusText}`,
            );
        }
        const body = (await response.json()) as Partial<{
            agent_address: string;
            master_address: string;
            name: string;
        }>;
        if (!body.agent_address || !body.master_address || body.name == null) return null;
        return {
            agentAddress: address(body.agent_address),
            masterAddress: address(body.master_address),
            name: body.name,
        };
    }
}

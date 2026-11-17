// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Intention SDK
 *
 * Minimal TypeScript SDK for Intention DEX.
 */

// --- BCS ---
export * from "./api/referralClient";
export * from "./events/referralEvents";
export { Serializable, Serializer } from "./bcs/serializer";
export { Deserializer } from "./bcs/deserializer";

// --- Core types ---
export { AccountAddress } from "./core/accountAddress";
export type { AccountAddressInput } from "./core/accountAddress";
export {
    Secp256k1PublicKey,
    Secp256k1Signature,
    AnyPublicKey,
    AnySignature,
    AnyPublicKeyVariant,
    AnySignatureVariant,
} from "./core/crypto";

// --- Account & PrivateKey ---
export { Account, Secp256k1PrivateKey } from "./core/account";

// --- Address utilities ---
export { deriveSubaccountAddress } from "./core/addressUtils";

// --- Enums ---
export {
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
    // Multisig account enums
    MultisigOpVariant,
    GatedPayloadVariant,
    KeyProofVariant,
    AuthorityKindVariant,
    DexUserConfigTxVariant,
    DexConfigTxVariant,
    TransactionPayloadVariants,
    // Vault enums
    VaultTxVariant,
    ManagedAccountAction,
    VaultStatus,
    ClpTraderAllowlistAction,
    // Position & signing enums
    PositionMode,
    SigningSchemeInput,
    // System config enums
    SymbolStatus,
    PerpetualTier,
    MarginModeType,
    StpMode,
    // Delisting enums
    DelistingPriceSource,
    DelistingLegSide,
    DelistingLegMarginMode,
} from "./types/enums";

// --- DEX Transaction Payloads ---
export {
    TransactionPayload,
    DexPlaceOrder,
    DexPlaceOrders,
    DexCancelOrder,
    DexReplaceOrder,
    DexConditionReplaceOrder,
    replaceByOrderId,
    replaceByOrderIdWithContext,
    replaceByClientOrderId,
    DexOrders,
    DexTx,
    InternalTransferItem,
    AccountTransferItem,
    CrossTransferItem,
    BridgeSignature,
    BridgeProof,
    MultiSigProof,
    RawOrderlessInner,
    DexTransferTx,
    DepositToSubaccount,
    WithdrawToMain,
    AgentApprove,
    AgentRevoke,
    AgentRevokeAll,
    DexAgentTx,
    UserSymbolLeverage,
    SetUserLeverage,
    ChangePositionMode,
    SymbolMarginMode,
    ChangeMarginMode,
    CreateSubAccount,
    ModifySubAccount,
    AdjustIsolatedMargin,
    RegisterReferralCode,
    BindReferrer,
    ClaimReferralRewards,
    SetReferralConfig,
    DexUserConfigTx,
    DexConfigTx,
    // NOTE: DEX system-config transaction builders (CreateSpot/CreatePerpetual/
    // Update*/Set*/DexSystemConfigTx and their sub-structs) were removed - these
    // admin/config transactions are not exposed by the SDK; only their on-chain
    // events are still decoded (see DEX Events below). System-config access is
    // gated on-chain by RBAC, not by the SDK.
    DexOrderlessTx,
    TransactionPayloadDexOrderless,
} from "./transactions/dexPayloads";
export type {
    DexReplaceTarget,
    ReferralParameters,
} from "./transactions/dexPayloads";

// --- High-level intent order API (place / close / cancel / modify) ---
export {
    OrderType,
    OrderIntents,
    OrderClient,
    orderTypeToBasics,
    encodeLegSelection,
    resolveTimeInForce,
    cancelTargetFromRef,
    replaceTargetFromRef,
    orderOutcomesFromDecodedEvents,
    OrderRejectedError,
    OrderPreflightError,
} from "./transactions/orderIntents";
export type {
    TriggerPriceKind,
    SizeMode,
    PositionSide,
    IntentSide,
    OrderTimeInForce,
    OrderInput,
    ClosePositionInput,
    ClosePositionsInput,
    TpSlLeg,
    OrderRef,
    ModifyChanges,
    ModifyConditionChanges,
    OrderGroup,
    MarketResolver,
    OrderIntentsContext,
    OrderClientContext,
    OrderPreflightMode,
    OrderPreflightOptions,
    OrderExecutionOptions,
    OrderSubmitOptions,
    OrderValidationSeverity,
    OrderValidationCode,
    OrderValidationIssue,
    OrderOutcomeStatus,
    OrderOutcome,
    OrderActionResult,
    PlaceOrderResult,
} from "./transactions/orderIntents";

// --- User DEX account/order queries ---
export {
    DexAccountClient,
    RelayerOpenOrdersProvider,
} from "./api/dexAccountClient";
export type {
    DexAssetPosition as DexAccountAssetPosition,
    DexPerpetualPosition,
    DexAccountLeverageInfo,
    DexAccountMarginModeInfo,
    DexDailyVolumeBucket as DexAccountDailyVolumeBucket,
    DexParentVolumeInfo as DexAccountParentVolumeInfo,
    DexAccountSnapshot,
    DexAuthority,
    DexOrderSnapshot,
    DexDelistingView,
    DexDelistingPlanView,
    DexDelistingRuntimeView,
    DexAccountProvider,
    OpenOrderRecord,
    OpenOrdersProvider,
} from "./api/dexAccountClient";
export {
    SimpleMarketResolver,
    floorScaleToBigInt,
    QUOTE_ATOMIC_RESOLUTION,
} from "./transactions/marketResolver";
export {
    RelayerOrderPreflightDataProvider,
} from "./transactions/orderPreflight";
export type {
    PreflightDecimal,
    OrderPreflightRequirements,
    OrderPreflightPriceTimestamps,
    OrderPreflightMarketSnapshot,
    OrderPreflightDataRequest,
    OrderPreflightDataProvider,
} from "./transactions/orderPreflight";
export type {
    PerpMarketInput,
    MarketInput,
    SpotMarketInput,
    MarketFields,
    WsMarketsMessage,
} from "./transactions/marketResolver";

// --- High-level account / agent / transfer API ---
export {
    AccountIntents,
    AccountClient,
    MAX_SUBACCOUNT_NAME_BYTES,
    MAX_AGENT_NAME_BYTES,
    MAX_AGENT_EXPIRY_SECONDS,
    DEFAULT_AGENT_EXPIRY_SECONDS,
    resolveAssetAmount,
} from "./transactions/accountClient";
export type {
    AssetAmountInput,
    AccountActionSubmitOptions,
    AccountActionExecutionOptions,
    AccountClientContext,
    AccountIntentsContext,
    CreateSubaccountInput,
    ModifySubaccountInput,
    MarketSymbolInput,
    LeverageUpdate,
    SetLeverageInput,
    UserPositionMode,
    SetPositionModeInput,
    UserMarginMode,
    MarginModeUpdate,
    SetMarginModeInput,
    AdjustIsolatedMarginInput,
    ApproveAgentInput,
    RevokeAgentInput,
    TransferBetweenSubaccountsInput,
    DepositToSubaccountInput,
    WithdrawToMainInput,
    TransferToAccountInput,
    BridgeWithdrawInput,
    TransferBetweenSubaccountsBatchInput,
    DepositToSubaccountsInput,
    WithdrawToMainBatchInput,
    TransferToAccountsInput,
    BridgeWithdrawBatchInput,
    BridgeDepositItem,
    BridgeDepositInput,
    CreateSubaccountResult,
    AgentAuthorizationInfo,
    AgentAuthorizations,
    AgentBinding,
} from "./transactions/accountClient";

// --- Vault Transaction Payloads ---
export {
    // Types
    SubaccountId as DexEventSubaccountId,
    SymbolAccountsEntry,
    ClpTraderAllowlistEntry,
    // Transaction types
    VaultTx,
    VaultCreateTx,
    VaultDepositTx,
    VaultWithdrawTx,
    VaultClpConfigTx,
    VaultClpManagedAccountTx,
    VaultClpTraderAllowlistUpdateTx,
    VaultSetParamsTx,
    VaultSetStatusTx,
    VaultClpBatchCreateManagedAccountsTx,
    VaultDistributeTx,
    // Builder helpers
    buildVaultCreate,
    buildVaultDeposit,
    buildVaultWithdraw,
    buildVaultSetParams,
    buildVaultSetStatus,
    buildVaultClose,
    buildVaultDistribute,
    calculateMaxDistributeForLeader,
    // Constants
    VAULT_MIN_INITIAL_DEPOSIT_USDC,
    VAULT_CREATION_FEE_USDC,
    MIN_LEADER_STAKE_USDC,
    VAULT_MIN_LOCKUP_SECONDS,
    VAULT_NAME_MAX_LEN,
    VAULT_STRATEGY_DESC_MAX_LEN,
    NAV_PRECISION,
    BPS_DENOMINATOR,
    // Error types
    VaultValidationError,
    VaultErrorCode,
} from "./transactions/vaultPayloads";
export type { VaultTxPayload } from "./transactions/vaultPayloads";

// --- Transaction construction ---
export { ChainId } from "./transactions/chainId";
export { RawTransaction, SimpleTransaction } from "./transactions/rawTransaction";

// --- Signing ---
export {
    generateSigningMessageForTransaction,
    generateUserTransactionHash,
} from "./transactions/signingMessage";

// --- JSON transaction submission ---
export {
    generateSubmitTransactionRequest,
} from "./transactions/jsonSubmit";
export type {
    SubmitTransactionRequestJson,
    SubmitTransactionPayloadJson,
    DexOrderlessPayloadJson,
    DexPayloadJson,
    DexNoopPayloadJson,
    DexAgentPayloadJson,
    DexAgentApprovePayloadJson,
    DexAgentRevokePayloadJson,
    DexTransferPayloadJson,
    DexTransferInternalTransferPayloadJson,
    DexInternalTransferItemJson,
    DexTransferAccountTransferPayloadJson,
    DexAccountTransferItemJson,
    DexTransferCrossTransferPayloadJson,
    DexCrossTransferItemJson,
    DexTransferFaucetMintPayloadJson,
    AccountTypeJson,
    CrossTransferOptionJson,
    DexPlaceOrderGroupJson,
    DexPlaceOrderJson,
    DexCancelOrderJson,
    DexReplaceOrderJson,
    DexOrderTargetJson,
    DexCancelTargetJson,
    DexReplaceTargetJson,
    Secp256k1EcdsaSignatureJson,
} from "./transactions/jsonSubmit";

// --- Transaction builder (generic Move calls) ---
export {
    buildTransaction,
    generateTransactionPayload,
    EntryFunction,
    TransactionPayloadEntryFunction,
} from "./transactions/transactionBuilder";

// --- Authenticator ---
export {
    AccountAuthenticatorSingleKey,
    SignedTransaction,
    generateSignedTransaction,
    AccountAuthenticatorVariant,
    TransactionAuthenticatorVariant,
    TransactionAuthenticatorSecp256k1,
} from "./transactions/authenticator";

// --- HTTP Client (low-level) ---
export {
    submitTransaction,
    getLedgerInfo,
    waitForTransaction,
    TransactionTimeoutError,
    TransactionExecutionError,
} from "./api/client";
export type {
    IntentionClientConfig,
    LedgerInfo,
    JsonUnsupportedPayloadFallback,
    SubmitTransactionArgs,
    TransactionSubmissionEncoding,
} from "./api/client";

export {
    Intention,
    IntentionConfig,
    IntentionApiType,
    Network,
} from "./api/intention";

export { IntentionWebSocketClient } from "./api/websocketClient";
export type {
    IntentionWebSocketChannel,
    IntentionWebSocketMessage,
    WebSocketLike,
    WebSocketFactory,
    WebSocketSubscriptionHandlers,
    IntentionWebSocketClientOptions,
} from "./api/websocketClient";
export type {
    IntentionConfigArgs,
    DexOrderlessSubmitOptions,
    DexOrderlessExecutionOptions,
    DexOrderlessExecutionResult,
} from "./api/intention";

// --- Unified user-facing facade ---
export {
    IntentionClient,
    IntentionAccountsClient,
    IntentionMarketsClient,
    TraderClient,
} from "./api/intentionClient";
export type {
    IntentionClientOptions,
    TraderClientOptions,
    TraderSetLeverageInput,
    TraderSetPositionModeInput,
    TraderSetMarginModeInput,
    TraderAdjustIsolatedMarginInput,
} from "./api/intentionClient";

// --- Vault API client ---
export {
    VaultClient,
} from "./api/vaultClient";
export type {
    VaultState,
    VaultSummary,
    VaultDetail,
    DepositorPosition,
    VaultDepositor,
    SubaccountIdResponse,
    VaultPosition,
    VaultAccountPositions,
    VaultAssetPosition,
    VaultPerpetualPosition,
    VaultOrder,
    VaultAccountOrders,
    VaultClpConfig,
    ClpAllowlistEntry,
} from "./api/vaultClient";

// =============================================================================
// Explorer-compatible exports (ported from @intention-ts-sdk)
// =============================================================================

// --- Hex utilities ---
export { Hex, HexInvalidReason, hexToAsciiString } from "./core/hex";
export type { HexInput } from "./core/hex";
export { ParsingError } from "./core/common";
export type { ParsingResult } from "./core/common";

// --- Explorer types (Block, TransactionResponse union, etc.) ---
export {
    TransactionResponseType,
    DeriveScheme,
    isBlockMetadataTransactionResponse,
    isUserTransactionResponse,
    isPendingTransactionResponse,
} from "./types/explorerTypes";
export type {
    Block,
    TransactionResponse,
    PendingTransactionResponse,
    CommittedTransactionResponse,
    UserTransactionResponse,
    GenesisTransactionResponse,
    BlockMetadataTransactionResponse,
    StateCheckpointTransactionResponse,
    ValidatorTransactionResponse,
    BlockEpilogueTransactionResponse,
    WriteSetChange,
    Event,
} from "./types/explorerTypes";

// --- TypeTag system ---
export {
    TypeTag,
    TypeTagBool,
    TypeTagU8,
    TypeTagU16,
    TypeTagU32,
    TypeTagU64,
    TypeTagU128,
    TypeTagU256,
    TypeTagI8,
    TypeTagI16,
    TypeTagI32,
    TypeTagI64,
    TypeTagI128,
    TypeTagI256,
    TypeTagAddress,
    TypeTagSigner,
    TypeTagVector,
    TypeTagStruct,
    TypeTagGeneric,
    TypeTagVariants,
    StructTag,
    parseTypeTag,
    TypeTagParserError,
    TypeTagParserErrorType,
} from "./transactions/typeTag";

// --- DEX Events (BCS-encoded event types and decode functions) ---
export {
    // Transfer events
    decodeInternalTransferEvent,
    decodeAccountTransferEvent,
    decodeCrossTransferEvent,
    decodeFaucetMintEvent,
    // System config events
    decodeCreateSpotEvent,
    decodeCreatePerpetualEvent,
    decodeUpdateLeverageEvent,
    decodeSetAccountFeeRateEvent,
    decodeSetFeeConfigEvent,
    decodeUpdateBridgeSignersEvent,
    decodeSetBridgeFeesEvent,
    decodeSetFaucetMintEnabledEvent,
    decodeSetSymbolTradingPolicyEvent,
    decodeSetSymbolLeverageTierEvent,
    decodeSetSymbolDisplayInfoEvent,
    decodeSymbolOpenedEvent,
    // Listing governance + batch events
    decodeBatchSystemConfigEvent,
    decodeBatchOpFailedEvent,
    // User config events
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
    // Trading events
    decodeOrderPlacedEvent,
    decodeOrderFilledEvent,
    decodeOrderCancelledEvent,
    decodeOrderAmendedEvent,
    decodeOrderRejectedEvent,
    decodeConditionOrderPlacedEvent,
    decodeConditionOrderActivatedEvent,
    decodeConditionOrderParentReboundEvent,
    decodeConditionOrderTriggeredEvent,
    decodeWholePositionOcoUpdatedEvent,
    decodeFillEvent,
    decodeFundingRateEvent,
    decodeAccountUpdatedEvent,
    // Account authority (native multisig) events
    decodeAuthorityChangedEvent,
    decodeMultisigOperationExecutedEvent,
} from "./events/events";
export type {
    InternalTransferEvent,
    AccountTransferEvent,
    CrossTransferEvent,
    FaucetMintEvent,
    SuccessEvent,
    SetSymbolTradingPolicyEvent,
    SetSymbolLeverageTierEvent,
    SetSymbolDisplayInfoEvent,
    SymbolOpenedEvent,
    BatchSystemConfigEvent,
    BatchOpFailedEvent,
    CreateSubAccountEvent,
    ModifySubAccountEvent,
    SetUserLeverageEvent,
    ChangePositionModeEvent,
    ChangeMarginModeEvent,
    AdjustIsolatedMarginEvent,
    VaultCreatedEvent,
    VaultUpdatedEvent,
    VaultDepositedEvent,
    VaultWithdrawRequestedEvent,
    VaultWithdrawCompletedEvent,
    VaultWithdrawErrorEvent,
    VaultSharesBurnedEvent,
    VaultLeaderFeePaidEvent,
    VaultDistributeEvent,
    VaultDistributeDepositorEvent,
    SubaccountId,
    OrderPlacedEvent,
    OrderFilledEvent,
    OrderCancelledEvent,
    OrderAmendedEvent,
    OrderRejectedEvent,
    ConditionOrderPlacedEvent,
    ConditionOrderActivatedEvent,
    ConditionOrderParentReboundEvent,
    ConditionOrderTriggeredEvent,
    WholePositionOcoUpdatedEvent,
    FillEvent,
    FundingRateEvent,
    AccountUpdatedEvent,
    AuthorityChangedEvent,
    MultisigOperationExecutedEvent,
} from "./events/events";

// --- DEX Event Decoder (unified BCS event parser for REST API format) ---
export {
    decodeDexEvent,
    decodeTransactionEvents,
    isDexEvent,
    validateAdlExecutionEventChunks,
} from "./events/dexEventDecoder";
export type {
    DecodedDexEvent,
    DexEventType,
    DexSubaccountId,
    DexAssetPosition,
    DexPerpPosition,
    DexLeverageInfo,
    DexSymbolLeverage,
    DexSymbolMarginMode,
    DexDailyVolumeBucket,
    DexParentVolumeInfo,
    DexMarkPriceInfo,
    DexIndexPriceInfo,
    DexFundingPredictionInfo,
    DexFillEvent,
    DexOrderPlacedEvent,
    DexOrderCancelledEvent,
    DexOrderAmendedEvent,
    DexOrderRejectedEvent,
    DexOrderFilledEvent,
    DexConditionOrderPlacedEvent,
    DexConditionOrderActivatedEvent,
    DexConditionOrderParentReboundEvent,
    DexConditionOrderTriggeredEvent,
    DexWholePositionOcoUpdatedEvent,
    DexFundingRateEvent,
    DexAccountEvent,
    DexMarkPriceEvent,
    DexIndexPriceEvent,
    DexFundingPredictionEvent,
    DexSetSymbolTradingPolicyEvent,
    DexSetSymbolLeverageTierEvent,
    DexSetSymbolDisplayInfoEvent,
    DexSymbolOpenedEvent,
    DexDelistingPlanSetEvent,
    DexDelistingPricedEvent,
    DexDelistingSettledEvent,
    DexDelistingSettledLeg,
    DexSymbolClosedEvent,
    DexLiquidationTriggerMark,
    DexLiquidationRiskTransferEvent,
    DexLiquidationInternalOffsetEvent,
    DexLiquidationFailedEvent,
    DexLiquidationDirectAdlEvent,
    DexAdlExecutionEvent,
    DexAdlEventId,
    DexAdlSelectedPrefixHeader,
    DexAdlAuditEntry,
    DexAdlVaultTakeoverFill,
    DexAdlVaultInitializedEvent,
    DexAdlPositionKey,
    DexAdlAccountLocator,
    DexAdlQueueKey,
    DexAdlSourceLocator,
    DexAdlDirectLiquidationLocator,
    DexAdlSignedValue,
    DexFeeStatementEvent,
    DexAdminControlInitializedEvent,
    DexAdminControlEnabledEvent,
    DexAdminActionScheduledEvent,
    DexAdminActionExecutedEvent,
    DexAdminActionCancelledEvent,
    DexAdminActionExpiredEvent,
    DexAdminActionInvalidatedEvent,
    DexAdminControlCommitteeUpdatedEvent,
    DexAdminControlPolicyUpdatedEvent,
    DexFeeConfigUpdatedEvent,
    DexAdminControlRoleUpdatedEvent,
} from "./events/dexEventDecoder";

// --- Backward-compatible aliases ---
export { IntentionConfig as intentionConfig } from "./api/intention";

export * from "./transactions/typedData";

export type {
    DexVaultInternalOffsetEvent,
} from "./events/vaultEvents";
// --- Native multisig accounts ---
export {
    // Wire types
    DexMultisigTx,
    GatedPayload,
    MultisigOp,
    MultisigOpCreate,
    MultisigOpInstall,
    MultisigOpUpdatePolicy,
    MultisigOpRemove,
    MultisigOpRotateKey,
    MultisigOpExecute,
    MultisigProof,
    KeyProof,
    KeyProofSecp256k1,
    KeyProofEd25519,
    // Identity and ids
    multisigOperationId,
    opKindByte,
    submitOperationName,
    deriveMultisigAccountAddress,
    multisigOwnersDigest,
    dexAuthorityRawKey,
    dexMultisigOpUsedRawKey,
    // Helpers
    ownerBytes,
    evmSignatureFromCompact,
    validateMultisigPolicy,
    multisigReasonName,
    MultisigErrorCode,
    MULTISIG_AUTHORIZATION_VERSION,
    AUTHORITY_VERSION,
    MAX_POLICY_OWNERS,
    MAX_PROOF_VALIDITY_SECS,
    DEX_AUTHORITY_PREFIX,
    DEX_MULTISIG_OP_USED_PREFIX,
    MULTISIG_ADDRESS_DOMAIN,
} from "./transactions/multisigPayloads";
export type {
    EvmSignature,
    GatedPayloadInner,
    AccountAuthority,
    MultisigPolicy,
} from "./transactions/multisigPayloads";
export {
    MULTISIG_TYPES,
    approvalTypedData,
    approvalDigest,
    createTypedData,
    createApprovalDigest,
    keyChallengeTypedData,
    keyChallengeDigest,
    keyChallengeBytes,
    submitTypedDataMessage,
    submitStructHash,
    recoverEvmAddress,
    recoveredOwner,
} from "./transactions/multisigTypedData";
export type {
    MultisigTypedData,
    MultisigTypeSpec,
} from "./transactions/multisigTypedData";

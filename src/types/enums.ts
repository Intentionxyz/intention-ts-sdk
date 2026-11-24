// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * DEX Enums - All enum types used in DEX transactions.
 */

// --- Order Enums ---

export enum Side {
    Unspecified = 0,
    Buy = 1,
    Sell = 2,
    CloseallLong = 3,
    CloseallShort = 4,
}

export enum OrderBasicType {
    Unspecified = 0,
    Market = 1,
    Limit = 2,
}

export enum TimeInForce {
    Unspecified = 0,
    Ioc = 1,
    Fok = 2,
    Aon = 3,
    Gtc = 4,
    Alo = 5,
    Gtd = 6,
    Gtb = 7,
}

/**
 * Condition type for conditional orders
 */
export enum ConditionType {
    Unspecified = 0,
    StopLoss = 1,
    TakeProfit = 2,
}

/**
 * Which price source to use for conditional order trigger
 */
export enum TriggerPriceType {
    LastPrice = 0,
    MarkPrice = 1,
}

export enum SymbolType {
    Unspecified = 0,
    Spot = 1,
    Perpetual = 2,
}

export enum MarginMode {
    Cross = 0,
    Isolated = 1,
    Portfolio = 2,
}

/**
 * DEX Order Position Mode
 */
export enum OrderPositionMode {
    Net = 0,
    Hedge = 1,
}

/**
 * Grouping identifies the take-profit / stop-loss order type.
 *
 * Used on-chain in convert_to_engine_orders to compute parent_order_id
 * and is_activated for the engine Order. This field is NOT forwarded
 * to the trading engine directly.
 */
export enum Grouping {
    /** Standalone orders. May include optional TP/SL. No limit on order count. */
    NA = 0,
    /**
     * Normal take-profit / stop-loss grouping.
     * The first order must be a normal order (condition_type = Unspecified),
     * followed by at most 1 TakeProfit and 1 StopLoss order. Max 3 orders total.
     */
    NormalTPSL = 1,
    /**
     * Position-level take-profit / stop-loss grouping.
     * Only TakeProfit and StopLoss orders are allowed.
     * At most 1 TakeProfit and 1 StopLoss order. Max 2 orders total.
     */
    PositionTPSL = 2,
}

/**
 * Self-Trade Prevention mode (per-order).
 * Determines behavior when a taker order would match against
 * the same account's resting maker order.
 */
export enum StpMode {
    /** Cancel incoming taker, maker stays on book */
    ExpireTaker = 0,
    /** Cancel resting maker, taker continues matching (default) */
    ExpireMaker = 1,
    /** Cancel both sides */
    ExpireBoth = 2,
}

/**
 * Order creation source
 */
export enum CreatedBy {
    User = 0,
    Liquidation = 1,
    Adl = 2,
    Condition = 3,
    Stop = 4,
}

export enum AccountType {
    Perp = 0,
    Spot = 1,
}

/**
 * CrossTransferOption enum for cross-chain transfers
 */
export enum CrossTransferOption {
    Mint = 0,
    Burn = 1,
}

// --- Transaction Variant Enums ---

export enum DexOrdersVariant {
    Place = 0,
    Cancel = 1,
    Replace = 2,
    ReplaceCondition = 3,
    /**
     * The same orders as a replace, except that the engine rejects a replacement which would
     * cross the book instead of filling it. A separate variant rather than a flag on the order
     * because BCS reads a struct as a fixed-length sequence, so a tail field is not optional on
     * the wire.
     */
    ReplaceMakerOnly = 4,
    /**
     * Carries no orders. Consuming its `(sender, nonce)` is the whole effect, and that is what
     * cancels a same-nonce order which has not reached a block yet: the two race for the nonce
     * and the loser is discarded as `NONCE_ALREADY_USED`.
     */
    Noop = 5,
}

/**
 * The chain's `DexOrderlessTx` variant tags. Renumbered once, with the chain reset that removed
 * the business Vault variants; from here on, append only and never reorder.
 */
export enum DexOrderlessTxVariant {
    Dex = 0,
    DexUserConfig = 1,
    DexSystemConfig = 2,
    DexTransfer = 3,
    DexAgent = 4,
    /** Managing a multisig account, or acting as one. */
    Multisig = 5,
    /** Validator operations. Listed so the numbering is complete; this SDK does not build them. */
    Validator = 6,
}

export enum DexTransferVariant {
    InternalTransfer = 0,
    AccountTransfer = 1,
    CrossTransfer = 2,
    FaucetMint = 3,
    ClaimReferralRewards = 4,
}

export enum AgentOperationVariant {
    Approve = 0,
    Revoke = 1,
    /**
     * End every grant this master holds, in one operation.
     *
     * Appended, so `Approve` and `Revoke` keep their tags. It carries no name:
     * the operation names an end state rather than a record, so it is
     * idempotent - an account holding no grants succeeds without writing
     * anything. Modelled as a `Revoke` with an empty name it would be answered
     * `DexAgentNotFound`, an error aimed at the target of a request that was
     * actually shaped wrong.
     */
    RevokeAll = 2,
}

// --- Multisig account enums ----------------------------------------------
//
// Matches the on-chain multisig protocol. The numbering is consensus
// critical twice over: it is the BCS variant tag, and `MultisigOp::kind` /
// `GatedPayload::kind` are bound into the operation id owners sign. Append
// only; never renumber. (`GatedPayload` was renumbered once, with the chain
// reset that removed its business Vault variant.)

/** What a `Multisig` transaction asks for. */
export enum MultisigOpVariant {
    /** Install a policy on a fresh derived address. */
    Create = 0,
    /** Put an existing key-controlled account under a policy, address kept. */
    Install = 1,
    /** Change the owner set or the threshold. */
    UpdatePolicy = 2,
    /** Leave the policy and hand the account to one named key. */
    Remove = 3,
    /** Rotate a single-key account's control key without changing its address. */
    RotateKey = 4,
    /** Run one gated payload as the account. */
    Execute = 5,
}

/**
 * A payload a policy account executes through its owners. The tag is also the
 * payload's kind: an `Execute` binds `16 + tag` into the operation id.
 */
export enum GatedPayloadVariant {
    DexTransfer = 0,
    DexAgent = 1,
    CreateSubAccount = 2,
    /** Validator key rotation. Listed so the numbering is complete; this SDK does not build it. */
    Validator = 3,
}

/** How an incoming control key proves it can sign. */
export enum KeyProofVariant {
    Secp256k1 = 0,
    Ed25519 = 1,
}

/** What controls an account, as reported in an authority record or event. */
export enum AuthorityKindVariant {
    /** One key, named explicitly. */
    Key = 0,
    /** A k-of-n owner set. */
    Policy = 1,
}

export enum DexUserConfigTxVariant {
    SetUserLeverage = 0,
    ChangePositionMode = 1,
    ChangeMarginMode = 2,
    CreateSubAccount = 3,
    ModifySubAccount = 4,
    AdjustIsolatedMargin = 5,
    RegisterReferralCode = 6,
    BindReferrer = 7,
}

/**
 * Perpetual/Spot symbol status, as the chain numbers it. A value this SDK does not know may
 * still arrive from the chain; keep it as a number rather than failing.
 */
export enum SymbolStatus {
    Active = 0,
    Paused = 1,
    /** @deprecated The chain calls status 2 ReduceOnly; use `SymbolStatus.ReduceOnly`. */
    CancelOnly = 2,
    /** Only reduce-only orders are accepted; a delisting sets it at T0 - lead. */
    ReduceOnly = 2,
    PostOnly = 3,
    Initializing = 4,
    /** A delisted market settling every position at its final price; set by the engine only. */
    FinalSettlement = 5,
    PreOpen = 6,
    /** A delisted market, closed for good; set by the engine only. */
    Closed = 7,
}

/**
 * Perpetual tier types
 */
export enum PerpetualTier {
    A = 0,
    B = 1,
    C = 2,
    D = 3,
    E = 4,
    F = 5,
    G = 6,
    H = 7,
    I = 8,
    J = 9,
    K = 10,
    L = 11,
    M = 12,
    N = 13,
    O = 14,
    P = 15,
    Q = 16,
    R = 17,
    S = 18,
    T = 19,
    U = 20,
    V = 21,
    W = 22,
    X = 23,
    Y = 24,
    Z = 25,
}

/**
 * Default margin mode type for a perpetual contract (on-chain MarginModeType).
 * Note: This is NOT the same as the account-level MarginMode enum used in ChangeMarginMode.
 */
export enum MarginModeType {
    Isolated = 0,
    Cross = 1,
    Portfolio = 2,
}

// NOTE: the system-config transaction sub-variant enum was removed together
// with the system-config transaction builders - the
// SDK no longer constructs admin/config transactions. The on-chain orderless
// variant tag `DexOrderlessTxVariant.DexSystemConfig = 2` is kept for wire
// completeness; system-config access is gated on-chain by RBAC.

export enum TransactionPayloadVariants {
    Script = 0,
    EntryFunction = 2,
    Multisig = 3,
    Payload = 4,
    DexOrderless = 5,
}

/**
 * Position mode for ChangePositionMode config.
 */
export enum PositionMode {
    Net = 0,
    Hedge = 1,
}

/**
 * Signing scheme input for account generation.
 */
export enum SigningSchemeInput {
    Ed25519 = 0,
    Secp256k1Ecdsa = 2,
}

// -- ADL execution contract --

export enum AdlSign {
    Zero = 0,
    Positive = 1,
    Negative = 2,
}

export enum AdlExecutionPass {
    NetExposure = 1,
    HedgeUnwind = 2,
}

export enum AdlExecutionStatus {
    Executed = 1,
    PartialExecuted = 2,
    Skipped = 3,
    Boundary = 4,
}

export enum AdlStopReason {
    TargetFilled = 1,
    RankedPassesExhausted = 2,
}

export enum AdlSkipReasonCode {
    None = 0,
    PositionNotFound = 1,
    InsufficientReducibleSize = 2,
    SideMismatch = 3,
    AccountStateChanged = 4,
    BelowMinFillSize = 5,
    OtherCanProcessFailed = 6,
}

export enum AdlPositionSide {
    Long = 1,
    Short = 2,
}

export enum AdlMarginMode {
    Cross = 0,
    Isolated = 1,
    Portfolio = 2,
}

export enum AdlTriggerSource {
    LiquidationResidual = 1,
    BackstopLossThreshold = 2,
    BackstopPositionLimit = 3,
    Manual = 4,
}

export enum AdlSourceKind {
    DirectLiquidation = 3,
}

// -- Delisting --

/** Where a delisting's final price came from (`DelistingPricedEvent.priceSource`). */
export enum DelistingPriceSource {
    /** The TWAP over the price window. */
    WindowTwap = 0,
    /** No sample in the window: the index price of the block that reached T0. */
    T0Index = 1,
    /** No index on chain either: the current mark price. */
    CurrentMark = 2,
}

/** A settled leg's side (`DexDelistingSettledLeg.side`). */
export enum DelistingLegSide {
    Long = 0,
    Short = 1,
}

/** A settled leg's margin mode (`DexDelistingSettledLeg.marginMode`). */
export enum DelistingLegMarginMode {
    Cross = 0,
    Isolated = 1,
}

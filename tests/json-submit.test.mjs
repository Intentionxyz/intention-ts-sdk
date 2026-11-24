import assert from "node:assert/strict";
import test from "node:test";

import {
    Account,
    AccountAddress,
    AccountType,
    AccountTransferItem,
    AgentApprove,
    AgentOperationVariant,
    AgentRevoke,
    BridgeProof,
    BridgeSignature,
    ChainId,
    ConditionType,
    CreatedBy,
    CrossTransferItem,
    CrossTransferOption,
    DexCancelOrder,
    InternalTransferItem,
    DexOrderlessTx,
    DexOrderlessTxVariant,
    DexOrders,
    DexOrdersVariant,
    DexAgentTx,
    DexPlaceOrder,
    DexPlaceOrders,
    DexReplaceOrder,
    DexTransferTx,
    DexTransferVariant,
    DexTx,
    DexUserConfigTx,
    DexUserConfigTxVariant,
    ChangePositionMode,
    ChangeMarginMode,
    CreateSubAccount,
    ModifySubAccount,
    AdjustIsolatedMargin,
    SetUserLeverage,
    StpMode,
    UserSymbolLeverage,
    SymbolMarginMode,
    MarginMode,
    SymbolStatus,
    PerpetualTier,
    generateSignedTransaction,
    generateSigningMessageForTransaction,
    generateSubmitTransactionRequest,
    Grouping,
    Intention,
    IntentionConfig,
    MarginModeType,
    OrderBasicType,
    OrderPositionMode,
    RawTransaction,
    Secp256k1PrivateKey,
    Side,
    SimpleTransaction,
    submitTransaction,
    SymbolType,
    TimeInForce,
    EntryFunction,
    TransactionPayloadDexOrderless,
    TransactionPayloadEntryFunction,
    TriggerPriceType,
    DexMultisigTx,
    GatedPayload,
    KeyProofEd25519,
    KeyProofSecp256k1,
    MultisigOpCreate,
    MultisigOpExecute,
    MultisigOpInstall,
    MultisigOpRemove,
    MultisigOpRotateKey,
    MultisigOpUpdatePolicy,
    MultisigProof,
} from "../dist/esm/index.mjs";

const CLIENT_ORDER_ID = "0x0123456789abcdef0123456789abcdef";
const NEW_CLIENT_ORDER_ID = "0xfedcba9876543210fedcba9876543210";
const NONCE = 123456789n;
const CROSS_TRANSFER_REPLAY_NONCE = 9001n;
const AGENT_NAME = "review-agent";
const AGENT_ADDRESS = AccountAddress.fromString(
    "0x2222222222222222222222222222222222222222222222222222222222222222",
);
const AGENT_EXPIRY = 9_999_999_999n;

function hex(bytes) {
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function buildPlaceOrder(timeInForce, overrides = {}) {
    return new DexPlaceOrder(
        overrides.subAddress ?? AccountAddress.ZERO,
        overrides.symbolId ?? 7,
        overrides.symbolType ?? SymbolType.Perpetual,
        overrides.side ?? Side.Buy,
        overrides.quantums ?? 1000n,
        overrides.subticks ?? 2000n,
        overrides.triggerSubticks ?? 0n,
        overrides.orderBasicType ?? OrderBasicType.Limit,
        timeInForce,
        overrides.conditionType ?? ConditionType.Unspecified,
        overrides.triggerPriceType ?? TriggerPriceType.LastPrice,
        overrides.targetOrderId ?? 0n,
        overrides.reduceOnly ?? false,
        overrides.positionMode ?? OrderPositionMode.Net,
        overrides.slippageTolerancePpm ?? 100_000,
        overrides.clientOrderId ?? CLIENT_ORDER_ID,
        overrides.stpMode ?? StpMode.ExpireMaker,
    );
}

function buildPlaceTransaction(timeInForce, overrides = {}) {
    const order = buildPlaceOrder(timeInForce, overrides);
    return buildPlaceTransactionFromGroups(
        [new DexPlaceOrders([order], Grouping.NA)],
        { onBehalfOf: overrides.onBehalfOf },
    );
}

function buildPlaceTransactionFromGroups(groups, options = {}) {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const dexTx = new DexTx(
        NONCE,
        new DexOrders(DexOrdersVariant.Place, groups),
        CreatedBy.User,
        options.onBehalfOf,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.Dex, dexTx),
    );
    const rawTransaction = RawTransaction.createOrderless(
        account.accountAddress,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { account, transaction, senderAuthenticator };
}

function buildCancelByClientOrderIdTransaction() {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const cancelOrder = DexCancelOrder.byClientOrderId(
        AccountAddress.ZERO,
        CLIENT_ORDER_ID,
        SymbolType.Perpetual,
    );
    const dexTx = new DexTx(
        NONCE,
        new DexOrders(DexOrdersVariant.Cancel, [cancelOrder]),
        CreatedBy.User,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.Dex, dexTx),
    );
    const rawTransaction = RawTransaction.createOrderless(
        account.accountAddress,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { account, transaction, senderAuthenticator };
}

function buildReplaceByClientOrderIdTransaction() {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const replaceOrder = DexReplaceOrder.byClientOrderId(
        AccountAddress.ZERO,
        CLIENT_ORDER_ID,
        3000n,
        4000n,
        NEW_CLIENT_ORDER_ID,
    );
    const dexTx = new DexTx(
        NONCE,
        new DexOrders(DexOrdersVariant.Replace, [replaceOrder]),
        CreatedBy.User,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.Dex, dexTx),
    );
    const rawTransaction = RawTransaction.createOrderless(
        account.accountAddress,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { account, transaction, senderAuthenticator };
}

function buildReplaceByOrderIdTransaction() {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const replaceOrder = DexReplaceOrder.byOrderId(
        AccountAddress.ZERO,
        42n,
        1,
        SymbolType.Perpetual,
        3000n,
        4000n,
        NEW_CLIENT_ORDER_ID,
    );
    const dexTx = new DexTx(
        NONCE,
        new DexOrders(DexOrdersVariant.Replace, [replaceOrder]),
        CreatedBy.User,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.Dex, dexTx),
    );
    const rawTransaction = RawTransaction.createOrderless(
        account.accountAddress,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { transaction, senderAuthenticator };
}

function buildAgentApproveTransaction() {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const agentTx = new DexAgentTx(
        NONCE,
        AgentOperationVariant.Approve,
        new AgentApprove(AGENT_NAME, AGENT_ADDRESS, AGENT_EXPIRY),
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexAgent, agentTx),
    );
    const rawTransaction = RawTransaction.createOrderless(
        account.accountAddress,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { account, transaction, senderAuthenticator };
}

function buildAgentRevokeTransaction() {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const agentTx = new DexAgentTx(
        NONCE,
        AgentOperationVariant.Revoke,
        new AgentRevoke(AGENT_NAME),
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexAgent, agentTx),
    );
    const rawTransaction = RawTransaction.createOrderless(
        account.accountAddress,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { account, transaction, senderAuthenticator };
}

function buildDexTransferTransaction(transfer) {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer),
    );
    const rawTransaction =
        transfer.variant === DexTransferVariant.CrossTransfer
            ? RawTransaction.createCrossTransferOrderless(
                  account.accountAddress,
                  payload,
                  CROSS_TRANSFER_REPLAY_NONCE,
                  200000n,
                  100n,
                  9999999999n,
                  new ChainId(4),
              )
            : RawTransaction.createOrderless(
                  account.accountAddress,
                  payload,
                  200000n,
                  100n,
                  9999999999n,
                  new ChainId(4),
              );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { account, transaction, senderAuthenticator };
}

function buildDexUserConfigTransaction(variant, configPayload) {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const userConfigTx = new DexUserConfigTx(variant, configPayload);
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexUserConfig, userConfigTx),
    );
    const rawTransaction = RawTransaction.createOrderless(
        account.accountAddress,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { account, transaction, senderAuthenticator };
}

function buildBridgeProofCrossTransferTransaction() {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const transfer = new DexTransferTx(
        NONCE,
        DexTransferVariant.CrossTransfer,
        [
            new CrossTransferItem(
                account.accountAddress,
                0,
                1000n,
                AccountType.Perp,
            ),
        ],
        CrossTransferOption.Mint,
        new BridgeProof(
            new Uint8Array(32).fill(1),
            1n,
            [
                new BridgeSignature(
                    new Uint8Array(32).fill(2),
                    new Uint8Array(32).fill(3),
                    27,
                ),
            ],
        ),
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer),
    );
    const rawTransaction = RawTransaction.createCrossTransferOrderless(
        account.accountAddress,
        payload,
        CROSS_TRANSFER_REPLAY_NONCE,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { account, transaction, senderAuthenticator };
}

function buildUnsupportedEntryFunctionTransaction() {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const entryFunction = new EntryFunction(
        AccountAddress.fromString("0x1"),
        "primary_fungible_store",
        "transfer",
        [],
        [],
    );
    const payload = new TransactionPayloadEntryFunction(entryFunction);
    const rawTransaction = new RawTransaction(
        account.accountAddress,
        0n,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    return { account, transaction, senderAuthenticator };
}

test("generates JSON submit request for a GTC Dex place order", () => {
    const { account, transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.sender, account.accountAddress.toString());
    assert.equal(request.sequence_number, "18446744073709551615");
    assert.equal(request.max_gas_amount, "200000");
    assert.equal(request.gas_unit_price, "100");
    assert.equal(request.expiration_timestamp_secs, "9999999999");
    assert.equal(request.replay_protection_nonce, NONCE.toString());
    assert.equal(request.payload.type, "dex_orderless_payload");
    assert.equal(request.payload.dex_type, "dex_payload");
    assert.equal(request.payload.operation, "place");
    assert.equal(request.payload.nonce, NONCE.toString());
    assert.equal(request.payload.created_by, CreatedBy.User);

    const [order] = request.payload.orders;
    assert.equal(order.symbol_id, 7);
    assert.equal(order.symbol_type, SymbolType.Perpetual);
    assert.equal(order.side, Side.Buy);
    assert.equal(order.quantums, "1000");
    assert.equal(order.subticks, "2000");
    assert.equal(order.time_in_force, TimeInForce.Gtc);
    assert.equal(order.client_order_id, CLIENT_ORDER_ID);
});

test("generates JSON place order_groups while retaining flat orders", () => {
    const firstOrder = buildPlaceOrder(TimeInForce.Gtc);
    const secondOrder = buildPlaceOrder(TimeInForce.Gtc, {
        symbolId: 8,
        side: Side.Sell,
        quantums: 3000n,
        subticks: 4000n,
        clientOrderId: NEW_CLIENT_ORDER_ID,
    });
    const { transaction, senderAuthenticator } = buildPlaceTransactionFromGroups(
        [
            new DexPlaceOrders([firstOrder], Grouping.NA),
            new DexPlaceOrders([secondOrder], Grouping.NA),
        ],
        { onBehalfOf: AGENT_ADDRESS },
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.payload.operation, "place");
    assert.equal(request.payload.nonce, NONCE.toString());
    assert.equal(request.payload.created_by, CreatedBy.User);
    assert.equal(request.payload.on_behalf_of, AGENT_ADDRESS.toString());
    assert.equal(request.replay_protection_nonce, NONCE.toString());
    assert.equal(request.signature.type, "secp256k1_ecdsa_signature");

    assert.equal(request.payload.orders.length, 2);
    assert.equal(request.payload.orders[0].client_order_id, CLIENT_ORDER_ID);
    assert.equal(request.payload.orders[1].client_order_id, NEW_CLIENT_ORDER_ID);

    assert.equal(request.payload.order_groups.length, 2);
    assert.deepEqual(request.payload.order_groups, [
        {
            grouping: Grouping.NA,
            orders: [request.payload.orders[0]],
        },
        {
            grouping: Grouping.NA,
            orders: [request.payload.orders[1]],
        },
    ]);
});

test("generates JSON submit request for an ALO Dex place order", () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Alo,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    const [order] = request.payload.orders;
    assert.equal(order.time_in_force, TimeInForce.Alo);
});

test("rejects JSON submit request with invalid time_in_force", () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(99);

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /Invalid time_in_force: 99/,
    );
});

test("rejects JSON submit request with invalid side", () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
        { side: 99 },
    );

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /Invalid side: 99/,
    );
});

test("rejects JSON submit request with invalid order_basic_type", () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
        { orderBasicType: 99 },
    );

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /Invalid order_basic_type: 99/,
    );
});

test("rejects JSON submit request with invalid position_mode", () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
        { positionMode: 99 },
    );

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /Invalid position_mode: 99/,
    );
});

test("rejects JSON submit request with invalid condition_type", () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
        { conditionType: 99 },
    );

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /Invalid condition_type: 99/,
    );
});

test("rejects JSON submit request with invalid trigger_price_type", () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
        { triggerPriceType: 99 },
    );

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /Invalid trigger_price_type: 99/,
    );
});

test("rejects JSON submit request with invalid stp_mode", () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
        { stpMode: 99 },
    );

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /Invalid stp_mode: 99/,
    );
});

test("rejects place order group with invalid grouping at construction", () => {
    const order = new DexPlaceOrder(
        AccountAddress.ZERO,
        7,
        SymbolType.Perpetual,
        Side.Buy,
        1000n,
        2000n,
        0n,
        OrderBasicType.Limit,
        TimeInForce.Gtc,
        ConditionType.Unspecified,
        TriggerPriceType.LastPrice,
        0n,
        false,
        OrderPositionMode.Net,
        100_000,
        CLIENT_ORDER_ID,
    );

    assert.throws(() => new DexPlaceOrders([order], 99), /Unknown grouping type: 99/);
});

test("generates JSON submit request for a Dex cancel by client order id", () => {
    const { transaction, senderAuthenticator } = buildCancelByClientOrderIdTransaction();

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.payload.operation, "cancel");
    assert.equal(request.payload.nonce, NONCE.toString());
    assert.equal(request.payload.created_by, CreatedBy.User);
    assert.equal("order_groups" in request.payload, false);

    const [order] = request.payload.orders;
    assert.equal(order.sub_address, "0x0");
    assert.deepEqual(order.target, {
        target_type: "client_order_id",
        client_order_id: CLIENT_ORDER_ID,
    });
    assert.equal(order.symbol_type, SymbolType.Perpetual);
});

test("generates JSON submit request for a Dex replace by client order id", () => {
    const { transaction, senderAuthenticator } = buildReplaceByClientOrderIdTransaction();

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.payload.operation, "replace");
    assert.equal(request.payload.nonce, NONCE.toString());
    assert.equal(request.payload.created_by, CreatedBy.User);
    assert.equal("order_groups" in request.payload, false);

    const [order] = request.payload.orders;
    assert.equal(order.sub_address, "0x0");
    assert.deepEqual(order.target, {
        target_type: "client_order_id",
        client_order_id: CLIENT_ORDER_ID,
    });
    assert.equal(order.quantums, "3000");
    assert.equal(order.subticks, "4000");
    assert.equal(order.new_client_order_id, NEW_CLIENT_ORDER_ID);
});

test("generates JSON submit request for a Dex replace with order id context", () => {
    const { transaction, senderAuthenticator } = buildReplaceByOrderIdTransaction();
    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    const [order] = request.payload.orders;
    assert.deepEqual(order.target, {
        target_type: "order_id_with_context",
        target_order_id: "42",
        symbol_id: 1,
        symbol_type: SymbolType.Perpetual,
    });
});

test("generates JSON submit request for a Dex agent approve", () => {
    const { transaction, senderAuthenticator } = buildAgentApproveTransaction();

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_agent_payload",
        agent_operation: "approve",
        nonce: NONCE.toString(),
        name: AGENT_NAME,
        agent_address: AGENT_ADDRESS.toStringLong(),
        expiry_timestamp: AGENT_EXPIRY.toString(),
    });
    assert.equal(request.replay_protection_nonce, NONCE.toString());
});

test("generates JSON submit request for a Dex agent revoke", () => {
    const { transaction, senderAuthenticator } = buildAgentRevokeTransaction();

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_agent_payload",
        agent_operation: "revoke",
        nonce: NONCE.toString(),
        name: AGENT_NAME,
    });
    assert.equal(request.replay_protection_nonce, NONCE.toString());
});

test("generates JSON submit request for an internal DexTransfer", () => {
    const subaccount = AccountAddress.fromString(
        "0x3333333333333333333333333333333333333333333333333333333333333333",
    );
    const transfer = new DexTransferTx(
        NONCE,
        DexTransferVariant.InternalTransfer,
        [
            new InternalTransferItem(
                AccountAddress.ZERO,
                subaccount,
                42,
                1234567890123456789n,
                AccountType.Spot,
            ),
        ],
    );
    const { transaction, senderAuthenticator } = buildDexTransferTransaction(transfer);

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_transfer_payload",
        transfer_type: "internal_transfer",
        nonce: NONCE.toString(),
        transfers: [
            {
                from_subaccount: "0x0",
                to_subaccount: subaccount.toStringLong(),
                asset_id: 42,
                amount: "1234567890123456789",
                account_type: "spot",
            },
        ],
    });
    assert.equal(request.replay_protection_nonce, NONCE.toString());
});

test("generates JSON submit request for an account DexTransfer", () => {
    const targetAccount = AccountAddress.fromString(
        "0x4444444444444444444444444444444444444444444444444444444444444444",
    );
    const transfer = new DexTransferTx(
        NONCE,
        DexTransferVariant.AccountTransfer,
        [
            new AccountTransferItem(
                targetAccount,
                7,
                9007199254740993123n,
                AccountType.Perp,
            ),
        ],
    );
    const { transaction, senderAuthenticator } = buildDexTransferTransaction(transfer);

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_transfer_payload",
        transfer_type: "account_transfer",
        nonce: NONCE.toString(),
        transfers: [
            {
                to_account: targetAccount.toStringLong(),
                asset_id: 7,
                amount: "9007199254740993123",
                account_type: "perp",
            },
        ],
    });
});

test("generates JSON submit request for a no-proof cross DexTransfer", () => {
    const targetAccount = AccountAddress.fromString(
        "0x5555555555555555555555555555555555555555555555555555555555555555",
    );
    const transfer = new DexTransferTx(
        NONCE,
        DexTransferVariant.CrossTransfer,
        [
            new CrossTransferItem(
                targetAccount,
                99,
                5000000000000000000n,
                AccountType.Spot,
            ),
        ],
        CrossTransferOption.Burn,
    );
    const { transaction, senderAuthenticator } = buildDexTransferTransaction(transfer);

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_transfer_payload",
        transfer_type: "cross_transfer",
        nonce: NONCE.toString(),
        option: "burn",
        transfers: [
            {
                to_account: targetAccount.toStringLong(),
                asset_id: 99,
                amount: "5000000000000000000",
                account_type: "spot",
            },
        ],
    });
});

test("CrossTransfer signs its explicit replay nonce instead of MAX_U64", () => {
    const transfer = new DexTransferTx(
        42n,
        DexTransferVariant.CrossTransfer,
        [
            new CrossTransferItem(
                AccountAddress.fromString(
                    "0x5555555555555555555555555555555555555555555555555555555555555555",
                ),
                99,
                5000000n,
                AccountType.Spot,
            ),
        ],
        CrossTransferOption.Burn,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer),
    );

    const rawTransaction = RawTransaction.createCrossTransferOrderless(
        AccountAddress.ZERO,
        payload,
        9001n,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );

    assert.equal(rawTransaction.sequence_number, 9001n);
    assert.equal(transfer.nonce, 42n);
});

test("CrossTransfer JSON keeps replay and business nonces independent", () => {
    const account = Account.fromPrivateKey({
        privateKey: new Secp256k1PrivateKey(
            "0x1111111111111111111111111111111111111111111111111111111111111111",
        ),
    });
    const transfer = new DexTransferTx(
        42n,
        DexTransferVariant.CrossTransfer,
        [
            new CrossTransferItem(
                account.accountAddress,
                99,
                5000000n,
                AccountType.Spot,
            ),
        ],
        CrossTransferOption.Burn,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer),
    );
    const rawTransaction = RawTransaction.createCrossTransferOrderless(
        account.accountAddress,
        payload,
        9001n,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.sequence_number, "9001");
    assert.equal(request.replay_protection_nonce, "9001");
    assert.equal(request.payload.nonce, "42");
});

test("CrossTransfer BCS and JSON preserve the same signed RawTransaction", () => {
    const transfer = new DexTransferTx(
        42n,
        DexTransferVariant.CrossTransfer,
        [new CrossTransferItem(AccountAddress.ZERO, 99, 5000000n, AccountType.Spot)],
        CrossTransferOption.Burn,
    );
    const { transaction, senderAuthenticator } = buildDexTransferTransaction(transfer);
    const rawBytes = transaction.rawTransaction.bcsToBytes();
    const signingMessageBeforeJson = generateSigningMessageForTransaction(transaction);
    const signedBcsBeforeJson = generateSignedTransaction({
        transaction,
        senderAuthenticator,
    });

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(
        generateSigningMessageForTransaction(transaction),
        signingMessageBeforeJson,
    );
    assert.deepEqual(
        generateSignedTransaction({ transaction, senderAuthenticator }),
        signedBcsBeforeJson,
    );
    assert.deepEqual(
        signedBcsBeforeJson.slice(0, rawBytes.length),
        rawBytes,
    );
    assert.equal(request.sequence_number, CROSS_TRANSFER_REPLAY_NONCE.toString());
    assert.equal(request.replay_protection_nonce, CROSS_TRANSFER_REPLAY_NONCE.toString());
    assert.equal(request.payload.nonce, "42");
});

test("CrossTransfer replay nonce API rejects ordinary orderless payloads", () => {
    const { transaction } = buildPlaceTransaction(TimeInForce.Gtc);

    assert.throws(
        () =>
            RawTransaction.createCrossTransferOrderless(
                transaction.rawTransaction.sender,
                transaction.rawTransaction.payload,
                9001n,
                200000n,
                100n,
                9999999999n,
                new ChainId(4),
            ),
        /requires a CrossTransfer orderless payload/,
    );
});

test("CrossTransfer cannot omit its replay nonce through the ordinary orderless API", () => {
    const transfer = new DexTransferTx(
        42n,
        DexTransferVariant.CrossTransfer,
        [
            new CrossTransferItem(
                AccountAddress.ZERO,
                99,
                5000000n,
                AccountType.Spot,
            ),
        ],
        CrossTransferOption.Burn,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer),
    );

    assert.throws(
        () =>
            RawTransaction.createOrderless(
                AccountAddress.ZERO,
                payload,
                200000n,
                100n,
                9999999999n,
                new ChainId(4),
            ),
        /CrossTransfer requires an explicit replay nonce/,
    );
});

test("CrossTransfer rejects a missing explicit replay nonce before signing", () => {
    const transfer = new DexTransferTx(
        42n,
        DexTransferVariant.CrossTransfer,
        [new CrossTransferItem(AccountAddress.ZERO, 99, 5000000n, AccountType.Spot)],
        CrossTransferOption.Burn,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer),
    );

    assert.throws(
        () =>
            RawTransaction.createCrossTransferOrderless(
                AccountAddress.ZERO,
                payload,
                undefined,
                200000n,
                100n,
                9999999999n,
                new ChainId(4),
            ),
        /CrossTransfer replay nonce is required/,
    );
});

test("CrossTransfer rejects replay nonces outside the u64 range before signing", () => {
    const transfer = new DexTransferTx(
        42n,
        DexTransferVariant.CrossTransfer,
        [new CrossTransferItem(AccountAddress.ZERO, 99, 5000000n, AccountType.Spot)],
        CrossTransferOption.Burn,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer),
    );

    for (const replayNonce of [-1n, 18446744073709551616n]) {
        assert.throws(
            () =>
                RawTransaction.createCrossTransferOrderless(
                    AccountAddress.ZERO,
                    payload,
                    replayNonce,
                    200000n,
                    100n,
                    9999999999n,
                    new ChainId(4),
                ),
            /CrossTransfer replay nonce must be in the u64 range/,
        );
    }
});

test("CrossTransfer rejects the reserved MAX_U64 replay nonce before signing", () => {
    const transfer = new DexTransferTx(
        42n,
        DexTransferVariant.CrossTransfer,
        [new CrossTransferItem(AccountAddress.ZERO, 99, 5000000n, AccountType.Spot)],
        CrossTransferOption.Burn,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer),
    );

    assert.throws(
        () =>
            RawTransaction.createCrossTransferOrderless(
                AccountAddress.ZERO,
                payload,
                18446744073709551615n,
                200000n,
                100n,
                9999999999n,
                new ChainId(4),
            ),
        /CrossTransfer replay nonce must not use the reserved MAX_U64 value/,
    );
});

test("generates JSON submit request for a faucet mint DexTransfer", () => {
    const targetAccount = AccountAddress.fromString(
        "0x6666666666666666666666666666666666666666666666666666666666666666",
    );
    const transfer = new DexTransferTx(
        NONCE,
        DexTransferVariant.FaucetMint,
        [
            new CrossTransferItem(
                targetAccount,
                5,
                18446744073709551615n,
                AccountType.Perp,
            ),
        ],
    );
    const { transaction, senderAuthenticator } = buildDexTransferTransaction(transfer);

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_transfer_payload",
        transfer_type: "faucet_mint",
        nonce: NONCE.toString(),
        transfers: [
            {
                to_account: targetAccount.toStringLong(),
                asset_id: 5,
                amount: "18446744073709551615",
                account_type: "perp",
            },
        ],
    });
});

test("generates Secp256k1 JSON signature fields from the local authenticator", () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.signature, {
        type: "secp256k1_ecdsa_signature",
        public_key: hex(senderAuthenticator.public_key.publicKey.toUint8Array()),
        signature: hex(senderAuthenticator.signature.signature.data),
    });
    assert.equal(request.signature.public_key.length, 132);
    assert.equal(request.signature.signature.length, 130);
});

test("generates JSON cancel signature fields from the local authenticator", () => {
    const { transaction, senderAuthenticator } = buildCancelByClientOrderIdTransaction();

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.payload.operation, "cancel");
    assert.deepEqual(request.signature, {
        type: "secp256k1_ecdsa_signature",
        public_key: hex(senderAuthenticator.public_key.publicKey.toUint8Array()),
        signature: hex(senderAuthenticator.signature.signature.data),
    });
});

test("generates JSON submit request for a bridge proof cross-transfer", () => {
    const { transaction, senderAuthenticator } =
        buildBridgeProofCrossTransferTransaction();

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.sequence_number, CROSS_TRANSFER_REPLAY_NONCE.toString());
    assert.equal(request.replay_protection_nonce, CROSS_TRANSFER_REPLAY_NONCE.toString());
    assert.equal(request.payload.nonce, NONCE.toString());
    assert.equal(request.payload.transfer_type, "cross_transfer");
    assert.equal(request.payload.option, "mint");
    assert.deepEqual(request.payload.bridge_proof, {
        msg_id: `0x${"01".repeat(32)}`,
        signer_epoch: "1",
        signatures: [
            {
                r: `0x${"02".repeat(32)}`,
                s: `0x${"03".repeat(32)}`,
                v: 27,
            },
        ],
    });
});

test("BridgeSignature rejects a non-32-byte r at construction", () => {
    assert.throws(
        () => new BridgeSignature(new Uint8Array(31), new Uint8Array(32), 27),
        /BridgeSignature r must be exactly 32 bytes/,
    );
});

test("BridgeProof rejects a non-32-byte msgId at construction", () => {
    assert.throws(
        () => new BridgeProof(new Uint8Array(31), 1n, []),
        /BridgeProof msgId must be exactly 32 bytes/,
    );
});

test("bridge proof cross-transfer still serializes to BCS", () => {
    const { transaction } = buildBridgeProofCrossTransferTransaction();

    const bcs = transaction.rawTransaction.bcsToBytes();

    assert.ok(bcs instanceof Uint8Array);
    assert.ok(bcs.length > 0);
});

test("generates JSON submit request for a ChangePositionMode user config", () => {
    const tx = new ChangePositionMode(
        NONCE,
        AccountAddress.ZERO,
        OrderPositionMode.Hedge,
    );
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        DexUserConfigTxVariant.ChangePositionMode,
        tx,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_user_config_payload",
        user_config_type: "change_position_mode",
        nonce: NONCE.toString(),
        sub_address: "0x0",
        position_mode: OrderPositionMode.Hedge,
    });
    assert.equal(request.replay_protection_nonce, NONCE.toString());
});

test("generates JSON submit request for a SetUserLeverage user config", () => {
    const leverage = new UserSymbolLeverage(7, 10);
    const tx = new SetUserLeverage(NONCE, AccountAddress.ZERO, [leverage]);
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        DexUserConfigTxVariant.SetUserLeverage,
        tx,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    // im_leverage / exponent must come straight from the BCS-serialized values
    // so JSON and BCS submission describe an identical SymbolLeverage.
    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_user_config_payload",
        user_config_type: "set_user_leverage",
        nonce: NONCE.toString(),
        sub_address: "0x0",
        leverage_info: [
            {
                symbol_id: 7,
                tier: 0,
                min_notional: "0",
                max_notional: "0",
                im_leverage: leverage.imLeverage,
                mm_leverage: 0,
                exponent: leverage.exponent,
                maintenance_deduction: "0",
            },
        ],
    });
    assert.equal(request.replay_protection_nonce, NONCE.toString());
});

test("generates JSON submit request for a SetUserLeverage user config with on_behalf_of", () => {
    const master = AccountAddress.fromString(
        "0x4444444444444444444444444444444444444444444444444444444444444444",
    );
    const tx = new SetUserLeverage(
        NONCE,
        AccountAddress.ZERO,
        [new UserSymbolLeverage(3, 20)],
        master,
    );
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        DexUserConfigTxVariant.SetUserLeverage,
        tx,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.equal(request.payload.on_behalf_of, master.toStringLong());
});

test("generates JSON submit request for a ChangeMarginMode user config", () => {
    const tx = new ChangeMarginMode(NONCE, AccountAddress.ZERO, [
        new SymbolMarginMode(7, MarginMode.Isolated),
    ]);
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        DexUserConfigTxVariant.ChangeMarginMode,
        tx,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_user_config_payload",
        user_config_type: "change_margin_mode",
        nonce: NONCE.toString(),
        sub_address: "0x0",
        margin_modes: [{ symbol_id: 7, margin_mode: MarginMode.Isolated }],
    });
    assert.equal(request.replay_protection_nonce, NONCE.toString());
});

test("generates JSON submit request for a CreateSubAccount user config", () => {
    const tx = new CreateSubAccount(NONCE, "trading-sub");
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        DexUserConfigTxVariant.CreateSubAccount,
        tx,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_user_config_payload",
        user_config_type: "create_sub_account",
        nonce: NONCE.toString(),
        name: "trading-sub",
    });
    assert.equal(request.replay_protection_nonce, NONCE.toString());
});

test("generates JSON submit request for a ModifySubAccount user config", () => {
    const subaccount = AccountAddress.fromString(
        "0x3333333333333333333333333333333333333333333333333333333333333333",
    );
    const master = AccountAddress.fromString(
        "0x4444444444444444444444444444444444444444444444444444444444444444",
    );
    const tx = new ModifySubAccount(NONCE, "renamed-sub", subaccount, master);
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        DexUserConfigTxVariant.ModifySubAccount,
        tx,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_user_config_payload",
        user_config_type: "modify_sub_account",
        nonce: NONCE.toString(),
        name: "renamed-sub",
        sub_address: subaccount.toStringLong(),
        on_behalf_of: master.toStringLong(),
    });
    assert.equal(request.replay_protection_nonce, NONCE.toString());
});

test("rejects JSON submit request with invalid position_mode in user config", () => {
    const tx = new ChangePositionMode(NONCE, AccountAddress.ZERO, 99);
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        DexUserConfigTxVariant.ChangePositionMode,
        tx,
    );

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /Invalid position_mode: 99/,
    );
});

test("rejects JSON submit request with invalid margin_mode in user config", () => {
    const tx = new ChangeMarginMode(NONCE, AccountAddress.ZERO, [
        new SymbolMarginMode(7, 99),
    ]);
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        DexUserConfigTxVariant.ChangeMarginMode,
        tx,
    );

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /Invalid margin_mode: 99/,
    );
});

test("generates JSON submit request for an AdjustIsolatedMargin user config", () => {
    const tx = new AdjustIsolatedMargin(NONCE, AccountAddress.ZERO, 7, 100000n, -50000n);
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        DexUserConfigTxVariant.AdjustIsolatedMargin,
        tx,
    );

    const request = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });

    assert.deepEqual(request.payload, {
        type: "dex_orderless_payload",
        dex_type: "dex_user_config_payload",
        user_config_type: "adjust_isolated_margin",
        nonce: NONCE.toString(),
        sub_address: "0x0",
        symbol_id: 7,
        delta_long: 100000,
        delta_short: -50000,
    });
    assert.equal(request.replay_protection_nonce, NONCE.toString());
});

test("rejects JSON submit request for an unknown DexUserConfig variant", () => {
    const UNKNOWN_VARIANT = 99;
    const { transaction, senderAuthenticator } = buildDexUserConfigTransaction(
        UNKNOWN_VARIANT,
        new CreateSubAccount(NONCE, "placeholder"),
    );

    assert.throws(
        () => generateSubmitTransactionRequest({ transaction, senderAuthenticator }),
        /JSON submit request does not support DexUserConfig payloads \(unknown variant\); submit this transaction with BCS/,
    );
});

test("submitTransaction keeps signed BCS bytes on the BCS submit path", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xabc" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const signedBytes = new Uint8Array([1, 2, 3]);
        const response = await submitTransaction(
            { nodeUrl: "http://node.test" },
            signedBytes,
        );

        assert.equal(response.hash, "0xabc");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "http://node.test/transactions");
        assert.equal(
            calls[0].init.headers["Content-Type"],
            "application/x.intention.signed_transaction+bcs",
        );
        assert.equal(calls[0].init.body, signedBytes);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("submitTransaction submits local signed transaction args as JSON by default", async () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
    );
    const expectedBody = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xdefaultjson" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await submitTransaction(
            { nodeUrl: "http://node.test" },
            { transaction, senderAuthenticator },
        );

        assert.equal(response.hash, "0xdefaultjson");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "http://node.test/transactions");
        assert.equal(calls[0].init.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(calls[0].init.body), expectedBody);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("submitTransaction uses BCS when encoding is explicit bcs", async () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xbcs" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await submitTransaction(
            { nodeUrl: "http://node.test" },
            { transaction, senderAuthenticator, encoding: "bcs" },
        );

        assert.equal(response.hash, "0xbcs");
        assert.equal(calls.length, 1);
        assert.equal(
            calls[0].init.headers["Content-Type"],
            "application/x.intention.signed_transaction+bcs",
        );
        assert.ok(calls[0].init.body instanceof Uint8Array);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("submitTransaction can submit a local signed transaction as JSON", async () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
    );
    const expectedBody = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xdef" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await submitTransaction(
            { nodeUrl: "http://node.test" },
            { transaction, senderAuthenticator, encoding: "json" },
        );

        assert.equal(response.hash, "0xdef");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "http://node.test/transactions");
        assert.equal(calls[0].init.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(calls[0].init.body), expectedBody);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple submits JSON by default", async () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
    );
    const expectedBody = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });
    const intention = new Intention(
        new IntentionConfig({ fullnode: "http://node.test" }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0x123" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await intention.transaction.submit.simple({
            transaction,
            senderAuthenticator,
        });

        assert.equal(response.hash, "0x123");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].init.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(calls[0].init.body), expectedBody);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple submits Dex agent approve as JSON by default", async () => {
    const { transaction, senderAuthenticator } = buildAgentApproveTransaction();
    const expectedBody = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });
    const intention = new Intention(
        new IntentionConfig({ fullnode: "http://node.test" }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xagent" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await intention.transaction.submit.simple({
            transaction,
            senderAuthenticator,
        });

        assert.equal(response.hash, "0xagent");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].init.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(calls[0].init.body), expectedBody);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple submits Dex agent revoke as JSON by default", async () => {
    const { transaction, senderAuthenticator } = buildAgentRevokeTransaction();
    const expectedBody = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });
    const intention = new Intention(
        new IntentionConfig({ fullnode: "http://node.test" }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xagentrevoke" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await intention.transaction.submit.simple({
            transaction,
            senderAuthenticator,
        });

        assert.equal(response.hash, "0xagentrevoke");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].init.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(calls[0].init.body), expectedBody);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple keeps Dex agent approve on BCS when encoding is explicit bcs", async () => {
    const { transaction, senderAuthenticator } = buildAgentApproveTransaction();
    const intention = new Intention(
        new IntentionConfig({ fullnode: "http://node.test" }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xagentbcs" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await intention.transaction.submit.simple({
            transaction,
            senderAuthenticator,
            encoding: "bcs",
        });

        assert.equal(response.hash, "0xagentbcs");
        assert.equal(calls.length, 1);
        assert.equal(
            calls[0].init.headers["Content-Type"],
            "application/x.intention.signed_transaction+bcs",
        );
        assert.ok(calls[0].init.body instanceof Uint8Array);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple submits JSON when encoding is explicit json", async () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
    );
    const expectedBody = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });
    const intention = new Intention(
        new IntentionConfig({ fullnode: "http://node.test" }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xjson" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await intention.transaction.submit.simple({
            transaction,
            senderAuthenticator,
            encoding: "json",
        });

        assert.equal(response.hash, "0xjson");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].init.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(calls[0].init.body), expectedBody);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple uses config default submission encoding", async () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
    );
    const expectedBody = generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator,
    });
    const intention = new Intention(
        new IntentionConfig({
            fullnode: "http://node.test",
            defaultSubmissionEncoding: "json",
        }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xconfig" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await intention.transaction.submit.simple({
            transaction,
            senderAuthenticator,
        });

        assert.equal(response.hash, "0xconfig");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].init.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(calls[0].init.body), expectedBody);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple lets explicit bcs override config default json", async () => {
    const { transaction, senderAuthenticator } = buildPlaceTransaction(
        TimeInForce.Gtc,
    );
    const intention = new Intention(
        new IntentionConfig({
            fullnode: "http://node.test",
            defaultSubmissionEncoding: "json",
        }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xoverride" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await intention.transaction.submit.simple({
            transaction,
            senderAuthenticator,
            encoding: "bcs",
        });

        assert.equal(response.hash, "0xoverride");
        assert.equal(calls.length, 1);
        assert.equal(
            calls[0].init.headers["Content-Type"],
            "application/x.intention.signed_transaction+bcs",
        );
        assert.ok(calls[0].init.body instanceof Uint8Array);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple keeps DexTransfer variants on BCS when encoding is explicit bcs", async () => {
    const transfers = [
        new DexTransferTx(
            NONCE,
            DexTransferVariant.InternalTransfer,
            [
                new InternalTransferItem(
                    AccountAddress.ZERO,
                    AccountAddress.fromString(
                        "0x7777777777777777777777777777777777777777777777777777777777777777",
                    ),
                    1,
                    100n,
                    AccountType.Perp,
                ),
            ],
        ),
        new DexTransferTx(
            NONCE,
            DexTransferVariant.AccountTransfer,
            [
                new AccountTransferItem(
                    AccountAddress.fromString(
                        "0x8888888888888888888888888888888888888888888888888888888888888888",
                    ),
                    2,
                    200n,
                    AccountType.Spot,
                ),
            ],
        ),
        new DexTransferTx(
            NONCE,
            DexTransferVariant.CrossTransfer,
            [
                new CrossTransferItem(
                    AccountAddress.fromString(
                        "0x9999999999999999999999999999999999999999999999999999999999999999",
                    ),
                    3,
                    300n,
                    AccountType.Perp,
                ),
            ],
            CrossTransferOption.Burn,
        ),
        new DexTransferTx(
            NONCE,
            DexTransferVariant.FaucetMint,
            [
                new CrossTransferItem(
                    AccountAddress.fromString(
                        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    ),
                    4,
                    400n,
                    AccountType.Spot,
                ),
            ],
        ),
    ];
    const intention = new Intention(
        new IntentionConfig({
            fullnode: "http://node.test",
            defaultSubmissionEncoding: "json",
        }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: `0xtransfer${calls.length}` }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        for (const transfer of transfers) {
            const { transaction, senderAuthenticator } =
                buildDexTransferTransaction(transfer);
            await intention.transaction.submit.simple({
                transaction,
                senderAuthenticator,
                encoding: "bcs",
            });
        }

        assert.equal(calls.length, transfers.length);
        for (const call of calls) {
            assert.equal(
                call.init.headers["Content-Type"],
                "application/x.intention.signed_transaction+bcs",
            );
            assert.ok(call.init.body instanceof Uint8Array);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple falls back to BCS for unsupported JSON payload when configured", async () => {
    const { transaction, senderAuthenticator } =
        buildUnsupportedEntryFunctionTransaction();
    const intention = new Intention(
        new IntentionConfig({
            fullnode: "http://node.test",
            defaultSubmissionEncoding: "json",
            jsonUnsupportedPayloadFallback: "bcs",
        }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xfallback" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        const response = await intention.transaction.submit.simple({
            transaction,
            senderAuthenticator,
        });

        assert.equal(response.hash, "0xfallback");
        assert.equal(calls.length, 1);
        assert.equal(
            calls[0].init.headers["Content-Type"],
            "application/x.intention.signed_transaction+bcs",
        );
        assert.ok(calls[0].init.body instanceof Uint8Array);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("transaction.submit.simple does not fallback when json encoding is explicit", async () => {
    const { transaction, senderAuthenticator } =
        buildUnsupportedEntryFunctionTransaction();
    const intention = new Intention(
        new IntentionConfig({
            fullnode: "http://node.test",
            defaultSubmissionEncoding: "json",
            jsonUnsupportedPayloadFallback: "bcs",
        }),
    );
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ hash: "0xunexpected" }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        await assert.rejects(
            () =>
                intention.transaction.submit.simple({
                    transaction,
                    senderAuthenticator,
                    encoding: "json",
                }),
            /JSON submit request does not support non-Dex orderless payloads; submit this transaction with BCS/,
        );
        assert.equal(calls.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});


// ---- multisig ------------------------------------------------------------
//
// A multisig payload has two shapes that are not interchangeable: what the
// chain *renders* is a summary (the operation as a name, the approvals as a
// count), and what a caller *submits* must say exactly what is authorized and
// carry the approvals. These check the second one.
//
// Field drift here is not a formatting problem. The owners signed
// keccak256(BCS(op)), and the node rebuilds that value out of this JSON, so a
// field renamed or left out changes the operation id -- which the chain reports
// as a proof naming a different operation rather than as a parse error.

const MS_ACCOUNT = AccountAddress.fromString(
    "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
);
const MS_OWNERS = [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
];
const MS_THRESHOLD = 2;
const MS_OP_ID = new Uint8Array(32).fill(0x7e);
const MS_NEW_AUTH_KEY = new Uint8Array(32).fill(0xcc);

function msSignature(fill) {
    return new BridgeSignature(
        new Uint8Array(32).fill(fill),
        new Uint8Array(32).fill(fill + 1),
        27,
    );
}

function buildMultisigTransaction(op, { proof = true } = {}) {
    const account = Account.fromPrivateKey({
        privateKey: new Secp256k1PrivateKey(
            "0x1111111111111111111111111111111111111111111111111111111111111111",
        ),
    });
    const tx = new DexMultisigTx(
        NONCE,
        MS_ACCOUNT,
        op,
        proof
            ? new MultisigProof(MS_OP_ID, 3n, 9_999_999_999n, [
                  msSignature(0x41),
                  msSignature(0x61),
              ])
            : undefined,
    );
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(DexOrderlessTxVariant.Multisig, tx),
    );
    const rawTransaction = new RawTransaction(
        account.accountAddress,
        0n,
        payload,
        200000n,
        100n,
        9999999999n,
        new ChainId(4),
    );
    const transaction = new SimpleTransaction(rawTransaction);
    const senderAuthenticator = account.signTransactionWithAuthenticator(transaction);
    return generateSubmitTransactionRequest({ transaction, senderAuthenticator });
}

test("generates a JSON submit request for an owner-set change", () => {
    const request = buildMultisigTransaction(
        new MultisigOpUpdatePolicy(MS_OWNERS.slice(0, 2), MS_THRESHOLD),
    );

    assert.equal(request.payload.type, "dex_orderless_payload");
    assert.equal(request.payload.dex_type, "multisig_payload");
    assert.equal(request.payload.account, MS_ACCOUNT.toString());
    assert.equal(request.payload.nonce, NONCE.toString());
    // The summary half stays in the body: the node ignores it on submission,
    // and leaving it out would make a submitted payload and a rendered one two
    // shapes rather than one with two halves.
    assert.equal(request.payload.operation, "update_policy");
    assert.equal(request.payload.signatures_count, 2);

    assert.equal(request.payload.op.operation, "update_policy");
    assert.deepEqual(request.payload.op.owners, [
        // Owners travel padded to thirty-two bytes, the width the chain stores.
        "0x0000000000000000000000001111111111111111111111111111111111111111",
        "0x0000000000000000000000002222222222222222222222222222222222222222",
    ]);
    assert.equal(request.payload.op.threshold, MS_THRESHOLD);

    assert.equal(request.payload.proof.op_id, hex(MS_OP_ID));
    assert.equal(request.payload.proof.authority_epoch, "3");
    assert.equal(request.payload.proof.expires_at_secs, "9999999999");
    // One approval is sixty-five bytes of r || s || v, not three fields: the
    // node reads the compact form, and splitting it here would be a second
    // layout to keep in step with the one the owners signed.
    assert.equal(request.payload.proof.signatures.length, 2);
    assert.equal(request.payload.proof.signatures[0].length, 2 + 65 * 2);
    assert.ok(request.payload.proof.signatures[0].endsWith("1b"));
});

test("generates a JSON submit request for a policy on a fresh address", () => {
    const request = buildMultisigTransaction(
        new MultisigOpCreate(MS_OWNERS, MS_THRESHOLD, new Uint8Array(32).fill(0x5a)),
    );

    assert.equal(request.payload.op.operation, "create_policy");
    assert.equal(request.payload.op.owners.length, 3);
    assert.equal(request.payload.op.salt, hex(new Uint8Array(32).fill(0x5a)));
});

test("generates a JSON submit request for installing a policy", () => {
    const request = buildMultisigTransaction(
        new MultisigOpInstall(MS_OWNERS, MS_THRESHOLD),
    );

    assert.equal(request.payload.op.operation, "install_policy");
    assert.equal(request.payload.op.owners.length, 3);
    assert.equal(request.payload.op.threshold, MS_THRESHOLD);
});

test("renders the incoming key's challenge answer for both schemes", () => {
    const secp = buildMultisigTransaction(
        new MultisigOpRemove(MS_NEW_AUTH_KEY, new KeyProofSecp256k1(msSignature(0x81))),
    );
    assert.equal(secp.payload.op.operation, "remove_policy");
    assert.equal(secp.payload.op.new_auth_key, hex(MS_NEW_AUTH_KEY));
    assert.equal(secp.payload.op.new_key_proof.scheme, "secp256k1");
    assert.equal(secp.payload.op.new_key_proof.signature.length, 2 + 65 * 2);

    const ed = buildMultisigTransaction(
        new MultisigOpRotateKey(
            MS_NEW_AUTH_KEY,
            new KeyProofEd25519(new Uint8Array(32).fill(0xed), new Uint8Array(64).fill(0xee)),
        ),
    );
    assert.equal(ed.payload.op.operation, "rotate_key");
    // Ed25519 carries the public key because the authentication key is a hash
    // of it and cannot be recovered from the signature.
    assert.equal(ed.payload.op.new_key_proof.scheme, "ed25519");
    assert.equal(ed.payload.op.new_key_proof.public_key, hex(new Uint8Array(32).fill(0xed)));
    assert.equal(ed.payload.op.new_key_proof.signature, hex(new Uint8Array(64).fill(0xee)));
});

test("leaves the proof out of a rotation submitted without approvals", () => {
    const request = buildMultisigTransaction(
        new MultisigOpRotateKey(MS_NEW_AUTH_KEY, new KeyProofSecp256k1(msSignature(0x81))),
        { proof: false },
    );

    // Absent, not null: a null is a different value to the node.
    assert.ok(!("proof" in request.payload));
    assert.ok(!("authority_epoch" in request.payload));
    assert.equal(request.payload.signatures_count, 0);
});

test("renders a gated payload as the transaction it is, by variant", () => {
    const transfer = buildMultisigTransaction(
        new MultisigOpExecute(
            GatedPayload.transfer(
                new DexTransferTx(NONCE, DexTransferVariant.AccountTransfer, [
                    new AccountTransferItem(AGENT_ADDRESS, 0, 5000000n, AccountType.Perp),
                ]),
            ),
        ),
    );

    assert.equal(transfer.payload.operation, "execute_transfer");
    assert.equal(transfer.payload.op.operation, "execute");
    // The inner payload keeps its own dex_type and loses the outer type: it is
    // the operation being authorized, not a transaction of its own.
    assert.equal(transfer.payload.op.dex_type, "dex_transfer_payload");
    assert.ok(!("type" in transfer.payload.op));
    assert.equal(transfer.payload.op.transfer_type, "account_transfer");
    assert.equal(transfer.payload.op.transfers[0].amount, "5000000");

    const agent = buildMultisigTransaction(
        new MultisigOpExecute(
            GatedPayload.agent(
                new DexAgentTx(
                    NONCE,
                    AgentOperationVariant.Approve,
                    new AgentApprove(AGENT_NAME, AGENT_ADDRESS, AGENT_EXPIRY),
                ),
            ),
        ),
    );

    assert.equal(agent.payload.operation, "execute_agent");
    assert.equal(agent.payload.op.dex_type, "dex_agent_payload");
    assert.equal(agent.payload.op.agent_operation, "approve");
    assert.equal(agent.payload.op.name, AGENT_NAME);
    assert.equal(agent.payload.op.agent_address, AGENT_ADDRESS.toString());
});

test("renders a gated subaccount creation the way the user-config union names it", () => {
    const request = buildMultisigTransaction(
        new MultisigOpExecute(
            GatedPayload.createSubAccount(new CreateSubAccount(NONCE, "desk-one")),
        ),
    );

    assert.equal(request.payload.op.dex_type, "dex_user_config_payload");
    // The union's discriminator, not a name invented here: a gated creation is
    // the same shape the user-config path submits.
    assert.equal(request.payload.op.user_config_type, "create_sub_account");
    assert.equal(request.payload.op.name, "desk-one");
});

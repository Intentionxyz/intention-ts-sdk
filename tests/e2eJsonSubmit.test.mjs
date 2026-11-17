// e2e-style JSON submit tracer for the TS SDK.
//
// Port of the go SDK's api/json_submit_e2e_test.go: no live network - a mock
// `fetch` captures what `intention.transaction.submit.simple` sends. We build
// one signed transaction per DEX orderless payload family, submit it (JSON by
// default), and assert the captured envelope + content-type, plus the explicit
// BCS opt-out. System-config payloads are intentionally excluded (JSON submit
// does not support them).

import assert from "node:assert/strict";
import test from "node:test";

import {
    Account,
    AccountAddress,
    AccountType,
    AgentApprove,
    AgentOperationVariant,
    AgentRevoke,
    AccountTransferItem,
    ChainId,
    ChangeMarginMode,
    ChangePositionMode,
    ConditionType,
    CreateSubAccount,
    CreatedBy,
    CrossTransferItem,
    CrossTransferOption,
    AdjustIsolatedMargin,
    DexAgentTx,
    DexCancelOrder,
    DexOrders,
    DexOrdersVariant,
    DexOrderlessTx,
    DexOrderlessTxVariant,
    DexPlaceOrder,
    DexPlaceOrders,
    DexReplaceOrder,
    DexTransferTx,
    DexTransferVariant,
    DexTx,
    DexUserConfigTx,
    DexUserConfigTxVariant,
    generateSubmitTransactionRequest,
    Grouping,
    InternalTransferItem,
    Intention,
    IntentionConfig,
    MarginMode,
    OrderBasicType,
    OrderPositionMode,
    RawTransaction,
    Secp256k1PrivateKey,
    SetUserLeverage,
    Side,
    SimpleTransaction,
    StpMode,
    SymbolMarginMode,
    SymbolType,
    TimeInForce,
    TransactionPayloadDexOrderless,
    TriggerPriceType,
    UserSymbolLeverage,
    VaultCreateTx,
    VaultDepositTx,
    VaultSetStatusTx,
    VaultStatus,
    VaultTx,
    VaultTxVariant,
    VaultWithdrawTx,
} from "../dist/esm/index.mjs";

const NODE_URL = "http://node.test";
const CLIENT_ORDER_ID = "0x0123456789abcdef0123456789abcdef";
const NEW_CLIENT_ORDER_ID = "0xfedcba9876543210fedcba9876543210";
const NONCE = 1234n;
const CROSS_TRANSFER_REPLAY_NONCE = 9001n;
const AGENT_NAME = "review-agent";
const AGENT_ADDRESS = AccountAddress.fromString(`0x${"22".repeat(32)}`);
const SUBACCOUNT = AccountAddress.fromString(`0x${"33".repeat(32)}`);
const TARGET = AccountAddress.fromString(`0x${"44".repeat(32)}`);

const account = Account.fromPrivateKey({
    privateKey: new Secp256k1PrivateKey(`0x${"11".repeat(32)}`),
});

function signOrderless(inner) {
    const payload = new TransactionPayloadDexOrderless(inner);
    const isCrossTransfer =
        inner.variant === DexOrderlessTxVariant.DexTransfer &&
        inner.inner instanceof DexTransferTx &&
        inner.inner.variant === DexTransferVariant.CrossTransfer;
    const rawTransaction = isCrossTransfer
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
    return { transaction, senderAuthenticator };
}

function placeInner() {
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
        StpMode.ExpireMaker,
    );
    return new DexOrderlessTx(
        DexOrderlessTxVariant.Dex,
        new DexTx(
            NONCE,
            new DexOrders(DexOrdersVariant.Place, [new DexPlaceOrders([order], Grouping.NA)]),
            CreatedBy.User,
        ),
    );
}

function multiGroupPlaceInner() {
    const firstOrder = new DexPlaceOrder(
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
        StpMode.ExpireMaker,
    );
    const secondOrder = new DexPlaceOrder(
        AccountAddress.ZERO,
        8,
        SymbolType.Perpetual,
        Side.Sell,
        3000n,
        4000n,
        0n,
        OrderBasicType.Limit,
        TimeInForce.Gtc,
        ConditionType.Unspecified,
        TriggerPriceType.LastPrice,
        0n,
        false,
        OrderPositionMode.Net,
        100_000,
        NEW_CLIENT_ORDER_ID,
        StpMode.ExpireMaker,
    );
    return new DexOrderlessTx(
        DexOrderlessTxVariant.Dex,
        new DexTx(
            NONCE,
            new DexOrders(DexOrdersVariant.Place, [
                new DexPlaceOrders([firstOrder], Grouping.NA),
                new DexPlaceOrders([secondOrder], Grouping.NA),
            ]),
            CreatedBy.User,
        ),
    );
}

function cancelInner() {
    const cancelOrder = DexCancelOrder.byClientOrderId(
        AccountAddress.ZERO,
        CLIENT_ORDER_ID,
        SymbolType.Perpetual,
    );
    return new DexOrderlessTx(
        DexOrderlessTxVariant.Dex,
        new DexTx(NONCE, new DexOrders(DexOrdersVariant.Cancel, [cancelOrder]), CreatedBy.User),
    );
}

function replaceInner() {
    const replaceOrder = DexReplaceOrder.byClientOrderId(
        AccountAddress.ZERO,
        CLIENT_ORDER_ID,
        3000n,
        4000n,
        NEW_CLIENT_ORDER_ID,
    );
    return new DexOrderlessTx(
        DexOrderlessTxVariant.Dex,
        new DexTx(NONCE, new DexOrders(DexOrdersVariant.Replace, [replaceOrder]), CreatedBy.User),
    );
}

function transferInner(variant, items, option) {
    const transfer =
        option === undefined
            ? new DexTransferTx(NONCE, variant, items)
            : new DexTransferTx(NONCE, variant, items, option);
    return new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, transfer);
}

function agentInner(agentTx) {
    return new DexOrderlessTx(DexOrderlessTxVariant.DexAgent, agentTx);
}

function userConfigInner(variant, inner) {
    return new DexOrderlessTx(
        DexOrderlessTxVariant.DexUserConfig,
        new DexUserConfigTx(variant, inner),
    );
}

function vaultInner(vaultTx) {
    return new DexOrderlessTx(DexOrderlessTxVariant.Vault, vaultTx);
}

// name -> { family, make: () => DexOrderlessTx }
const CASES = [
    { name: "dex_place", family: "dex_payload", make: placeInner },
    { name: "dex_cancel", family: "dex_payload", make: cancelInner },
    { name: "dex_replace", family: "dex_payload", make: replaceInner },
    {
        name: "transfer_internal",
        family: "dex_transfer_payload",
        make: () =>
            transferInner(DexTransferVariant.InternalTransfer, [
                new InternalTransferItem(AccountAddress.ZERO, SUBACCOUNT, 42, 123456789n, AccountType.Spot),
            ]),
    },
    {
        name: "transfer_account",
        family: "dex_transfer_payload",
        make: () =>
            transferInner(DexTransferVariant.AccountTransfer, [
                new AccountTransferItem(TARGET, 7, 9000n, AccountType.Perp),
            ]),
    },
    {
        name: "transfer_cross_burn",
        family: "dex_transfer_payload",
        make: () =>
            transferInner(
                DexTransferVariant.CrossTransfer,
                [new CrossTransferItem(TARGET, 99, 5000n, AccountType.Spot)],
                CrossTransferOption.Burn,
            ),
    },
    {
        name: "transfer_faucet_mint",
        family: "dex_transfer_payload",
        make: () =>
            transferInner(DexTransferVariant.FaucetMint, [
                new CrossTransferItem(TARGET, 5, 400n, AccountType.Perp),
            ]),
    },
    {
        name: "agent_approve",
        family: "dex_agent_payload",
        make: () =>
            agentInner(
                new DexAgentTx(
                    NONCE,
                    AgentOperationVariant.Approve,
                    new AgentApprove(AGENT_NAME, AGENT_ADDRESS, 1700000000n),
                ),
            ),
    },
    {
        name: "agent_revoke",
        family: "dex_agent_payload",
        make: () =>
            agentInner(new DexAgentTx(NONCE, AgentOperationVariant.Revoke, new AgentRevoke(AGENT_NAME))),
    },
    {
        name: "user_change_position_mode",
        family: "dex_user_config_payload",
        make: () =>
            userConfigInner(
                DexUserConfigTxVariant.ChangePositionMode,
                new ChangePositionMode(NONCE, AccountAddress.ZERO, OrderPositionMode.Hedge),
            ),
    },
    {
        name: "user_set_leverage",
        family: "dex_user_config_payload",
        make: () =>
            userConfigInner(
                DexUserConfigTxVariant.SetUserLeverage,
                new SetUserLeverage(NONCE, AccountAddress.ZERO, [new UserSymbolLeverage(7, 10)]),
            ),
    },
    {
        name: "user_change_margin_mode",
        family: "dex_user_config_payload",
        make: () =>
            userConfigInner(
                DexUserConfigTxVariant.ChangeMarginMode,
                new ChangeMarginMode(NONCE, AccountAddress.ZERO, [
                    new SymbolMarginMode(7, MarginMode.Isolated),
                ]),
            ),
    },
    {
        name: "user_create_sub_account",
        family: "dex_user_config_payload",
        make: () =>
            userConfigInner(
                DexUserConfigTxVariant.CreateSubAccount,
                new CreateSubAccount(NONCE, "trading-sub"),
            ),
    },
    {
        name: "user_adjust_isolated_margin",
        family: "dex_user_config_payload",
        make: () =>
            userConfigInner(
                DexUserConfigTxVariant.AdjustIsolatedMargin,
                new AdjustIsolatedMargin(NONCE, AccountAddress.ZERO, 7, 100000n, -50000n),
            ),
    },
    {
        name: "vault_deposit",
        family: "vault_payload",
        make: () => vaultInner(new VaultTx(VaultTxVariant.Deposit, new VaultDepositTx(7n, NONCE, 100000000n))),
    },
    {
        name: "vault_create",
        family: "vault_payload",
        make: () =>
            vaultInner(
                new VaultTx(
                    VaultTxVariant.Create,
                    new VaultCreateTx(NONCE, 86400, true, 5000000000n, "alpha-vault", "delta neutral"),
                ),
            ),
    },
    {
        name: "vault_withdraw",
        family: "vault_payload",
        make: () => vaultInner(new VaultTx(VaultTxVariant.Withdraw, new VaultWithdrawTx(7n, NONCE, 250000n))),
    },
    {
        name: "vault_set_status",
        family: "vault_payload",
        make: () =>
            vaultInner(new VaultTx(VaultTxVariant.SetStatus, new VaultSetStatusTx(NONCE, 7n, VaultStatus.Paused))),
    },
];

const EXPECTED_FAMILIES = [
    "dex_payload",
    "dex_transfer_payload",
    "dex_agent_payload",
    "dex_user_config_payload",
    "vault_payload",
];

function withMockFetch(handler, run) {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return handler();
    };
    return Promise.resolve()
        .then(() => run(calls))
        .finally(() => {
            globalThis.fetch = original;
        });
}

function jsonResponse(hash) {
    return new Response(JSON.stringify({ hash }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
    });
}

test("e2e: every DEX orderless family submits as JSON by default", async () => {
    const intention = new Intention(new IntentionConfig({ fullnode: NODE_URL }));

    await withMockFetch(
        () => jsonResponse("0xjsontracer"),
        async (calls) => {
            const seenFamilies = [];
            for (const tc of CASES) {
                const { transaction, senderAuthenticator } = signOrderless(tc.make());
                const resp = await intention.transaction.submit.simple({
                    transaction,
                    senderAuthenticator,
                });
                assert.equal(resp.hash, "0xjsontracer", `${tc.name} hash`);

                const call = calls[calls.length - 1];
                assert.equal(call.url, `${NODE_URL}/transactions`, `${tc.name} url`);
                assert.equal(
                    call.init.headers["Content-Type"],
                    "application/json",
                    `${tc.name} content-type`,
                );
                const body = JSON.parse(call.init.body);
                assert.equal(body.payload.type, "dex_orderless_payload", `${tc.name} payload.type`);
                assert.equal(body.payload.dex_type, tc.family, `${tc.name} family`);
                assert.notEqual(
                    body.payload.dex_type,
                    "dex_system_config_payload",
                    `${tc.name} must not be system config`,
                );
                if (tc.name === "transfer_cross_burn") {
                    assert.equal(
                        body.sequence_number,
                        CROSS_TRANSFER_REPLAY_NONCE.toString(),
                        `${tc.name} sequence_number`,
                    );
                    assert.equal(
                        body.replay_protection_nonce,
                        CROSS_TRANSFER_REPLAY_NONCE.toString(),
                        `${tc.name} replay_protection_nonce`,
                    );
                    assert.equal(body.payload.nonce, NONCE.toString(), `${tc.name} payload nonce`);
                }
                seenFamilies.push(body.payload.dex_type);
            }

            assert.equal(calls.length, CASES.length);
            assert.deepEqual([...new Set(seenFamilies)], EXPECTED_FAMILIES);
        },
    );
});

test("e2e: place-order JSON envelope carries signed transaction metadata", async () => {
    const intention = new Intention(new IntentionConfig({ fullnode: NODE_URL }));

    await withMockFetch(
        () => jsonResponse("0xenvelope"),
        async (calls) => {
            const { transaction, senderAuthenticator } = signOrderless(placeInner());
            await intention.transaction.submit.simple({ transaction, senderAuthenticator });

            const body = JSON.parse(calls[calls.length - 1].init.body);
            assert.equal(body.sender, account.accountAddress.toString());
            assert.equal(body.sequence_number, "18446744073709551615");
            assert.equal(body.max_gas_amount, "200000");
            assert.equal(body.gas_unit_price, "100");
            assert.equal(body.expiration_timestamp_secs, "9999999999");
            assert.equal(body.replay_protection_nonce, NONCE.toString());
            assert.equal(body.payload.operation, "place");
            assert.equal(body.payload.nonce, NONCE.toString());
            assert.equal(body.signature.type, "secp256k1_ecdsa_signature");
            assert.ok(body.signature.public_key.length > 0);
            assert.ok(body.signature.signature.length > 0);
        },
    );
});

test("e2e: multi-group place submit body is exactly the SDK canonical JSON request", async () => {
    const intention = new Intention(new IntentionConfig({ fullnode: NODE_URL }));

    await withMockFetch(
        () => jsonResponse("0xcanonical"),
        async (calls) => {
            const { transaction, senderAuthenticator } = signOrderless(multiGroupPlaceInner());
            const expectedBody = generateSubmitTransactionRequest({
                transaction,
                senderAuthenticator,
            });

            const response = await intention.transaction.submit.simple({
                transaction,
                senderAuthenticator,
            });

            assert.equal(response.hash, "0xcanonical");
            assert.equal(calls.length, 1);
            const call = calls[0];
            assert.equal(call.url, `${NODE_URL}/transactions`);
            assert.equal(call.init.headers["Content-Type"], "application/json");

            const capturedBody = JSON.parse(call.init.body);
            assert.deepEqual(capturedBody, expectedBody);
            assert.equal(capturedBody.payload.operation, "place");
            assert.equal(capturedBody.payload.order_groups.length, 2);
            assert.deepEqual(
                capturedBody.payload.order_groups.flatMap((group) => group.orders),
                capturedBody.payload.orders,
            );
        },
    );
});

test("e2e: explicit BCS encoding opts out of JSON", async () => {
    const intention = new Intention(new IntentionConfig({ fullnode: NODE_URL }));

    await withMockFetch(
        () => jsonResponse("0xbcs"),
        async (calls) => {
            const { transaction, senderAuthenticator } = signOrderless(placeInner());
            await intention.transaction.submit.simple({
                transaction,
                senderAuthenticator,
                encoding: "bcs",
            });

            const call = calls[calls.length - 1];
            assert.equal(
                call.init.headers["Content-Type"],
                "application/x.intention.signed_transaction+bcs",
            );
            assert.ok(call.init.body instanceof Uint8Array);
        },
    );
});

test("e2e: multi-group place explicit BCS encoding does not send JSON order_groups", async () => {
    const intention = new Intention(new IntentionConfig({ fullnode: NODE_URL }));

    await withMockFetch(
        () => jsonResponse("0xbcs-groups"),
        async (calls) => {
            const { transaction, senderAuthenticator } = signOrderless(multiGroupPlaceInner());
            const response = await intention.transaction.submit.simple({
                transaction,
                senderAuthenticator,
                encoding: "bcs",
            });

            assert.equal(response.hash, "0xbcs-groups");
            assert.equal(calls.length, 1);
            const call = calls[0];
            assert.equal(
                call.init.headers["Content-Type"],
                "application/x.intention.signed_transaction+bcs",
            );
            assert.ok(call.init.body instanceof Uint8Array);
            assert.notEqual(typeof call.init.body, "string");
        },
    );
});

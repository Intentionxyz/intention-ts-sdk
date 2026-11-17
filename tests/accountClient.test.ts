// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    Account,
    AccountAddress,
    AccountClient,
    AccountIntents,
    AccountTransferItem,
    AdjustIsolatedMargin,
    AgentApprove,
    AgentOperationVariant,
    BridgeProof,
    BridgeSignature,
    ChangeMarginMode,
    ChangePositionMode,
    CreateSubAccount,
    CrossTransferItem,
    CrossTransferOption,
    DexAgentTx,
    DexOrderlessTx,
    DexOrderlessTxVariant,
    DexTransferTx,
    DexTransferVariant,
    DexUserConfigTx,
    DexUserConfigTxVariant,
    Intention,
    IntentionConfig,
    InternalTransferItem,
    MarginMode,
    OrderPositionMode,
    SetUserLeverage,
    TransactionPayloadDexOrderless,
    type DexOrderlessExecutionResult,
} from "../src/index";
import type {
    PendingTransactionResponse,
    TransactionResponse,
} from "../src/api/client";
import type { SimpleTransaction } from "../src/transactions/rawTransaction";

const HASH = "0x" + "ab".repeat(32);
const MASTER = Account.generate();
const AGENT = Account.generate();
const SUB_1 = AccountAddress.from("0x" + "11".repeat(20));
const SUB_2 = AccountAddress.from("0x" + "22".repeat(20));

function pending(): PendingTransactionResponse {
    return {
        hash: HASH,
        sender: MASTER.accountAddress.toString(),
        sequence_number: "0",
        max_gas_amount: "5000",
        gas_unit_price: "2000",
        expiration_timestamp_secs: "9999999999",
        payload: {},
        signature: {},
    };
}

function committed(): TransactionResponse {
    return {
        type: "user_transaction",
        version: "1",
        hash: HASH,
        state_change_hash: "0x1",
        event_root_hash: "0x1",
        state_checkpoint_hash: "0x1",
        gas_used: "10",
        success: true,
        vm_status: "Executed successfully",
        accumulator_root_hash: "0x1",
        changes: [],
        sender: MASTER.accountAddress.toString(),
        sequence_number: "0",
        max_gas_amount: "5000",
        gas_unit_price: "2000",
        expiration_timestamp_secs: "9999999999",
        payload: {},
        signature: {},
        events: [],
        timestamp: "1",
    };
}

class FakeIntention {
    readonly config = new IntentionConfig({
        nodeUrl: "https://node.example/v1",
    });
    submitCalls: Array<{ orderlessTx: DexOrderlessTx; options?: unknown }> = [];
    executeCalls: Array<{ orderlessTx: DexOrderlessTx; options?: unknown }> = [];
    result: DexOrderlessExecutionResult = {
        hash: HASH,
        transaction: committed(),
        events: [],
    };

    async submitDexOrderless(args: {
        orderlessTx: DexOrderlessTx;
        options?: unknown;
    }): Promise<PendingTransactionResponse> {
        this.submitCalls.push(args);
        return pending();
    }

    async executeDexOrderless(args: {
        orderlessTx: DexOrderlessTx;
        options?: unknown;
    }): Promise<DexOrderlessExecutionResult> {
        this.executeCalls.push(args);
        return this.result;
    }
}

function client(intention = new FakeIntention()): {
    client: AccountClient;
    intention: FakeIntention;
} {
    return {
        client: new AccountClient({
            intention: intention as unknown as Intention,
            signer: MASTER,
            submitOptions: { gasUnitPrice: 123n },
        }),
        intention,
    };
}

test("AccountIntents builds a create-subaccount orderless transaction", () => {
    const orderless = new AccountIntents().createSubaccount({
        name: "  alpha  ",
        nonce: 7n,
    });

    assert.equal(orderless.variant, DexOrderlessTxVariant.DexUserConfig);
    const config = orderless.inner as DexUserConfigTx;
    assert.equal(config.variant, DexUserConfigTxVariant.CreateSubAccount);
    const payload = config.payload as CreateSubAccount;
    assert.equal(payload.nonce, 7n);
    assert.equal(payload.name, "alpha");
});

test("AccountClient.createSubaccount waits and returns the decoded subaddress", async () => {
    const fake = new FakeIntention();
    fake.result = {
        hash: HASH,
        transaction: committed(),
        events: [
            {
                eventType: "CreateSubAccountEvent",
                event: { subAddress: SUB_1 },
            },
        ],
    };
    const { client: accountClient, intention } = client(fake);

    const result = await accountClient.createSubaccount(
        { name: "alpha", nonce: 8n },
        { timeoutSecs: 12 },
    );

    assert.equal(result.subAddress, SUB_1);
    assert.equal(intention.executeCalls.length, 1);
    assert.deepEqual(intention.executeCalls[0].options, {
        gasUnitPrice: 123n,
        timeoutSecs: 12,
    });
});

test("AccountClient submit methods remain no-wait fast paths", async () => {
    const { client: accountClient, intention } = client();

    const result = await accountClient.submitCreateSubaccount(
        { name: "alpha", nonce: 9n },
        { maxGasAmount: 999n },
    );

    assert.equal(result.hash, HASH);
    assert.equal(intention.submitCalls.length, 1);
    assert.equal(intention.executeCalls.length, 0);
    assert.deepEqual(intention.submitCalls[0].options, {
        gasUnitPrice: 123n,
        maxGasAmount: 999n,
    });
});

test("AccountIntents builds leverage, position-mode and margin-mode configs", () => {
    const intents = new AccountIntents({
        resolver: {
            symbolId(symbol: string): number {
                assert.equal(symbol, "BTC-USDC");
                return 7;
            },
        },
    });

    const leverageConfig = intents.setLeverage({
        subAddress: SUB_1,
        updates: [{ symbol: "BTC-USDC", leverage: "10" }],
        onBehalfOf: MASTER.accountAddress,
        nonce: 20n,
    }).inner as DexUserConfigTx;
    assert.equal(leverageConfig.variant, DexUserConfigTxVariant.SetUserLeverage);
    const leverage = leverageConfig.payload as SetUserLeverage;
    assert.equal(leverage.leverageInfo[0].symbolId, 7);
    assert.equal(leverage.leverageInfo[0].leverage, 10);
    assert.equal(leverage.onBehalfOf, MASTER.accountAddress);

    const positionConfig = intents.setPositionMode({
        subAddress: SUB_1,
        mode: "hedge",
        nonce: 21n,
    }).inner as DexUserConfigTx;
    assert.equal(positionConfig.variant, DexUserConfigTxVariant.ChangePositionMode);
    assert.equal(
        (positionConfig.payload as ChangePositionMode).positionMode,
        OrderPositionMode.Hedge,
    );

    const marginConfig = intents.setMarginMode({
        subAddress: SUB_1,
        updates: [{ symbolId: 7, mode: "isolated" }],
        nonce: 22n,
    }).inner as DexUserConfigTx;
    assert.equal(marginConfig.variant, DexUserConfigTxVariant.ChangeMarginMode);
    const margin = marginConfig.payload as ChangeMarginMode;
    assert.equal(margin.marginModes[0].symbolId, 7);
    assert.equal(margin.marginModes[0].marginMode, MarginMode.Isolated);
});

test("AccountIntents maps isolated-margin actions to signed side deltas", () => {
    const intents = new AccountIntents();
    const addLong = intents.adjustIsolatedMargin({
        subAddress: SUB_1,
        symbolId: 7,
        side: "long",
        action: "add",
        amount: "12.5",
        nonce: 23n,
    }).inner as DexUserConfigTx;
    assert.equal(addLong.variant, DexUserConfigTxVariant.AdjustIsolatedMargin);
    assert.equal((addLong.payload as AdjustIsolatedMargin).deltaLong, 12_500_000n);
    assert.equal((addLong.payload as AdjustIsolatedMargin).deltaShort, 0n);

    const removeShort = intents.adjustIsolatedMargin({
        subAddress: SUB_1,
        symbolId: 7,
        side: "short",
        action: "remove",
        amountAtomic: 3_000_000n,
        nonce: 24n,
    }).inner as DexUserConfigTx;
    assert.equal((removeShort.payload as AdjustIsolatedMargin).deltaLong, 0n);
    assert.equal((removeShort.payload as AdjustIsolatedMargin).deltaShort, -3_000_000n);
});

test("AccountClient configuration methods wait by default and expose submit fast paths", async () => {
    const { client: accountClient, intention } = client();

    await accountClient.setLeverage({
        subAddress: SUB_1,
        updates: [{ symbolId: 7, leverage: 5 }],
    });
    await accountClient.setPositionMode({
        subAddress: SUB_1,
        mode: "one-way",
    });
    await accountClient.setMarginMode({
        subAddress: SUB_1,
        updates: [{ symbolId: 7, mode: "cross" }],
    });
    await accountClient.adjustIsolatedMargin({
        subAddress: SUB_1,
        symbolId: 7,
        side: "long",
        action: "add",
        amountAtomic: 1n,
    });
    await accountClient.submitSetLeverage({
        subAddress: SUB_1,
        updates: [{ symbolId: 7, leverage: "10" }],
    });

    assert.equal(intention.executeCalls.length, 4);
    assert.equal(intention.submitCalls.length, 1);
});

test("AccountIntents validates user-config inputs before signing", () => {
    const intents = new AccountIntents();
    assert.throws(
        () =>
            intents.setLeverage({
                subAddress: SUB_1,
                updates: [{ symbolId: 7, leverage: 0 }],
            }),
        /finite positive/,
    );
    assert.throws(
        () =>
            intents.setMarginMode({
                subAddress: SUB_1,
                updates: [
                    { symbolId: 7, mode: "cross" },
                    { symbolId: 7, mode: "isolated" },
                ],
            }),
        /duplicate symbols/,
    );
    assert.throws(
        () =>
            intents.setLeverage({
                subAddress: SUB_1,
                updates: [{ symbol: "BTC-USDC", leverage: 10 }],
            }),
        /market resolver/,
    );
    assert.throws(
        () =>
            intents.setLeverage({
                subAddress: SUB_1,
                updates: [{ symbolId: 7, leverage: "0x10" }],
            }),
        /decimal number/,
    );
    assert.throws(
        () =>
            intents.adjustIsolatedMargin({
                subAddress: SUB_1,
                symbolId: 7,
                side: "both" as "long",
                action: "add",
                amountAtomic: 1n,
            }),
        /side must be/,
    );
});

test("AccountIntents builds Agent approval and AccountClient prevents self-approval", () => {
    const expiryTimestamp = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const orderless = new AccountIntents().approveAgent({
        name: "trading-agent",
        agent: AGENT,
        expiryTimestamp,
        nonce: 10n,
    });

    assert.equal(orderless.variant, DexOrderlessTxVariant.DexAgent);
    const tx = orderless.inner as DexAgentTx;
    assert.equal(tx.variant, AgentOperationVariant.Approve);
    const approval = tx.operation as AgentApprove;
    assert.equal(approval.agentAddress, AGENT.accountAddress);
    assert.equal(approval.expiryTimestamp, expiryTimestamp);
    assert.equal(client().client.generateAgentAccount().accountAddress.isEvmCompatible(), true);

    assert.throws(
        () =>
            client().client.approveAgent({
                name: "self",
                agent: MASTER,
                expiryTimestamp,
            }),
        /own agent/,
    );
});

test("AccountIntents builds internal, account and bridge transfer variants", () => {
    const intents = new AccountIntents();
    const internal = intents.transferBetweenSubaccounts({
        fromSubAddress: SUB_1,
        toSubAddress: SUB_2,
        amountAtomic: 1_500_000n,
        nonce: 11n,
    }).inner as DexTransferTx;
    assert.equal(internal.variant, DexTransferVariant.InternalTransfer);
    const internalItem = internal.payload[0] as InternalTransferItem;
    assert.equal(internalItem.from_subaddress, SUB_1);
    assert.equal(internalItem.to_subaddress, SUB_2);
    assert.equal(internalItem.amount, 1_500_000n);

    const account = intents.transferToAccount({
        toAccount: AGENT.accountAddress,
        amount: "2.5",
        nonce: 12n,
    }).inner as DexTransferTx;
    assert.equal(account.variant, DexTransferVariant.AccountTransfer);
    assert.equal((account.payload[0] as AccountTransferItem).to_account, AGENT.accountAddress);
    assert.equal((account.payload[0] as AccountTransferItem).amount, 2_500_000n);

    const bridge = intents.bridgeWithdraw({
        destination: AGENT.accountAddress,
        amountAtomic: 3_000_000n,
        nonce: 13n,
    }).inner as DexTransferTx;
    assert.equal(bridge.variant, DexTransferVariant.CrossTransfer);
    assert.equal(bridge.option, CrossTransferOption.Burn);
    assert.equal((bridge.payload[0] as CrossTransferItem).amount, 3_000_000n);
});

test("AccountIntents batches transfers and builds a proof-backed bridge deposit", () => {
    const intents = new AccountIntents();
    const batch = intents.transferBetweenSubaccountsBatch({
        transfers: [
            { fromSubAddress: SUB_1, toSubAddress: SUB_2, amountAtomic: 1n },
            { fromSubAddress: SUB_2, toSubAddress: SUB_1, amount: "2" },
        ],
        nonce: 21n,
    }).inner as DexTransferTx;
    assert.equal(batch.payload.length, 2);

    const proof = new BridgeProof(
        new Uint8Array(32),
        4n,
        [new BridgeSignature(new Uint8Array(32), new Uint8Array(32), 0)],
    );
    const deposit = intents.bridgeDeposit({
        transfers: [{ toAccount: MASTER.accountAddress, amount: "3.5" }],
        proof,
        nonce: 22n,
    }).inner as DexTransferTx;
    assert.equal(deposit.option, CrossTransferOption.Mint);
    assert.equal(deposit.bridgeProof, proof);
    assert.equal((deposit.payload[0] as CrossTransferItem).amount, 3_500_000n);
});

test("AccountClient deposit/withdraw defaults the main address to its signer", async () => {
    const { client: accountClient, intention } = client();

    await accountClient.depositToSubaccount({
        subAddress: SUB_1,
        amountAtomic: 1n,
        nonce: 14n,
    });
    await accountClient.withdrawToMain({
        subAddress: SUB_1,
        amountAtomic: 2n,
        nonce: 15n,
    });

    const deposit = intention.executeCalls[0].orderlessTx.inner as DexTransferTx;
    const withdraw = intention.executeCalls[1].orderlessTx.inner as DexTransferTx;
    const depositItem = deposit.payload[0] as InternalTransferItem;
    const withdrawItem = withdraw.payload[0] as InternalTransferItem;
    assert.equal(depositItem.from_subaddress, MASTER.accountAddress);
    assert.equal(depositItem.to_subaddress, SUB_1);
    assert.equal(withdrawItem.from_subaddress, SUB_1);
    assert.equal(withdrawItem.to_subaddress, MASTER.accountAddress);
});

test("AccountIntents validates transfer amounts and recipients", () => {
    const intents = new AccountIntents();
    assert.throws(
        () =>
            intents.transferBetweenSubaccounts({
                fromSubAddress: SUB_1,
                toSubAddress: SUB_2,
                amountAtomic: 0n,
            }),
        /atomic amount/,
    );
    assert.throws(
        () =>
            intents.transferToAccount({
                toAccount: AGENT.accountAddress,
                amount: "1.0000001",
            }),
        /more than 6 decimal places/,
    );
    assert.throws(
        () =>
            client().client.transferToAccount({
                toAccount: MASTER.accountAddress,
                amountAtomic: 1n,
            }),
        /signer account itself/,
    );
});

test("Intention.submitDexOrderless builds, signs and submits a generic orderless tx", async () => {
    const intention = new Intention(
        new IntentionConfig({ nodeUrl: "https://node.example/v1" }),
    );
    Object.assign(intention, {
        getLedgerInfo: async () => ({ chain_id: 42 }),
    });
    let submitted: SimpleTransaction | undefined;
    Object.assign(intention.transaction.submit, {
        simple: async (args: { transaction: SimpleTransaction }) => {
            submitted = args.transaction;
            return pending();
        },
    });
    const orderless = new AccountIntents().createSubaccount({
        name: "alpha",
        nonce: 16n,
    });

    const result = await intention.submitDexOrderless({
        signer: MASTER,
        orderlessTx: orderless,
        options: {
            maxGasAmount: 777n,
            gasUnitPrice: 88n,
            expirationTimestampSecs: 999n,
        },
    });

    assert.equal(result.hash, HASH);
    assert.ok(submitted);
    assert.equal(submitted.rawTransaction.sender, MASTER.accountAddress);
    assert.equal(submitted.rawTransaction.sequence_number, 0xffff_ffff_ffff_ffffn);
    assert.equal(submitted.rawTransaction.max_gas_amount, 777n);
    assert.equal(submitted.rawTransaction.gas_unit_price, 88n);
    assert.equal(submitted.rawTransaction.expiration_timestamp_secs, 999n);
    assert.equal(submitted.rawTransaction.chain_id.chainId, 42);
    const payload = submitted.rawTransaction.payload as TransactionPayloadDexOrderless;
    assert.equal(payload.dexOrderlessTx, orderless);
});

test("Intention.submitDexOrderless keeps CrossTransfer business and replay nonces separate", async () => {
    const intention = new Intention(
        new IntentionConfig({ nodeUrl: "https://node.example/v1" }),
    );
    Object.assign(intention, {
        getLedgerInfo: async () => ({ chain_id: 42 }),
    });
    let submitted: SimpleTransaction | undefined;
    Object.assign(intention.transaction.submit, {
        simple: async (args: { transaction: SimpleTransaction }) => {
            submitted = args.transaction;
            return pending();
        },
    });
    const businessNonce = 17n;
    const replayProtectionNonce = 9_001n;
    const orderless = new AccountIntents().bridgeWithdraw({
        destination: AGENT.accountAddress,
        amountAtomic: 1_000_000n,
        nonce: businessNonce,
    });

    await intention.submitDexOrderless({
        signer: MASTER,
        orderlessTx: orderless,
        options: { replayProtectionNonce },
    });

    assert.ok(submitted);
    assert.equal(submitted.rawTransaction.sequence_number, replayProtectionNonce);
    const payload = submitted.rawTransaction.payload as TransactionPayloadDexOrderless;
    const transfer = payload.dexOrderlessTx.inner as DexTransferTx;
    assert.equal(transfer.nonce, businessNonce);
});

test("Intention.submitDexOrderless generates a replay nonce for user bridge withdrawals", async () => {
    const intention = new Intention(
        new IntentionConfig({ nodeUrl: "https://node.example/v1" }),
    );
    Object.assign(intention, {
        getLedgerInfo: async () => ({ chain_id: 42 }),
    });
    let submitted: SimpleTransaction | undefined;
    Object.assign(intention.transaction.submit, {
        simple: async (args: { transaction: SimpleTransaction }) => {
            submitted = args.transaction;
            return pending();
        },
    });

    await intention.submitDexOrderless({
        signer: MASTER,
        orderlessTx: new AccountIntents().bridgeWithdraw({
            destination: AGENT.accountAddress,
            amountAtomic: 1_000_000n,
            nonce: 18n,
        }),
    });

    assert.ok(submitted);
    assert.notEqual(
        submitted.rawTransaction.sequence_number,
        0xffff_ffff_ffff_ffffn,
    );
});

test("Intention.executeDexOrderless waits with success checking enabled", async () => {
    const intention = new Intention(
        new IntentionConfig({ nodeUrl: "https://node.example/v1" }),
    );
    let waitArgs: unknown;
    Object.assign(intention, {
        submitDexOrderless: async () => pending(),
        waitForTransaction: async (args: unknown) => {
            waitArgs = args;
            return committed();
        },
    });

    const result = await intention.executeDexOrderless({
        signer: MASTER,
        orderlessTx: new AccountIntents().createSubaccount({ name: "alpha" }),
        options: { timeoutSecs: 9, pollIntervalMs: 250 },
    });

    assert.equal(result.hash, HASH);
    assert.deepEqual(waitArgs, {
        transactionHash: HASH,
        options: {
            timeoutSecs: 9,
            checkIntervalMs: 250,
            checkSuccess: true,
        },
    });
});

test("AccountClient queries normalized Agent authorizations and bindings", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes("/dex/agents/")) {
            return new Response(
                JSON.stringify({
                    master_address: MASTER.accountAddress.toString(),
                    agents: [
                        {
                            name: "trading-agent",
                            agent_address: AGENT.accountAddress.toString(),
                            expiry_timestamp: "2000000000",
                            created_at: "1900000000",
                        },
                    ],
                }),
            );
        }
        if (url.includes("/dex/agent_binding/")) {
            return new Response(
                JSON.stringify({
                    agent_address: AGENT.accountAddress.toString(),
                    master_address: MASTER.accountAddress.toString(),
                    name: "trading-agent",
                }),
            );
        }
        return new Response("not found", { status: 404 });
    };

    try {
        const { client: accountClient } = client();
        const authorizations = await accountClient.getAgents();
        const binding = await accountClient.getAgentBinding(AGENT.accountAddress);

        assert.equal(authorizations.masterAddress.equals(MASTER.accountAddress), true);
        assert.equal(authorizations.agents[0].agentAddress.equals(AGENT.accountAddress), true);
        assert.equal(authorizations.agents[0].expiryTimestamp, 2_000_000_000n);
        assert.equal(binding?.masterAddress.equals(MASTER.accountAddress), true);
        assert.equal(binding?.name, "trading-agent");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

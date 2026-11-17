// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * AccountClient usage snippets. This file has no top-level side effects.
 *
 * Pass a server-side/script Account. Browser wallets should use AccountIntents
 * to build the same orderless transactions and sign them with a wallet adapter.
 */

import {
    Account,
    AccountAddress,
    AccountClient,
    Intention,
    IntentionConfig,
} from "../src/index";

export function createAccountClient(args: {
    signer: Account;
    nodeUrl: string;
    relayerUrl?: string;
    wsUrl?: string;
}): AccountClient {
    const intention = new Intention(
        new IntentionConfig({
            nodeUrl: args.nodeUrl,
            relayerUrl: args.relayerUrl,
            wsUrl: args.wsUrl,
        }),
    );
    return new AccountClient({ intention, signer: args.signer });
}

export async function createSubaccountExample(
    client: AccountClient,
): Promise<AccountAddress | null> {
    const result = await client.createSubaccount(
        { name: "trading" },
        { timeoutSecs: 30 },
    );
    return result.subAddress;
}

export async function transferExample(
    client: AccountClient,
    fromSubAddress: AccountAddress,
    toSubAddress: AccountAddress,
): Promise<string> {
    const result = await client.transferBetweenSubaccounts({
        fromSubAddress,
        toSubAddress,
        amount: "10.5",
        // Human amount defaults to 6 decimals (USDC).
    });
    return result.hash;
}

export async function configureTradingAccountExample(
    client: AccountClient,
    subAddress: AccountAddress,
    symbolId: number,
): Promise<void> {
    await client.setPositionMode({ subAddress, mode: "one-way" });
    await client.setMarginMode({
        subAddress,
        updates: [{ symbolId, mode: "isolated" }],
    });
    await client.setLeverage({
        subAddress,
        updates: [{ symbolId, leverage: "10" }],
    });
    await client.adjustIsolatedMargin({
        subAddress,
        symbolId,
        side: "long",
        action: "add",
        amount: "100",
    });
}

export async function authorizeGeneratedAgentExample(
    client: AccountClient,
): Promise<Account> {
    // Server/script only: securely persist the returned private key yourself.
    const agent = client.generateAgentAccount();
    await client.approveAgent({
        name: "trading-agent",
        agent,
        expiresInSecs: 30 * 24 * 60 * 60,
    });
    return agent;
}

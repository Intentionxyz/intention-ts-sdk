// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/** Unified-client usage snippets. This file has no top-level side effects. */

import {
    Account,
    AccountAddress,
    IntentionClient,
    Network,
    OrderType,
} from "../src/index";

export function createClient(args: {
    signer: Account;
    nodeUrl: string;
    relayerUrl: string;
    wsUrl?: string;
}): IntentionClient {
    return new IntentionClient({
        network: Network.CUSTOM,
        signer: args.signer,
        nodeUrl: args.nodeUrl,
        relayerUrl: args.relayerUrl,
        wsUrl: args.wsUrl,
    });
}

export async function tradeExample(
    sdk: IntentionClient,
    subAddress: AccountAddress,
): Promise<string> {
    // trader() is synchronous. Market metadata and position mode are loaded
    // and cached only when the first trading method is called.
    const trader = sdk.trader({ subAddress });
    const result = await trader.placeOrder({
        symbol: "BTC-USDC",
        side: "BUY",
        type: OrderType.LIMIT,
        price: 60_000,
        size: "0.01",
    });
    return result.hash;
}

export async function accountExample(sdk: IntentionClient): Promise<AccountAddress | null> {
    const created = await sdk.accounts.createSubaccount({ name: "trading" });
    if (!created.subAddress) return null;

    const trader = sdk.trader({ subAddress: created.subAddress });
    await trader.setLeverage({
        updates: [{ symbol: "BTC-USDC", leverage: 10 }],
    });
    return created.subAddress;
}

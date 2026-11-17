// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Local-chain e2e example: order lifecycle via the high-level intent API.
 *
 * Demonstrates the full chain wired in this SDK:
 *   fetchPerpetualMarkets -> SimpleMarketResolver -> OrderClient
 *   -> place / place-with-TP-SL / modify / cancel / close
 *
 * This example imports from source (`../src`) so it typechecks without a build.
 * It is NOT part of the package build (tsconfig `include` is `src/**` only).
 *
 * Run (against a local chain):
 *   PRIVATE_KEY=0x... \
 *   FULLNODE_URL=http://localhost:8080/v1 \
 *   DEX_REST_URL=http://localhost:8080 \
 *   SYMBOL=BTC-USDC \
 *   npx tsx examples/e2e-order-lifecycle.ts
 *
 * Set DRY_RUN=1 to only BUILD the payloads (no signing / no submit) - useful
 * for inspecting wire bytes without a running chain.
 */

import {
    Intention,
    IntentionConfig,
    Network,
    Account,
    Secp256k1PrivateKey,
    deriveSubaccountAddress,
    OrderClient,
    OrderIntents,
    OrderType,
    OrderPositionMode,
    SimpleMarketResolver,
} from "../src/index";

// ---- env / config ----------------------------------------------------------

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const FULLNODE_URL = process.env.FULLNODE_URL ?? "http://localhost:8080/v1";
const DEX_REST_URL = process.env.DEX_REST_URL ?? "http://localhost:8080";
const WS_URL = process.env.WS_URL ?? "ws://localhost:8891/ws";
const SYMBOL = process.env.SYMBOL ?? "BTC-USDC";
const SUBACCOUNT = Number(process.env.SUBACCOUNT ?? "0");
const DRY_RUN = process.env.DRY_RUN === "1";

function log(step: string, detail?: unknown): void {
    // eslint-disable-next-line no-console
    console.log(`\n[e2e] ${step}`, detail ?? "");
}

async function waitHash(intention: Intention, label: string, hash: string): Promise<void> {
    log(`${label} submitted`, { hash });
    const res = await intention.waitForTransaction({
        transactionHash: hash,
        options: { timeoutSecs: 30, checkSuccess: true },
    });
    log(`${label} confirmed`, { type: (res as { type?: string }).type });
}

async function main(): Promise<void> {
    // 1. Client + signer + subaccount
    const intention = new Intention(
        new IntentionConfig({
            network: Network.LOCAL,
            nodeUrl: FULLNODE_URL,
            relayerUrl: DEX_REST_URL,
            wsUrl: WS_URL,
        }),
    );

    if (!PRIVATE_KEY && !DRY_RUN) {
        throw new Error("set PRIVATE_KEY (or DRY_RUN=1 to only build payloads)");
    }
    const signer = PRIVATE_KEY
        ? Account.fromPrivateKey({ privateKey: new Secp256k1PrivateKey(PRIVATE_KEY) })
        : Account.generate();
    const subAddress = deriveSubaccountAddress(signer.accountAddress, SUBACCOUNT);
    log("signer", { address: signer.accountAddress.toString(), subAddress: subAddress.toString() });

    // 2. Market resolver from listing config (tick/step). DRY_RUN uses a stub.
    let resolver: SimpleMarketResolver;
    if (DRY_RUN) {
        resolver = new SimpleMarketResolver([
            {
                symbol: SYMBOL,
                clobPairId: 0,
                atomicResolution: -10,
                quantumConversionExponent: -9,
                stepBaseQuantums: 1_000_000,
                subticksPerTick: 100_000,
            },
        ]);
        log("resolver (DRY_RUN stub)", { symbols: resolver.symbols() });
    } else {
        resolver = await intention.fetchPerpetualMarkets({ statuses: ["ACTIVE"] });
        log("resolver (fetched)", { count: resolver.symbols().length });
    }

    // 3. DRY_RUN: only build wire payloads, print, and exit.
    if (DRY_RUN) {
        const builder = new OrderIntents({ subAddress, positionMode: OrderPositionMode.Net, resolver });
        const bracket = builder.placeOrderWithTpSl(
            { symbol: SYMBOL, side: "BUY", type: OrderType.LIMIT, size: 0.5, price: 60000 },
            {
                tp: { type: OrderType.TAKE_PROFIT_MARKET, triggerPrice: 66000 },
                sl: { type: OrderType.STOP_MARKET, triggerPrice: 57000 },
            },
        );
        log("built bracket DexOrders", {
            variant: bracket.variant,
            groups: bracket.orders.length,
        });
        log("DRY_RUN complete - no submit");
        return;
    }

    // 4. Live: async client (build + sign + submit).
    const client = new OrderClient({
        intention,
        signer,
        subAddress,
        positionMode: OrderPositionMode.Net,
        resolver,
    });

    // 4a. Place a limit order + attached TP/SL bracket.
    const place = await client.placeOrderWithTpSl(
        { symbol: SYMBOL, side: "BUY", type: OrderType.LIMIT, size: 0.5, price: 60000, clientOrderId: undefined },
        {
            tp: { type: OrderType.TAKE_PROFIT_MARKET, triggerPrice: 66000 },
            sl: { type: OrderType.STOP_MARKET, triggerPrice: 57000 },
        },
    );
    log("placeOrderWithTpSl confirmed", {
        hash: place.hash,
        allAccepted: place.allAccepted,
        orders: place.orders,
    });

    // 4b. Place a standalone limit order (single).
    const single = await client.placeOrder({
        symbol: SYMBOL,
        side: "BUY",
        type: OrderType.LIMIT,
        size: 0.1,
        price: 59000,
        clientOrderId: "0x1111111111111111111111111111aaaa",
    });
    log("placeOrder confirmed", {
        hash: single.hash,
        allAccepted: single.allAccepted,
        orders: single.orders,
    });

    // 4c. Modify the standalone order (price down) - by client_order_id.
    const modify = await client.modifyOrder(
        { clientOrderId: "0x1111111111111111111111111111aaaa" },
        { symbol: SYMBOL, price: 58000 },
    );
    await waitHash(intention, "modifyOrder", modify.hash);

    // 4d. Cancel the standalone order - by client_order_id.
    const cancel = await client.cancelOrder({
        clientOrderId: "0x1111111111111111111111111111aaaa",
    });
    await waitHash(intention, "cancelOrder", cancel.hash);

    // 4e. Close position (Net). For Hedge, pass positionSide: 'LONG' | 'SHORT'.
    const close = await client.closePosition({ symbol: SYMBOL, size: "ALL", type: "MARKET" });
    await waitHash(intention, "closePosition", close.hash);

    log("e2e complete");
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[e2e] failed:", err);
    process.exitCode = 1;
});

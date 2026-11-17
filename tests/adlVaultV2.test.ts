// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    DexAccountClient,
    Intention,
    IntentionConfig,
    decodeDexEvent,
    type DexAdlVaultInitializedEvent,
} from "../src/index";

const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/adl_vault_v2_chain.json", import.meta.url), "utf8"),
) as {
    initializeTransactionBcsHex: string;
    bindingEventBcsHex: string;
    executionEventBcsHex: string;
    vaultAddress: string;
    vaultConfigVersion: number;
};

test("discovers the current Liquidation Vault and reads an archived binding event", async () => {
    const client = new DexAccountClient(
        new Intention(new IntentionConfig({ nodeUrl: "https://node.example/v1" })),
        async () =>
            new Response(
                JSON.stringify({
                    liquidationTakeoverAddress: "0x11",
                }),
            ),
    );
    const accounts = await client.getSystemAccounts();
    assert.deepEqual(accounts, { liquidationTakeoverAddress: "0x11" });

    const decoded = decodeDexEvent(
        "0x1::dex::AdlVaultInitializedEvent",
        fixture.bindingEventBcsHex,
    );
    assert.notEqual(decoded, null);
    const event = decoded?.event as DexAdlVaultInitializedEvent;
    assert.equal(event.vaultAddress, fixture.vaultAddress);
    assert.equal(event.vaultConfigVersion, 2n);
});

test("rejects the retired independent-Vault takeover layout", () => {
    assert.equal(decodeDexEvent("0x1::dex::AdlExecutionEvent", fixture.executionEventBcsHex), null);
});

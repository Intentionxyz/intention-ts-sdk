// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    Intention,
    IntentionConfig,
    Serializer,
    VaultClient,
    decodeDexEvent,
} from "../src/index";

test("VaultClient unwraps the node's list/positions/orders response envelopes", async () => {
    const paths: string[] = [];
    const intention = new Intention(
        new IntentionConfig({ nodeUrl: "https://node.example/v1" }),
    );
    const client = new VaultClient(intention, async (input) => {
        const url = String(input);
        paths.push(url);
        if (url.endsWith("/vaults")) {
            return new Response(JSON.stringify({ vaults: [{ vault_id: "7" }] }));
        }
        if (url.endsWith("/positions")) {
            return new Response(
                JSON.stringify({ vault_id: "7", accounts: [{ sub_address: "0x1", perps: [] }] }),
            );
        }
        return new Response(
            JSON.stringify({ vault_id: "7", accounts: [{ sub_address: "0x1", orders: [] }] }),
        );
    });

    assert.equal((await client.getVaults())[0].vault_id, "7");
    assert.equal((await client.getPositions(7))[0].sub_address, "0x1");
    assert.equal((await client.getOrders(7))[0].sub_address, "0x1");
    assert.deepEqual(paths, [
        "https://node.example/v1/vaults",
        "https://node.example/v1/vaults/7/positions",
        "https://node.example/v1/vaults/7/orders",
    ]);
});

test("Vault user events are decoded by the unified transaction decoder", () => {
    const serializer = new Serializer();
    serializer.serializeU64(7n);
    serializer.serializeI128(2_000_000n);
    serializer.serializeI128(8_000_000n);
    serializer.serializeU64(123n);
    const data = `0x${Buffer.from(serializer.toUint8Array()).toString("hex")}`;
    const decoded = decodeDexEvent("0x1::vault_events::SharesBurnedEvent", data);
    assert.equal(decoded?.eventType, "VaultSharesBurnedEvent");
    assert.equal((decoded?.event as { burnShares: bigint }).burnShares, 2_000_000n);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeDexEvent } from "../dist/esm/index.mjs";

test("reads current Liquidation Vault tail and unified receipt events", () => {
    for (const name of ["adl_liquidation_vault_tail_v9", "adl_unified_remainder_v9"]) {
        const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
        const sourceOwners = new Set();
        for (const [index, chunk] of fixture.chunks.entries()) {
            const decoded = decodeDexEvent("0x1::dex::AdlExecutionEvent", chunk.bcs_hex);
            assert.ok(decoded, "current chain event must be readable");
            assert.equal(decoded.event.selectedPrefixHeader.algorithmVersion, 9n);
            const event = decoded.event;
            const header = event.selectedPrefixHeader;
            const sourceSide = name === "adl_unified_remainder_v9" && index === 1 ? 2 : 1;
            assert.equal(header.sourcePositionKey.positionSide, sourceSide);
            assert.equal(header.queueKey.opponentSide, sourceSide === 1 ? 2 : 1);
            sourceOwners.add(header.sourceRiskHolder.ownerAddress);
            assert.equal(header.totalExecutedQuantums.toString(), chunk.target_quantums);
            if (name === "adl_liquidation_vault_tail_v9") {
                const filled = event.auditEntries.filter((entry) => entry.executedQuantums > 0n);
                const tail = filled.at(-1);
                assert.ok(filled.slice(0, -1).some((entry) => entry.executionPass === 2), "ordinary hedge close precedes Vault");
                assert.equal(BigInt(tail.positionKey.account.ownerAddress), BigInt(fixture.liquidation_vault_address));
                assert.equal(tail.scoreNumeratorSigned.absValue, 0n);
                assert.equal(tail.scoreDenominator, 0n);
            }
            if (chunk.vault_takeover_quantums !== null) {
                assert.equal(decoded.event.vaultTakeoverFill.leftoverQuantums.toString(), chunk.vault_takeover_quantums);
                assert.equal(BigInt(event.vaultTakeoverFill.vaultAccount.ownerAddress), BigInt(fixture.liquidation_vault_address));
                assert.equal(event.vaultTakeoverFill.bankruptcySubticks.toString(), chunk.bankruptcy_subticks);
                assert.equal("vaultConfigVersion" in decoded.event.vaultTakeoverFill, false);
            }
        }
        if (name === "adl_unified_remainder_v9") assert.equal(sourceOwners.size, 2, "receipts retain two distinct sources");
    }
});

test("discovers the Liquidation Vault without an independent ADL Vault binding", async () => {
    const { DexAccountClient, Intention, IntentionConfig } = await import("../dist/esm/index.mjs");
    const client = new DexAccountClient(new Intention(new IntentionConfig({ nodeUrl: "https://node.example/v1" })),
        async () => new Response(JSON.stringify({ liquidationTakeoverAddress: "0x11" })));
    const accounts = await client.getSystemAccounts();
    assert.deepEqual(accounts, { liquidationTakeoverAddress: "0x11" });
});

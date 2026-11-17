import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeDexEvent, decodeTransactionEvents } from "../dist/esm/index.mjs";

const fixture = (name) =>
    JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url)));

test("core Vault offset golden is a typed event with exact i128 bits", () => {
    const golden = fixture("vault_internal_offset_v1");
    const result = decodeDexEvent(
        "0x1::dex::VaultInternalOffsetEvent",
        golden.bcs_hex,
    );
    assert.ok(result, "SDK must recognize the new core event");
    const data = Object.fromEntries(
        golden.fields.map((field) => [
            field.name,
            field.type === "address" ? "0x" + field.value : field.value,
        ]),
    );
    assert.deepEqual(
        result,
        decodeDexEvent("0x1::dex::VaultInternalOffsetEvent", data),
    );
    assert.equal(result.event.quantums, 2n);
    assert.equal(BigInt.asIntN(128, result.event.totalRealizedPnlBits), -40n);
});

test("offset rejects malformed data and preserves wide values and event indexes", () => {
    const golden = fixture("vault_internal_offset_v1");
    const tag = "0x1::dex::VaultInternalOffsetEvent";
    const data = Object.fromEntries(golden.fields.map(f => [f.name, f.type === "address" ? "0x" + f.value : f.value]));
    for (const [key, value] of [["schema_version", "2"], ["status", 4], ["quantums", -1], ["quantums", true], ["quantums", 1.5], ["quantums", Number.MAX_SAFE_INTEGER + 1], ["quantums", (1n << 64n).toString()], ["total_fee", (1n << 128n).toString()], ["vault_account", "0xGG"], ["extra", 1]]) {
        assert.equal(decodeDexEvent(tag, {...data, [key]: value}), null, key);
    }
    for (const raw of [golden.bcs_hex.slice(0, -2), golden.bcs_hex + "00", golden.bcs_hex + "f", golden.bcs_hex + "GG"]) assert.equal(decodeDexEvent(tag, raw), null);
    const wide = decodeDexEvent(tag, {...data, quantums: ((1n << 64n) - 1n).toString(), total_fee: ((1n << 128n) - 1n).toString()});
    assert.equal(wide.event.quantums, (1n << 64n) - 1n);
    assert.equal(wide.event.totalFee, (1n << 128n) - 1n);
    for (let status = 0; status <= 3; status++) assert.equal(decodeDexEvent(tag, {...data, status}).event.status, status);
    assert.deepEqual(decodeTransactionEvents([{type: "0x1::coin::Other", data: "00"}, {type: tag, data: golden.bcs_hex}]).map(e => e.index), [1]);
});

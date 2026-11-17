import assert from "node:assert/strict";
import test from "node:test";

import {
    AccountAddress,
    DexReplaceOrder,
    SymbolType,
} from "../dist/esm/index.mjs";

const EXPECTED_BCS =
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "0208070605040302012c000000020001c03afc120000000000";

test("replace by order id carries the symbol context BCS fixture", () => {
    const order = DexReplaceOrder.byOrderId(
        AccountAddress.ZERO,
        0x0102030405060708n,
        44,
        SymbolType.Perpetual,
        undefined,
        318_520_000n,
    );

    assert.equal(Buffer.from(order.bcsToBytes()).toString("hex"), EXPECTED_BCS);
});

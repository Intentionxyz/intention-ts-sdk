// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * The two DexOrders variants the taker delay introduced: a maker-only replace, and the noop that
 * cancels an order which has not reached a block yet.
 *
 * Both are asserted on the bytes and on the JSON submit shape, because the node reads the first
 * and the REST submit path reads the second, and a variant that only half exists is worse than one
 * that does not: the transaction signs and then fails to deserialise.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    AccountAddress,
    ChainId,
    CreatedBy,
    DexOrderlessTx,
    DexOrderlessTxVariant,
    DexOrders,
    DexOrdersVariant,
    DexReplaceOrder,
    DexTx,
    RawTransaction,
    Secp256k1PrivateKey,
    SimpleTransaction,
    SymbolType,
    TransactionPayloadDexOrderless,
    Account,
    generateSubmitTransactionRequest,
} from "../src/index";
import { Serializer } from "../src/bcs/serializer";

const NEW_CLIENT_ORDER_ID = "0xfedcba9876543210fedcba9876543210";

function bytes(value: { serialize(serializer: Serializer): void }): number[] {
    const serializer = new Serializer();
    value.serialize(serializer);
    return Array.from(serializer.toUint8Array());
}

function replaceOrder(): DexReplaceOrder {
    return DexReplaceOrder.byOrderId(
        AccountAddress.ZERO,
        91n,
        7,
        SymbolType.Perpetual,
        3000n,
        4000n,
        NEW_CLIENT_ORDER_ID,
    );
}

function submitRequest(nonce: bigint, orders: DexOrders) {
    const privateKey = new Secp256k1PrivateKey(
        "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    const account = Account.fromPrivateKey({ privateKey });
    const payload = new TransactionPayloadDexOrderless(
        new DexOrderlessTx(
            DexOrderlessTxVariant.Dex,
            new DexTx(nonce, orders, CreatedBy.User),
        ),
    );
    const transaction = new SimpleTransaction(
        RawTransaction.createOrderless(
            account.accountAddress,
            payload,
            200000n,
            100n,
            9999999999n,
            new ChainId(4),
        ),
    );
    return generateSubmitTransactionRequest({
        transaction,
        senderAuthenticator: account.signTransactionWithAuthenticator(transaction),
    });
}

describe("noop", () => {
    // A noop is the one DexOrders variant with nothing after its tag. Serialising an empty vector
    // instead -- what every other variant does when given no orders -- appends a trailing zero
    // byte, and the node then cannot deserialise the transaction.
    it("encodes as nothing but its tag", () => {
        assert.deepEqual(bytes(DexOrders.noop()), [5]);
    });

    // The nonce appears twice in a DEX transaction: as the replay protector and inside the
    // payload. An in-flight cancel only works when both are the cancelled order's nonce, and that
    // is exactly the pair a hand-built noop gets wrong.
    it("carries the order's nonce as both the replay protector and the payload nonce", () => {
        const request = submitRequest(4242n, DexOrders.noop());
        assert.equal(request.replay_protection_nonce, "4242");
        assert.equal(
            (request.payload as unknown as Record<string, unknown>).nonce,
            "4242",
        );
    });

    it("renders a JSON payload with no orders field", () => {
        const payload = submitRequest(1234n, DexOrders.noop()).payload as unknown as Record<
            string,
            unknown
        >;
        assert.equal(payload.operation, "noop");
        assert.equal(payload.dex_type, "dex_payload");
        // The node's noop payload type declares no orders field, so rendering one -- even an empty
        // one -- submits a shape it never described.
        assert.equal("orders" in payload, false);
    });
});

describe("maker-only replace", () => {
    // The tag is the entire difference from a plain replace, and it is what tells the node to hold
    // the replacement to maker-only entry rules -- and to pack it without the taker delay.
    it("differs from a replace in its tag alone", () => {
        const replace = bytes(new DexOrders(DexOrdersVariant.Replace, [replaceOrder()]));
        const makerOnly = bytes(DexOrders.replaceMakerOnly([replaceOrder()]));

        assert.equal(replace[0], 2);
        assert.equal(makerOnly[0], 4);
        assert.deepEqual(makerOnly.slice(1), replace.slice(1));
    });

    it("renders as the replace_maker_only operation with the replace orders", () => {
        const payload = submitRequest(1234n, DexOrders.replaceMakerOnly([replaceOrder()]))
            .payload as unknown as Record<string, unknown>;
        assert.equal(payload.operation, "replace_maker_only");
        assert.equal((payload.orders as unknown[]).length, 1);
    });
});

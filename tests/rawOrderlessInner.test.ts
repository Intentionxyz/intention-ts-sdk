// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Serializer } from "../src/bcs/serializer";
import {
    BridgeSignature,
    DexOrderlessTx,
    MultiSigProof,
    RawOrderlessInner,
} from "../src/transactions/dexPayloads";
import { DexOrderlessTxVariant } from "../src/types/enums";

function hex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
}

function serialize(tx: DexOrderlessTx): string {
    const s = new Serializer();
    tx.serialize(s);
    return hex(s.toUint8Array());
}

function filled(byte: number, length = 32): Uint8Array {
    return new Uint8Array(length).fill(byte);
}

function leading(byte: number): Uint8Array {
    const out = new Uint8Array(32);
    out[0] = byte;
    return out;
}

describe("MultiSigProof", () => {
    // Pins the expiry's position between the digest and the signatures.
    //
    // The layout is a cross-language contract with
    // intention_types::transaction::dex_sys_config::MultiSigProof. Asserted on
    // raw bytes rather than through a round trip, so it fails when either side
    // of that contract moves instead of agreeing with whatever this encoder
    // currently does. Omitting the field is not a graceful degradation: the
    // chain reads the signature vector's length prefix as the u64's first byte.
    it("writes expiresAtSecs between the digest and the signatures", () => {
        const proof = new MultiSigProof(filled(0x11), 0x0102030405060708n, [
            new BridgeSignature(leading(0xaa), leading(0xbb), 27),
        ]);

        const s = new Serializer();
        proof.serialize(s);

        assert.equal(
            hex(s.toUint8Array()),
            "11".repeat(32) + // op_digest
                "0807060504030201" + // expires_at_secs, u64 little-endian
                "01" + // signatures: uleb128 length
                "aa" + "00".repeat(31) + // r
                "bb" + "00".repeat(31) + // s
                "1b", // v = 27
        );
    });

    it("rejects a digest that is not 32 bytes", () => {
        assert.throws(() => new MultiSigProof(filled(0x11, 31), 0n, []), /exactly 32 bytes/);
    });
});

describe("RawOrderlessInner", () => {
    // Nothing may be added around the body -- no length prefix, no padding. The
    // caller computes signatures over bytes it serialized itself, so a byte this
    // package inserts is a byte no signer covered.
    it("writes the body verbatim behind the caller's variant tag", () => {
        const tx = new DexOrderlessTx(
            DexOrderlessTxVariant.DexAgent,
            new RawOrderlessInner(new Uint8Array([0xde, 0xad, 0xbe, 0xef])),
        );

        assert.equal(serialize(tx), "04" + "deadbeef");
    });

    // The proof slot follows from the variant, so a caller that models a
    // system-config operation itself still gets somewhere to put its multisig.
    // This is the whole reason the type exists.
    it("carries the system-config proof slot", () => {
        const inner = new RawOrderlessInner(new Uint8Array([0x01, 0x02]));

        assert.equal(
            serialize(new DexOrderlessTx(DexOrderlessTxVariant.DexSystemConfig, inner)),
            "02" + "0102" + "00", // Option::None
        );

        const proof = new MultiSigProof(filled(0x5e), 0x0102030405060708n, [
            new BridgeSignature(leading(0xa1), leading(0xb2), 27),
        ]);

        assert.equal(
            serialize(new DexOrderlessTx(DexOrderlessTxVariant.DexSystemConfig, inner, proof)),
            "02" +
                "0102" +
                "01" + // Option::Some
                "5e".repeat(32) +
                "0807060504030201" +
                "01" +
                "a1" + "00".repeat(31) +
                "b2" + "00".repeat(31) +
                "1b",
        );
    });

    // The Option belongs to DexSystemConfig alone. Writing it for the transfer
    // path would break the one that already worked.
    it("adds no proof to any other variant", () => {
        const proof = new MultiSigProof(filled(0x5e), 0n, []);

        for (const variant of [
            DexOrderlessTxVariant.Dex,
            DexOrderlessTxVariant.DexUserConfig,
            DexOrderlessTxVariant.DexTransfer,
            DexOrderlessTxVariant.DexAgent,
            DexOrderlessTxVariant.Vault,
        ]) {
            const got = serialize(
                new DexOrderlessTx(variant, new RawOrderlessInner(new Uint8Array([0x77])), proof),
            );
            assert.ok(got.endsWith("77"), `variant ${variant} grew something after the body: ${got}`);
        }
    });

    // A caller using this type tracks its own replay nonce -- it put it in the
    // body -- so the honest answer is "not known here". Returning 0n would hand
    // a submitter a nonce of zero and look authoritative.
    it("reports no nonce for an opaque body", () => {
        const tx = new DexOrderlessTx(
            DexOrderlessTxVariant.DexSystemConfig,
            new RawOrderlessInner(new Uint8Array([0x06, 0x07])),
        );

        assert.throws(() => tx.nonce, /opaque body/);
    });
});

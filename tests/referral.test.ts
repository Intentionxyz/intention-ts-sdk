// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountAddress, DexOrderlessTx, DexOrderlessTxVariant, DexUserConfigTx,
    DexUserConfigTxVariant, RegisterReferralCode, BindReferrer,
    ClaimReferralRewards, SetReferralConfig, RawTransaction, ChainId,
    TransactionPayloadDexOrderless, Secp256k1PrivateKey, buildTypedData,
    typedDataDigest, generateSigningMessageForTransaction, signedTransactionFromWalletSignature } from "../src/index";
import { secp256k1 } from "@noble/curves/secp256k1";

const one = AccountAddress.fromString("0x1");
const actions = [
    new DexOrderlessTx(DexOrderlessTxVariant.DexUserConfig,
        new DexUserConfigTx(DexUserConfigTxVariant.RegisterReferralCode, new RegisterReferralCode(123n, "ABC123"))),
    new DexOrderlessTx(DexOrderlessTxVariant.DexUserConfig,
        new DexUserConfigTx(DexUserConfigTxVariant.BindReferrer, new BindReferrer(123n, "ABC123"))),
    new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer, new ClaimReferralRewards(123n)),
    new DexOrderlessTx(DexOrderlessTxVariant.DexSystemConfig, new SetReferralConfig(123n, {
        inviteeFeeDiscountPpm: 40_000, commissionRatePpm: 100_000,
        referralThresholdVolume: 1_000_000_000n, discountVolumeCap: 25_000_000_000n,
        commissionVolumeCap: 1_000_000_000_000_000n, minClaimAmount: 1_000_000n,
    })),
];
const vectors = [
    "01067b0000000000000006414243313233",
    "01077b0000000000000006414243313233",
    "03047b0000000000000000",
    "02247b00000000000000409c0000a086010000ca9a3b0000000000ba1dd2050000000080c6a47e8d030040420f000000000000",
];
test("referral BCS matches chain vectors and exposes nonce", () => {
    actions.forEach((tx, i) => {
        assert.equal(Buffer.from(tx.bcsToBytes()).toString("hex"), vectors[i]);
        assert.equal(tx.nonce, 123n);
    });
});
test("referral codes preserve casing and reject invalid formats", () => {
    assert.notDeepEqual(new RegisterReferralCode(1n, "ABC123").bcsToBytes(), new RegisterReferralCode(1n, "abc123").bcsToBytes());
    for (const code of ["short", "ABCDE_"]) assert.throws(() => new RegisterReferralCode(1n, code));
});
test("referral wallet signing matches the node's existing generic EIP-712 envelope", () => {
    const keyBytes = Uint8Array.from({length:32},()=>0x11);
    const key = new Secp256k1PrivateKey(keyBytes);
    const agentClaim = new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer,
        new ClaimReferralRewards(123n, one));
    for (const payload of [...actions.slice(0, 3), agentClaim]) {
        const raw = new RawTransaction(one, 0n, new TransactionPayloadDexOrderless(payload),
            5000n, 100n, 1_800_000_000n, new ChainId(99));
        const typed = buildTypedData(raw);
        assert.deepEqual(typed?.domain, {name:"Intention"});
        assert.equal(typed?.primaryType, "IntentionTransaction");
        const digest = typedDataDigest(raw);
        assert.ok(digest);
        const wallet = secp256k1.sign(digest, keyBytes, {lowS:true});
        assert.deepEqual(wallet.toCompactRawBytes(), key.sign(generateSigningMessageForTransaction(raw)).data);
        const signature = Uint8Array.from([...wallet.toCompactRawBytes(), 27 + wallet.recovery]);
        assert.ok(Buffer.from(signedTransactionFromWalletSignature(raw, signature)).includes(Buffer.from(key.publicKey().data)));
    }
});

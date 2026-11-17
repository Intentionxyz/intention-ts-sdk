import { strict as assert } from "node:assert";
import test from "node:test";
import {
    AccountAddress, RawTransaction, ChainId,
    DexAgentTx, AgentApprove, AgentRevoke, DexOrderlessTx, TransactionPayloadDexOrderless,
    DexMultisigTx, MultisigOpInstall,
    DexTransferTx, AccountTransferItem,
} from "../dist/esm/index.mjs";
import { typedDataDigest, domainSeparator, buildTypedData, signedTransactionFromWalletSignature, formatAmount,
         CrossTransferItem } from "../dist/esm/index.mjs";
import { secp256k1 } from "@noble/curves/secp256k1";

const hex = (u8) => Buffer.from(u8).toString("hex");
const addr = (h) => AccountAddress.fromString("0x" + "00".repeat(12) + h.replace(/^0x/, ""));

function raw(variant, inner) {
    return new RawTransaction(
        addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"),
        0n,
        new TransactionPayloadDexOrderless(new DexOrderlessTx(variant, inner)),
        100000n, 100n, 1800000000n, new ChainId(2),
    );
}

test("domain separator matches the other implementations", () => {
    assert.equal(hex(domainSeparator(2)),
        "336363b4cfef512fb47e8f066a6a6458a002683e1ce4d10aabadd35b6ba43d93");
});

test("ApproveAgent digest matches the other implementations", () => {
    const txn = raw(4, new DexAgentTx(1788507274398n, 0,
        new AgentApprove("coid-test", addr("0x0011bbcc289635ae8ad2f2ec1080af75e009adbb"), 1790000000n)));
    assert.equal(hex(typedDataDigest(txn)),
        "6a199c496e821f262cddb86a0b387a57ba0997faab51dfe3ae2cff0621382210");
});

test("SendAsset digest matches the other implementations", () => {
    const txn = raw(3, new DexTransferTx(2n, 1,
        [new AccountTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 0, 10000000n, 0)]));
    assert.equal(hex(typedDataDigest(txn)),
        "b1102a5c0010514ae64d6ea0e7d832e190adf70f3049fed465bfdfa32f144d18");
});

test("batch digest matches the other implementations", () => {
    // The struct-array encoding the flat types never exercise. This is where an
    // implementation is most likely to drift: the array hashes each element's
    // struct hash and then hashes the concatenation, and the batch type string has
    // to carry the referenced struct's own definition appended to it. Getting
    // either wrong still yields 32 plausible bytes.
    const txn = raw(3, new DexTransferTx(7n, 1, [
        new AccountTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 0, 1000000n, 0),
        new AccountTransferItem(addr("0x0011bbcc289635ae8ad2f2ec1080af75e009adbb"), 0, 2000000n, 0),
    ]));
    assert.equal(hex(typedDataDigest(txn)),
        "0c5537f6d410df7c15b97a154a63db567f3aabfaa76021fc21284ce11ac70142");
});

test("a batch reaches a different type than a single transfer", () => {
    const one = raw(3, new DexTransferTx(7n, 1, [
        new AccountTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 0, 1000000n, 0),
    ]));
    const two = raw(3, new DexTransferTx(7n, 1, [
        new AccountTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 0, 1000000n, 0),
        new AccountTransferItem(addr("0x0011bbcc289635ae8ad2f2ec1080af75e009adbb"), 0, 2000000n, 0),
    ]));
    assert.notEqual(hex(typedDataDigest(one)), hex(typedDataDigest(two)));
});

test("buildTypedData hands the wallet exactly what it renders", () => {
    // Pins the shape the frontend passes to viem/wagmi. If a field name, its
    // order or the primaryType drifts here, the wallet shows something the chain
    // will not accept -- and the only symptom would be "invalid signature".
    const txn = raw(3, new DexTransferTx(2n, 1, [
        new AccountTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 0, 10000000n, 0),
    ]));
    const td = buildTypedData(txn);
    assert.equal(td.primaryType, "IntentionTransaction_AccountTransfer");
    assert.deepEqual(td.domain, {
        name: "Intention",
        version: "1",
        chainId: 421614,
        verifyingContract: "0x0000000000000000000000000000000000000000",
    });
    assert.deepEqual(td.types[td.primaryType].map((f) => `${f.type} ${f.name}`), [
        "string intentionChain",
        "address toAccount",
        "string token",
        "string amount",
        "string accountType",
        "uint64 nonce",
        "bytes32 digest",
    ]);
    assert.equal(td.message.intentionChain, "Testnet");
    assert.equal(td.message.toAccount, "0x001ebbde289635ae8ad2f2ec1080af75e00705f9");
    assert.equal(td.message.amount, "10");
    // The digest the wallet signs is the one the chain rebuilds.
    assert.equal(hex(typedDataDigest(txn)),
        "b1102a5c0010514ae64d6ea0e7d832e190adf70f3049fed465bfdfa32f144d18");
});

test("a batch carries its referenced struct type for the wallet", () => {
    const txn = raw(3, new DexTransferTx(7n, 1, [
        new AccountTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 0, 1000000n, 0),
        new AccountTransferItem(addr("0x0011bbcc289635ae8ad2f2ec1080af75e009adbb"), 0, 2000000n, 0),
    ]));
    const td = buildTypedData(txn);
    assert.equal(td.primaryType, "IntentionTransaction_AccountTransferBatch");
    assert.ok(td.types.AccountTransferItem, "the referenced struct must be declared or the wallet cannot hash it");
    assert.equal(td.message.transfers.length, 2);
    assert.equal(td.message.transfers[0].toAccount, "0x001ebbde289635ae8ad2f2ec1080af75e00705f9");
});

test("a wallet signature assembles into a submittable transaction", () => {
    // A wallet returns r||s||v and no public key; the key is recovered from the
    // digest it signed. This proves the recovered key is the signer's.
    const priv = secp256k1.utils.randomPrivateKey();
    const txn = raw(3, new DexTransferTx(3n, 1, [
        new AccountTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 0, 5000000n, 0),
    ]));
    const digest = typedDataDigest(txn);
    const sig = secp256k1.sign(digest, priv);
    const walletSig = new Uint8Array(65);
    walletSig.set(sig.toCompactRawBytes(), 0);
    walletSig[64] = 27 + sig.recovery;

    const bytes = signedTransactionFromWalletSignature(txn, walletSig);
    assert.ok(bytes.length > 0);
    const expected = secp256k1.getPublicKey(priv, false);
    assert.ok(Buffer.from(bytes).includes(Buffer.from(expected)),
        "the assembled transaction must carry the signer's recovered public key");
});

test("a payload no wallet signs is refused rather than mis-assembled", () => {
    // A CrossTransfer in the Mint direction is the bridge relayer crediting a
    // deposit -- there is no user at a wallet, so it keeps the opaque wrapper.
    const deposit = raw(3, new DexTransferTx(1n, 2, [
        new CrossTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 0, 1000000n, 0),
    ], 0));
    assert.equal(buildTypedData(deposit), null);
    assert.throws(() => signedTransactionFromWalletSignature(deposit, new Uint8Array(65)),
        /not wallet-signed/);
});

test("amounts render as scaled decimal strings", () => {
    // The wallet shows what a person would say out loud: no padding, no trailing
    // zeros. Every implementation hashes this string, so drift here is a silent fork.
    for (const [quantums, expected] of [
        [0n, "0"],
        [1n, "0.000001"],
        [999999n, "0.999999"],
        [1000000n, "1"],
        [10000000n, "10"],
        [10500000n, "10.5"],
        [10000001n, "10.000001"],
        [18446744073709551615n, "18446744073709.551615"],
    ]) {
        assert.equal(formatAmount(quantums, 6), expected, `quantums=${quantums}`);
    }
});

test("an unknown asset falls back to the opaque wrapper", () => {
    // An asset the table cannot name falls back rather than inventing a name or
    // a scale. A dialog reading "USDC" for something that is not USDC is worse
    // than one reading a hash.
    const known = raw(3, new DexTransferTx(2n, 1, [
        new AccountTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 0, 10000000n, 0),
    ]));
    assert.notEqual(typedDataDigest(known), null);
    const unknown = raw(3, new DexTransferTx(2n, 1, [
        new AccountTransferItem(addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), 99, 10000000n, 0),
    ]));
    assert.equal(typedDataDigest(unknown), null);
    assert.equal(buildTypedData(unknown), null);
});

test("RevokeAgent digest matches the other implementations", () => {
    const txn = raw(4, new DexAgentTx(1788507274399n, 1, new AgentRevoke("coid-test")));
    assert.equal(hex(typedDataDigest(txn)),
        "91e47b3a44dcd00e33c5c6b5277804227582172be55877c3e339ec2ebf1636f4");
});

test("RevokeAllAgents reaches its own type and digest", () => {
    // Its own primary type, not a RevokeAgent with an empty name: the operation
    // declares an end state, so a dialog naming one grant would name a grant that
    // is not the one being pulled. The digests differ for that reason, and both
    // come from the chain's cross-implementation vectors.
    const txn = raw(4, DexAgentTx.revokeAll(1788507274400n));
    const td = buildTypedData(txn);
    assert.equal(td.primaryType, "IntentionTransaction_RevokeAllAgents");
    assert.deepEqual(td.types.IntentionTransaction_RevokeAllAgents, [
        { name: "intentionChain", type: "string" },
        { name: "nonce", type: "uint64" },
        { name: "digest", type: "bytes32" },
    ]);
    assert.equal(hex(typedDataDigest(txn)),
        "29a63958d3745a32f423b78e4c4ed2265ead2760cdf91d76dec6132790478d42");
});

test("a multisig submission is wallet-signed as an envelope", () => {
    // The submitting owner sees which account and which operation they are
    // broadcasting; the k-of-n approvals inside the payload are a separate
    // signature set, checked on the execution path. So this payload must take the
    // typed-data branch rather than fall back to the opaque wrapper.
    const op = new MultisigOpInstall(
        [new Uint8Array(20).fill(0xa1), new Uint8Array(20).fill(0xa2), new Uint8Array(20).fill(0xa3)],
        2,
    );
    const txn = raw(6, new DexMultisigTx(11n, addr("0x001ebbde289635ae8ad2f2ec1080af75e00705f9"), op));
    const td = buildTypedData(txn);
    assert.equal(td.primaryType, "IntentionTransaction_MultisigSubmit");
    assert.equal(td.message.account, "0x001ebbde289635ae8ad2f2ec1080af75e00705f9");
    assert.equal(td.message.operation, "install_policy");
    assert.equal(td.message.nonce, "11");
    assert.notEqual(typedDataDigest(txn), null);

    const signature = new Uint8Array(65);
    const sk = new Uint8Array(32).fill(7);
    const sig = secp256k1.sign(typedDataDigest(txn), sk);
    signature.set(sig.toCompactRawBytes(), 0);
    signature[64] = 27 + sig.recovery;
    // Recovers a key and assembles a submittable transaction, which is what says
    // the envelope really is on the wallet path.
    assert.ok(signedTransactionFromWalletSignature(txn, signature).length > 0);
});

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Multisig signing against checked-in reference vectors.
 * Operations are rebuilt from the recorded inputs, then compared with the
 * expected bytes and digests. This checks payload construction as well as hashing.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AccountAddress } from "../src/core/accountAddress";
import {
    AccountTransferItem,
    AgentApprove,
    BridgeSignature,
    DexOrderlessTx,
    AgentRevoke,
    CreateSubAccount,
    CrossTransferItem,
    DexAgentTx,
    DexTransferTx,
    InternalTransferItem,
} from "../src/transactions/dexPayloads";
import {
    deriveMultisigAccountAddress,
    DexMultisigTx,
    GatedPayload,
    KeyProofEd25519,
    MultisigOp,
    MultisigOpCreate,
    MultisigOpExecute,
    MultisigOpInstall,
    MultisigOpRemove,
    MultisigOpRotateKey,
    MultisigOpUpdatePolicy,
    multisigOperationId,
    multisigOwnersDigest,
    MultisigProof,
    opKindByte,
    submitOperationName,
} from "../src/transactions/multisigPayloads";
import {
    approvalTypedData,
    createTypedData,
    keyChallengeTypedData,
    submitStructHash,
} from "../src/transactions/multisigTypedData";
import { domainSeparator } from "../src/transactions/typedData";
import {
    AccountType,
    AgentOperationVariant,
    CrossTransferOption,
    DexOrderlessTxVariant,
    DexTransferVariant,
    MultisigOpVariant,
    VaultTxVariant,
} from "../src/types/enums";
import { VaultDepositTx, VaultTx } from "../src/transactions/vaultPayloads";

interface VectorCase {
    name: string;
    op_kind: number;
    op_bcs: string;
    op_id: string;
    submit_operation: string;
    submit_struct_hash: string | null;
    approval_digest: string | null;
    typed_data: {
        types: Record<string, { name: string; type: string }[]>;
        primaryType: string;
        domain: Record<string, unknown>;
        message: Record<string, unknown>;
    } | null;
}

const vectors = JSON.parse(
    readFileSync(new URL("./fixtures/multisig_signing_vectors.json", import.meta.url), "utf8"),
) as {
    authorization_version: number;
    chain_id: number;
    chain_name: string;
    domain: { separator: string } & Record<string, unknown>;
    account: string;
    authority_epoch: number;
    expires_at_secs: number;
    submit_txn_digest: string;
    submit_nonce: number;
    operations: VectorCase[];
    create: {
        creator: string;
        owners: string[];
        threshold: number;
        salt: string;
        authority_epoch: number;
        op_bcs: string;
        op_id: string;
        approval_digest: string;
        typed_data: VectorCase["typed_data"];
    };
    key_challenge: {
        authority_epoch: number;
        new_auth_key: string;
        op_kind: number;
        digest: string;
        typed_data: VectorCase["typed_data"];
    };
};

const CHAIN_ID = vectors.chain_id;
const ACCOUNT = AccountAddress.fromString(vectors.account);
const EPOCH = BigInt(vectors.authority_epoch);
const EXPIRES = BigInt(vectors.expires_at_secs);

function hex(bytes: Uint8Array): string {
    return "0x" + Buffer.from(bytes).toString("hex");
}

function bytes(value: string): Uint8Array {
    return Uint8Array.from(Buffer.from(value.replace(/^0x/, ""), "hex"));
}

function repeated(byte: number, length = 32): Uint8Array {
    return new Uint8Array(length).fill(byte);
}

function evm(byte: number): AccountAddress {
    const raw = new Uint8Array(32);
    raw.fill(byte, 12);
    return new AccountAddress(raw);
}

const OWNERS = [repeated(0xa1, 20), repeated(0xa2, 20), repeated(0xa3, 20)];

function keyProof(): KeyProofEd25519 {
    return new KeyProofEd25519(repeated(0x02), new Uint8Array(64));
}

function accountTransfer(nonce: bigint, items: [number, bigint][]): MultisigOpExecute {
    return new MultisigOpExecute(
        GatedPayload.transfer(
            new DexTransferTx(
                nonce,
                DexTransferVariant.AccountTransfer,
                items.map(([to, amount]) => new AccountTransferItem(evm(to), 0, amount, AccountType.Perp)),
            ),
        ),
    );
}

function crossTransfer(
    nonce: bigint,
    option: CrossTransferOption,
    items: [number, bigint][],
): MultisigOpExecute {
    return new MultisigOpExecute(
        GatedPayload.transfer(
            new DexTransferTx(
                nonce,
                DexTransferVariant.CrossTransfer,
                items.map(([to, amount]) => new CrossTransferItem(evm(to), 0, amount, AccountType.Perp)),
                option,
            ),
        ),
    );
}

function internalTransfer(nonce: bigint, items: [number, number, bigint][]): MultisigOpExecute {
    return new MultisigOpExecute(
        GatedPayload.transfer(
            new DexTransferTx(
                nonce,
                DexTransferVariant.InternalTransfer,
                items.map(
                    ([from, to, amount]) =>
                        new InternalTransferItem(evm(from), evm(to), 0, amount, AccountType.Perp),
                ),
            ),
        ),
    );
}

/**
 * The eighteen operations recorded by the reference vectors, in fixture order.
 * Explicit inputs ensure every supported variant exercises the renderer.
 */
function everyOperation(): MultisigOp[] {
    return [
        new MultisigOpCreate(OWNERS, 2, repeated(0x00)),
        new MultisigOpInstall(OWNERS, 2),
        new MultisigOpUpdatePolicy(OWNERS, 3),
        new MultisigOpRemove(repeated(0x01), keyProof()),
        new MultisigOpRotateKey(repeated(0x01), keyProof()),
        accountTransfer(17n, [[0x5a, 1_000_500_000n]]),
        accountTransfer(18n, [
            [0x5a, 1n],
            [0x5b, 2n],
        ]),
        crossTransfer(19n, CrossTransferOption.Burn, [[0x6a, 5_000_000n]]),
        crossTransfer(20n, CrossTransferOption.Burn, [
            [0x6a, 1n],
            [0x6b, 2n],
        ]),
        // A mint credits a bridge deposit: not an owner's business, so no document.
        crossTransfer(21n, CrossTransferOption.Mint, [[0x6a, 1n]]),
        internalTransfer(22n, [[0x11, 0x12, 7_250_000n]]),
        internalTransfer(23n, [
            [0x11, 0x12, 1n],
            [0x11, 0x13, 2n],
        ]),
        // Non-mainnet and meaningless on a policy account: no document.
        new MultisigOpExecute(
            GatedPayload.transfer(
                new DexTransferTx(24n, DexTransferVariant.FaucetMint, [
                    new CrossTransferItem(evm(0x11), 0, 1n, AccountType.Perp),
                ]),
            ),
        ),
        new MultisigOpExecute(
            GatedPayload.agent(
                new DexAgentTx(
                    25n,
                    AgentOperationVariant.Approve,
                    new AgentApprove("market-maker", evm(0x7a), 1_900_000_000n),
                ),
            ),
        ),
        new MultisigOpExecute(
            GatedPayload.agent(
                new DexAgentTx(26n, AgentOperationVariant.Revoke, new AgentRevoke("market-maker")),
            ),
        ),
        new MultisigOpExecute(GatedPayload.agent(DexAgentTx.revokeAll(29n))),
        new MultisigOpExecute(GatedPayload.createSubAccount(new CreateSubAccount(27n, "treasury"))),
        new MultisigOpExecute(
            GatedPayload.vault(new VaultTx(VaultTxVariant.Deposit, new VaultDepositTx(3n, 28n, 10_000_000n))),
        ),
    ];
}

/**
 * The document the chain records carries its `EIP712Domain` entry; this SDK's
 * documents do not, because `viem` and `wagmi` supply that type themselves and a
 * second copy in `types` is what makes some wallets refuse the request. Every
 * other type, and every field in it, has to match.
 */
function assertTypesMatch(ours: Record<string, { name: string; type: string }[]>, theirs: Record<string, { name: string; type: string }[]>, label: string): void {
    const expected = Object.fromEntries(
        Object.entries(theirs).filter(([name]) => name !== "EIP712Domain"),
    );
    assert.deepEqual(Object.keys(ours).sort(), Object.keys(expected).sort(), `${label}: type names`);
    for (const [name, fields] of Object.entries(expected)) {
        assert.deepEqual(ours[name], fields, `${label}: fields of ${name}`);
    }
}

describe("multisig signing vectors", () => {
    it("the fixture is the version this SDK implements", () => {
        assert.equal(vectors.authorization_version, 1);
        assert.equal(vectors.operations.length, 18);
    });

    it("the domain separator is the one the chain hashes", () => {
        assert.equal(hex(domainSeparator(CHAIN_ID)), vectors.domain.separator);
    });

    const operations = everyOperation();

    for (const [index, expected] of vectors.operations.entries()) {
        const op = operations[index];

        it(`${expected.name}: BCS, operation id and envelope`, () => {
            assert.equal(hex(op.bcsToBytes()), expected.op_bcs, "operation BCS");
            assert.equal(opKindByte(op), expected.op_kind, "operation kind byte");
            assert.equal(submitOperationName(op), expected.submit_operation, "envelope operation name");

            const opId = multisigOperationId(CHAIN_ID, ACCOUNT, EPOCH, op, EXPIRES);
            assert.equal(hex(opId), expected.op_id, "operation id");

            const envelope = submitStructHash(
                CHAIN_ID,
                ACCOUNT,
                op,
                BigInt(vectors.submit_nonce),
                bytes(vectors.submit_txn_digest),
            );
            assert.equal(envelope && hex(envelope), expected.submit_struct_hash, "envelope struct hash");
        });

        it(`${expected.name}: ${expected.approval_digest ? "the document owners sign" : "has no owner-signed document"}`, () => {
            const opId = multisigOperationId(CHAIN_ID, ACCOUNT, EPOCH, op, EXPIRES);
            const approval = approvalTypedData(CHAIN_ID, ACCOUNT, EPOCH, op, EXPIRES, opId);

            if (expected.approval_digest === null) {
                // A refusal, not an omission: an operation whose fields cannot be
                // shown must not be approvable, and an SDK that produced a digest
                // here would let a partner sign something the chain refuses.
                assert.equal(approval, null);
                assert.equal(expected.typed_data, null);
                return;
            }

            assert.ok(approval, "this operation has a document");
            assert.equal(hex(approval.digest), expected.approval_digest, "approval digest");
            assert.equal(approval.typedData.primaryType, expected.typed_data!.primaryType);
            assert.deepEqual(approval.typedData.domain, expected.typed_data!.domain);
            assert.deepEqual(approval.typedData.message, expected.typed_data!.message);
            assertTypesMatch(approval.typedData.types, expected.typed_data!.types, expected.name);
        });
    }

    it("create: derived address, BCS, operation id and document", () => {
        const creator = AccountAddress.fromString(vectors.create.creator);
        const salt = bytes(vectors.create.salt);
        const op = new MultisigOpCreate(vectors.create.owners, vectors.create.threshold, salt);

        assert.equal(hex(op.bcsToBytes()), vectors.create.op_bcs, "operation BCS");

        const opId = multisigOperationId(
            CHAIN_ID,
            ACCOUNT,
            BigInt(vectors.create.authority_epoch),
            op,
            EXPIRES,
        );
        assert.equal(hex(opId), vectors.create.op_id, "operation id");

        const document = createTypedData(CHAIN_ID, ACCOUNT, creator, op, EXPIRES, opId);
        assert.ok(document);
        assert.equal(hex(document.digest), vectors.create.approval_digest, "approval digest");
        assert.equal(document.typedData.primaryType, vectors.create.typed_data!.primaryType);
        assert.deepEqual(document.typedData.message, vectors.create.typed_data!.message);
        assertTypesMatch(document.typedData.types, vectors.create.typed_data!.types, "create");
    });

    /**
     * The address in the fixture, derived from the creator and salt it records.
     *
     * Pinned here because a wrong derivation is the one mistake that cannot be
     * recovered from: funds are sent to an address before the policy is installed,
     * and nobody holds a key for the one that was computed wrong.
     */
    it("create: the address is a pure function of creator and salt", () => {
        const creator = AccountAddress.fromString(vectors.create.creator);
        const derived = deriveMultisigAccountAddress(creator, bytes(vectors.create.salt));

        assert.equal(
            derived.toStringLong(),
            "0x000000000000000000000000e7fff47cbfa3957f8d7fa7c02f1cef17aa8e2f99",
        );
        assert.deepEqual(
            derived.toUint8Array().slice(0, 12),
            new Uint8Array(12),
            "a derived address must be EVM-formatted so a wallet can render it",
        );
        assert.notEqual(
            deriveMultisigAccountAddress(creator, repeated(0x05)).toStringLong(),
            derived.toStringLong(),
            "a different salt must give a different account",
        );
    });

    it("key challenge: digest and document", () => {
        const challenge = keyChallengeTypedData(
            CHAIN_ID,
            ACCOUNT,
            BigInt(vectors.key_challenge.authority_epoch),
            bytes(vectors.key_challenge.new_auth_key),
            vectors.key_challenge.op_kind,
        );

        assert.ok(challenge);
        assert.equal(hex(challenge.digest), vectors.key_challenge.digest);
        assert.equal(challenge.typedData.primaryType, vectors.key_challenge.typed_data!.primaryType);
        assert.deepEqual(challenge.typedData.message, vectors.key_challenge.typed_data!.message);
        assertTypesMatch(challenge.typedData.types, vectors.key_challenge.typed_data!.types, "key challenge");
    });

    /**
     * The whole envelope, which the fixture does not cover: its cases stop at the
     * operation, because that is what owners sign.
     *
     * These two strings were printed by the chain's own types (a
     * `bcs::to_bytes` over `DexOrderlessTx::Multisig`), so
     * they pin the part an SDK gets wrong silently: the envelope's field order and
     * the `Option<MultisigProof>` tag. A proof written in the wrong place does not
     * fail as a missing field - the node reads the next length byte as data and
     * answers `INVALID_SIGNATURE`, which names neither the field nor the side that
     * differs.
     */
    it("the envelope carries nonce, account, operation and an optional proof, in that order", () => {
        const op = new MultisigOpExecute(GatedPayload.agent(DexAgentTx.revokeAll(29n)));
        const opId = multisigOperationId(CHAIN_ID, ACCOUNT, EPOCH, op, EXPIRES);
        const proof = new MultisigProof(opId, EPOCH, EXPIRES, [
            new BridgeSignature(repeated(0x31), repeated(0x32), 27),
            new BridgeSignature(repeated(0x41), repeated(0x42), 28),
        ]);
        const envelope = new DexOrderlessTx(
            DexOrderlessTxVariant.Multisig,
            new DexMultisigTx(7n, ACCOUNT, op, proof),
        );

        assert.equal(
            hex(envelope.bcsToBytes()),
            "0x060700000000000000000000000000000000000000111111111111111111111111111111111111111105021d000000000000000201ee20e2ba2928a3c191dff8f1244c7b335fe8064ba8a11ad628abac979e18333a030000000000000000d2496b0000000002313131313131313131313131313131313131313131313131313131313131313132323232323232323232323232323232323232323232323232323232323232321b414141414141414141414141414141414141414141414141414141414141414142424242424242424242424242424242424242424242424242424242424242421c",
        );

        assert.equal(envelope.nonce, 7n, "the envelope nonce is the submitting key's");
    });

    it("a rotate-key envelope carries no proof", () => {
        // The one operation authorized by the account's own key plus the incoming
        // key's challenge. The chain refuses a surplus proof here as firmly as a
        // missing one, and it does so in the mempool.
        const op = new MultisigOpRotateKey(repeated(0x01), keyProof());
        assert.equal(op.requiresThresholdProof, false);

        const envelope = new DexOrderlessTx(
            DexOrderlessTxVariant.Multisig,
            new DexMultisigTx(8n, ACCOUNT, op),
        );

        assert.equal(
            hex(envelope.bcsToBytes()),
            "0x0608000000000000000000000000000000000000001111111111111111111111111111111111111111040101010101010101010101010101010101010101010101010101010101010101010202020202020202020202020202020202020202020202020202020202020202400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        );
    });

    /** The commitment `AuthorityChangedEvent` carries instead of the owner list. */
    it("the owners digest is the one the event and the read endpoint report", () => {
        assert.equal(
            hex(multisigOwnersDigest(OWNERS)),
            "0x722e732621398d7da39e5660da787eac27341e74a86b5bb111a8e17dbd45b1a6",
        );
    });

    /**
     * The challenge's `operation` is the operation *kind*, and the fixture's is a
     * `Remove`. Stated here because the field is a bare `uint8` in the dialog: a
     * caller that passed the gated-payload kind, or the `16 +` form the operation
     * id uses, would produce a signature the chain cannot match to the handover
     * it is being presented for.
     */
    it("key challenge: the operation field is the Remove kind", () => {
        assert.equal(vectors.key_challenge.op_kind, MultisigOpVariant.Remove);
    });
});

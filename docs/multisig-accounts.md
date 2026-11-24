# Multisig accounts

An account can be controlled by one key, or jointly by a group under a threshold.
The chain keeps one optional `authority` record per account:

- **No record** (the vast majority of accounts): whoever holds the public key the
  address derives from can sign for it. Exactly as before.
- **Record is `key`**: one controlling key, named explicitly. The address stays
  the same and the key can be replaced.
- **Record is `policy`**: a k-of-n owner set. The account's own key, if it has
  one, can no longer sign for it.

On a policy account, the operations that move funds or grant authority require
enough signatures to meet the threshold. Owners sign an EIP-712 document with an
ordinary EVM wallet; the chain recovers each address from its signature and
counts **distinct addresses** - one key signing three times still counts once.

## 1. Three signatures, in a fixed order

| Order | Who signs | What | SDK entry point |
| --- | --- | --- | --- |
| 1 | the new key taking over the account (only `Remove` / `RotateKey`) | `IntentionMultisig_KeyChallenge` | `keyChallengeTypedData()` / `keyChallengeBytes()` |
| 2 | the owners | `IntentionMultisig_*` (one type per operation) | `approvalTypedData()`, or `createTypedData()` for `Create` |
| 3 | the submitting owner | `IntentionTransaction_MultisigSubmit` (the transaction envelope) | `buildTypedData(rawTx)` |

The order cannot be rearranged. The operation id hashes the whole operation and
the new key's proof sits inside that operation, so the challenge binds only the
*kind* of operation, not its id; the owners' approval digest then covers the
complete operation with the proof already in place.

Approvals can be collected over several days before submission: they live in the
payload, not in the transaction envelope. An orderless transaction is valid for
65 seconds, which is not enough to gather a round of committee signatures.

## 2. Creating a multisig account

The address is derived, with no private key behind it:
`[0;12] || sha3_256("dex.multisig.v1" || creator || salt)[..20]`. It can be computed
before any transaction is sent, so you can derive the address first and have
funds sent to it afterwards.

```ts
import {
    MultisigOpCreate, DexMultisigTx, MultisigProof, DexOrderlessTx, DexOrderlessTxVariant,
    deriveMultisigAccountAddress, multisigOperationId, createTypedData,
    evmSignatureFromCompact, validateMultisigPolicy,
} from "intention-ts-sdk";

const owners = ["0xa1a1...a1", "0xa2a2...a2", "0xa3a3...a3"];   // 20-byte EVM addresses
const problem = validateMultisigPolicy(owners, 2);               // same shape checks as on chain
if (problem) throw new Error(problem);

const salt = crypto.getRandomValues(new Uint8Array(32));
const account = deriveMultisigAccountAddress(creator, salt);     // funding address
const op = new MultisigOpCreate(owners, 2, salt);

// epoch is 0 at creation: the account does not exist yet.
const opId = multisigOperationId(chainId, account, 0n, op, expiresAtSecs);
const { typedData } = createTypedData(chainId, account, creator, op, expiresAtSecs, opId)!;
// Hand typedData to two owners' wallets (eth_signTypedData_v4) and collect 65-byte signatures.
const proof = new MultisigProof(opId, 0n, BigInt(expiresAtSecs), signatures.map(evmSignatureFromCompact));

const tx = new DexMultisigTx(envelopeNonce, account, op, proof);
const payload = new DexOrderlessTx(DexOrderlessTxVariant.Multisig, tx);
```

The signatures on `Create` are a **liveness proof**, not an authorization:
nothing is being taken from anyone. They prove that at least `threshold` of those
addresses are keys someone actually holds - before funds arrive at an address
only they can move.

## 3. Converting an existing account, and converting back

| Operation | Submitted by | Signatures required | Notes |
| --- | --- | --- | --- |
| `MultisigOpInstall` | the account itself | k of the new owner set | Address and history are kept. Afterwards a direct submission by the original key is rejected with `DEX_AUTHORITY_BLOCKED` |
| `MultisigOpUpdatePolicy` | any owner | enough from **both** the current and the proposed set | Counting both sides is what stops a typo in the owner list from locking the funds away |
| `MultisigOpRemove` | any owner | k from the current set, plus the new key's challenge signature | Returns to a single key. The new key must be named: otherwise the account would be handed to "the original key", and a derived address has no key at all |
| `MultisigOpRotateKey` | the account itself (current key) | **no owner proof**, only the new key's challenge signature | The one operation that does not go through the threshold; including a proof anyway is rejected |

Every change increments the epoch, which invalidates all unused approvals at the
same time.

Warning: `Remove` and `RotateKey` **clear every agent authorization on the account**
(both directions of the index). The account changed hands, and hot keys granted
earlier do not travel with it. Clearing does not touch the order book: resting
orders stay on the market and have to be cancelled by whoever controls the
account now.

## 4. Making a multisig account act: `Execute`

Only these three can be authorized by the threshold. Placing and cancelling
orders are **not** among them; that path belongs to agents only.

```ts
GatedPayload.transfer(dexTransferTx)        // transfer / withdrawal / move between subaccounts
GatedPayload.agent(dexAgentTx)              // grant / revoke / revoke all
GatedPayload.createSubAccount(createSubAcc) // open a subaccount
```

```ts
const op = new MultisigOpExecute(GatedPayload.agent(DexAgentTx.revokeAll(nonce)));
const opId = multisigOperationId(chainId, account, epoch, op, expiresAtSecs);
const { typedData, digest } = approvalTypedData(chainId, account, epoch, op, expiresAtSecs, opId)!;
```

`approvalTypedData()` returning `null` does not mean "not supported yet"; it is a
**refusal**. The operation's fields cannot be rendered in a wallet as something a
human can read (an asset id not in the table, an address whose top 12 bytes are
non-zero, an empty batch), or it is not an operation owners should be signing at
all, as with `Create` and `RotateKey`. The chain refuses the same inputs. Do not
fall back to asking someone to sign a bare hash.

A few rules that are easy to get wrong:

- **Revoking an agent also needs the threshold.** Both `Revoke` and `RevokeAll`
  now require k-of-n; without a proof they are rejected in the **mempool** with
  `DEX_MULTISIG_PROOF_MALFORMED`, not aborted after inclusion. The same applies
  to `InternalTransfer`.
- **`RevokeAll` is its own operation, not "a revoke with an empty name".** The
  latter is answered on chain with `DexAgentNotFound` - an error about the target
  for what is really a malformed shape - and a wallet would display "revoking one
  specific authorization", which is not what is being revoked.
- **A cross-chain `Mint` is not approved by owners.** It is the bridge recording
  an incoming deposit, authorized by the bridge's committee. Only `Burn`
  (withdrawal) goes through this path.
- **Moving funds out of a subaccount takes two steps**: `InternalTransfer` back
  to the master account, then a transfer out of the master. Both steps now need
  the threshold.

## 5. Reading on-chain state

```ts
const authority = await dexAccountClient.getAuthority(account);
// null = no record = controlled by the key the address derives from (not an error)
// authority.kind === "policy" -> owners / threshold / epoch / ownersDigest

const used = await dexAccountClient.isMultisigOperationUsed(opId);
// tells "my withdrawal already went through" apart from "my submission was lost"
```

There are two events. `AuthorityChangedEvent` reports that control changed, with
`opKind` naming which operation did it, and `MultisigOperationExecutedEvent`
reports that a policy account executed a gated payload, carrying its `opId`.
Neither event carries the **owner list** - up to ten addresses is too much
consensus bandwidth - only an `ownersDigest`. Recompute it yourself with
`multisigOwnersDigest(owners)` to compare; read `getAuthority()` when you need
the list itself.

## 6. Error reference

`multisigReasonName(abortCode)` turns an abort code into a name. The common ones:

| Code | Name | Usual cause |
| --- | --- | --- |
| `0x50049` | `DEX_MULTISIG_SIGNER_NOT_OWNER` | One signature recovered to an address that is not an owner. The whole proof is rejected rather than that one signature ignored |
| `0x5004a` | `DEX_MULTISIG_THRESHOLD_NOT_MET` | Not enough distinct owners after deduplication (one key signing several times counts once) |
| `0x5004b` | `DEX_MULTISIG_EPOCH_MISMATCH` | The epoch the signatures are bound to is no longer current; collect them again |
| `0x5004c` | `DEX_MULTISIG_PROOF_EXPIRED` | Past `expiresAtSecs`, or a validity window longer than the 30-day maximum |
| `0x5004d` | `DEX_MULTISIG_OPERATION_ALREADY_USED` | This op id already executed; funds move exactly once |
| `0x50044` | `DEX_MULTISIG_DIRECT_SUBMISSION_BLOCKED` | The original key of a policy account tried to submit an ordinary transaction |
| `0x50052` | `DEX_MULTISIG_DERIVED_ADDRESS_MISMATCH` | The account in `Create` is not the address that creator + salt derive to |

## 7. How to submit

Multisig transactions can **only** be submitted over BCS; the JSON submission
path rejects them outright (`UnsupportedJsonPayloadError`). Owner signatures
travel only on the BCS path. The JSON view is an audit summary for an explorer
(account, operation name, number of signatures) and cannot reconstruct the bytes
that were signed.

The cross-language fixed vectors are `multisig_signing_vectors.json` in the
chain, and `tests/fixtures/multisig_signing_vectors.json` here is a copy of it
without the validator cases, which this SDK does not build.
`tests/multisigVectors.test.ts` reproduces, byte for byte, the BCS, operation id,
approval digest and signing document of 17 operations, plus the derived address
and the challenge digest. Changing any one of those bytes invalidates every owner
signature already collected.

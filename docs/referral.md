# Referral client

`Intention.referrals` provides queries. `IntentionClient.referrals` also signs,
submits and confirms transactions with the configured signer.

## Queries

Configure the relayer URL for queries and the node URL for transactions. Base
URLs may include or omit `/v1`.

```ts
const overview = await sdk.referrals.getOverview(master);
const resolved = await sdk.referrals.resolveCode("ABC123");
const config = await sdk.referrals.getConfig();
const reserved = await sdk.referrals.getReservedCodes();
const availability = await sdk.referrals.getCodeAvailability("ABC123");
const invitees = await sdk.referrals.getInvitees(master, { limit: 50 });
const sources = await sdk.referrals.getSources(master, { limit: 50 });
const claims = await sdk.referrals.getClaims(master, { limit: 50, page: 1 });
const fills = await sdk.referrals.getFills(master, { limit: 50 });
```

Here `sdk` is an `IntentionClient` and `master` is the account being queried.
Code resolution and availability queries normalize codes to uppercase. Use
`resolved.referrer` for account queries. Unknown codes return HTTP 404; an unready
index returns 503.

List cursors are opaque. Invitees and claims also accept a positive 1-based
`page`; do not combine it with `cursor`. Invitees support `sortBy` values
`timeJoined`, `volumeSinceBound`, `feePaid` and `commissionAccrued`, with
`sortOrder` set to `asc` or `desc`. Omitted sorting uses newest bindings first.

## User actions

Use a unique bigint nonce for every transaction.

```ts
await sdk.referrals.registerCode("ABC123", registerNonce);
await sdk.referrals.bindReferrer("DEF456", bindNonce);
const result = await sdk.referrals.claim(claimNonce);
```

ClaimAll claims the full available on-chain reward balance. Preflight reads the
active configuration and indexed overview to check that claims are enabled and
the balance meets the configured minimum. The chain validates the final balance
at execution, so indexing delays or concurrent claims can cause rejection. The
SDK does not retry automatically.

For an authorized agent, `claim(claimNonce, master)` claims on behalf of that
master; the chain fixes the recipient. `buildClaim({ master, nonce: claimNonce,
onBehalfOf })` returns a payload for separate signing. `buildRegisterCode`,
`buildBindReferrer` and `buildSetConfig` also expose unsigned payloads.
`setConfig(parameters, nonce, proof)` requires the appropriate administrator and
committee authorization and submits BCS to preserve the proof.

## Amounts and events

Display amounts are fixed-six-decimal USDC strings; `*Quantums` fields are exact
integer strings. `asOfBlockHeight` and `sourceSeqId` describe indexed coverage,
which can lag behind the node.

The unified DEX decoder handles registration, binding, configuration, reserved
codes, claims and per-fill fee supplements. Join `DexReferralFeeEvent` to its
fill by block height, symbol, fill ID and account identity. The original fill fee
already includes the discount. An account's `cumulativeReferralCommission` is
that trading subaccount's accrual; use the referral overview for the inviter's
claimable balance. Decoding supports the current per-account fee layout.

# Intention TypeScript SDK

TypeScript SDK for Intention DEX accounts, signing, transactions and on-chain
event decoding. Requires Node.js 20 or later and pnpm 8.15.1.

For WebSocket subscriptions, use Node.js 22 or later, or configure
`websocketOptions.webSocketFactory` on `IntentionClient` with a compatible
WebSocket implementation.

## Installation from source

```bash
git clone https://github.com/Intentionxyz/intention-ts-sdk.git
cd intention-ts-sdk
pnpm install --frozen-lockfile
pnpm build
```

- [Integration guide](docs/simplified-integration-guide.md)
- [Referral client](docs/referral.md)
- [Multisig accounts](docs/multisig-accounts.md)
- [Vault event decoding](docs/vault-events-v1.md)

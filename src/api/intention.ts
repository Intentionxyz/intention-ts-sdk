// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * High-level Intention client (IntentionConfig/Network).
 *
 * - new IntentionConfig({ network, nodeUrl, relayerUrl, wsUrl, faucet })
 * - new Intention(config)
 * - intention.getLedgerInfo()
 * - intention.fundAccount(...)
 * - intention.waitForTransaction(...)
 * - intention.transaction.sign(...)
 * - intention.transaction.submit.simple(...)
 */

import { AccountAddress } from "../core/accountAddress";
import { ReferralClient } from "./referralClient";
import { Account } from "../core/account";
import {
    type IntentionClientConfig,
    type JsonUnsupportedPayloadFallback,
    type PendingTransactionResponse,
    type TransactionSubmissionEncoding,
    type LedgerInfo,
    type TransactionResponse,
    TransactionExecutionError,
    submitTransaction as rawSubmitTransaction,
    getLedgerInfo as rawGetLedgerInfo,
    waitForTransaction as rawWaitForTransaction,
} from "./client";
import { generateSigningMessageForTransaction } from "../transactions/signingMessage";
import { SimpleTransaction, RawTransaction } from "../transactions/rawTransaction";
import { ChainId } from "../transactions/chainId";
import {
    DexTx,
    DexOrders,
    DexOrderlessTx,
    isCrossTransferOrderlessPayload,
    TransactionPayloadDexOrderless,
} from "../transactions/dexPayloads";
import { MAX_U64_BIG_INT } from "../bcs/serializer";
import { CreatedBy, DexOrderlessTxVariant } from "../types/enums";
import {
    decodeTransactionEvents,
    type DecodedDexEvent,
} from "../events/dexEventDecoder";
import { SimpleMarketResolver } from "../transactions/marketResolver";
import type { PerpMarketInput } from "../transactions/marketResolver";
import {
    AccountAuthenticatorSingleKey,
} from "../transactions/authenticator";

// =============================================================================
// Network enum
// =============================================================================

export enum Network {
    MAINNET = "mainnet",
    TESTNET = "testnet",
    DEVNET = "devnet",
    LOCAL = "local",
    CUSTOM = "custom",
}

// =============================================================================
// IntentionApiType
// =============================================================================

export enum IntentionApiType {
    FULLNODE = "fullnode",
    FAUCET = "faucet",
    INDEXER = "indexer",
    RELAYER = "relayer",
    WEBSOCKET = "websocket",
}

export interface DexOrderlessSubmitOptions {
    maxGasAmount?: bigint;
    gasUnitPrice?: bigint;
    /** Absolute expiration unix seconds; defaults to now + 60 seconds. */
    expirationTimestampSecs?: bigint;
    /**
     * Transaction-level replay nonce for CrossTransfer.
     *
     * This is independent from the bridge business nonce inside the payload.
     * A cryptographically random u64 is generated when omitted.
     */
    replayProtectionNonce?: bigint;
}

export interface DexOrderlessExecutionOptions extends DexOrderlessSubmitOptions {
    /** Maximum time to wait for commitment. Default: 30 seconds. */
    timeoutSecs?: number;
    /** REST polling interval while pending. Default: 1000ms. */
    pollIntervalMs?: number;
}

/** Confirmed result shared by non-order DEX account, agent, transfer and vault actions. */
export interface DexOrderlessExecutionResult {
    hash: string;
    transaction: TransactionResponse;
    events: DecodedDexEvent[];
}

function generateCrossTransferReplayNonce(): bigint {
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
        throw new Error(
            "CrossTransfer replay nonce generation requires Web Crypto; " +
                "pass options.replayProtectionNonce explicitly",
        );
    }
    const words = new Uint32Array(2);
    globalThis.crypto.getRandomValues(words);
    const nonce = (BigInt(words[0]) << 32n) | BigInt(words[1]);
    return nonce === MAX_U64_BIG_INT ? MAX_U64_BIG_INT - 1n : nonce;
}

// =============================================================================
// IntentionConfig
// =============================================================================

export interface IntentionConfigArgs {
    network?: Network;
    /** Canonical fullnode REST URL (normally ending in `/v1`). */
    nodeUrl?: string;
    /** DEX relayer REST base URL (used for markets, orderbook and trades). */
    relayerUrl?: string;
    /** DEX relayer WebSocket URL (v1_markets / v1_orderbook / v1_trades). */
    wsUrl?: string;
    /** @deprecated Use `nodeUrl`. */
    fullnode?: string;
    faucet?: string;
    indexer?: string;
    defaultSubmissionEncoding?: TransactionSubmissionEncoding;
    jsonUnsupportedPayloadFallback?: JsonUnsupportedPayloadFallback;
    /** @deprecated Use `relayerUrl`. Retained for backward compatibility. */
    dexRestUrl?: string;
    clientConfig?: {
        HEADERS?: Record<string, string>;
        [key: string]: unknown;
    };
}

export class IntentionConfig {
    readonly network: Network;
    readonly nodeUrl: string;
    readonly relayerUrl?: string;
    readonly wsUrl?: string;
    /** Backward-compatible alias of {@link nodeUrl}. */
    readonly fullnode: string;
    readonly faucet: string;
    readonly indexer?: string;
    readonly defaultSubmissionEncoding: TransactionSubmissionEncoding;
    readonly jsonUnsupportedPayloadFallback: JsonUnsupportedPayloadFallback;
    /** Backward-compatible DEX REST URL. Prefer {@link relayerUrl}. */
    readonly dexRestUrl?: string;
    readonly clientConfig?: { HEADERS?: Record<string, string>;[key: string]: unknown };

    constructor(args: IntentionConfigArgs = {}) {
        this.network = args.network ?? Network.DEVNET;
        this.nodeUrl = args.nodeUrl ?? args.fullnode ?? "";
        this.relayerUrl = args.relayerUrl;
        this.wsUrl = args.wsUrl;
        this.fullnode = this.nodeUrl;
        this.faucet = args.faucet ?? "";
        this.indexer = args.indexer;
        this.defaultSubmissionEncoding = args.defaultSubmissionEncoding ?? "json";
        this.jsonUnsupportedPayloadFallback =
            args.jsonUnsupportedPayloadFallback ?? "bcs";
        this.dexRestUrl = args.relayerUrl ?? args.dexRestUrl;
        this.clientConfig = args.clientConfig;
    }

    /** Get the request URL for a specific API type. */
    getRequestUrl(apiType: IntentionApiType): string {
        switch (apiType) {
            case IntentionApiType.FULLNODE:
                return this.fullnode;
            case IntentionApiType.FAUCET:
                return this.faucet;
            case IntentionApiType.INDEXER:
                return this.indexer ?? "";
            case IntentionApiType.RELAYER:
                return this.relayerUrl ?? this.dexRestUrl ?? "";
            case IntentionApiType.WEBSOCKET:
                return this.wsUrl ?? "";
            default:
                return this.nodeUrl;
        }
    }

    /** Convert to IntentionClientConfig for low-level API calls. */
    toClientConfig(): IntentionClientConfig {
        return {
            nodeUrl: this.nodeUrl,
            defaultSubmissionEncoding: this.defaultSubmissionEncoding,
            jsonUnsupportedPayloadFallback: this.jsonUnsupportedPayloadFallback,
        };
    }
}

// =============================================================================
// Intention client
// =============================================================================

/** Minimal shape of a `/v1/perpetualMarkets` entry needed to build a resolver. */
interface PerpetualMarketApiEntry {
    clobPairId: string | number;
    atomicResolution: number;
    quantumConversionExponent: number;
    stepBaseQuantums: number | string;
    subticksPerTick: number | string;
    status?: "ACTIVE" | "INACTIVE" | "PAUSED";
}

export class Intention {
    readonly config: IntentionConfig;
    readonly transaction: TransactionHelper;
    readonly referrals: ReferralClient;

    constructor(config: IntentionConfig) {
        this.config = config;
        this.transaction = new TransactionHelper(this);
        this.referrals=new ReferralClient(this);
    }

    /** Get ledger info (chain_id, etc.) */
    async getLedgerInfo(): Promise<LedgerInfo> {
        return rawGetLedgerInfo(this.config.toClientConfig());
    }

    /**
     * Fetch perpetual markets from the DEX REST API `GET /v1/perpetualMarkets`
     * and build a populated {@link SimpleMarketResolver} (keyed by ticker, e.g.
     * "BTC-USDC"). Feed the resolver to `OrderIntents` / `OrderClient`.
     *
     * URL precedence: `args.restUrl` > `config.relayerUrl` >
     * `config.dexRestUrl` > `config.indexer`.
     */
    async fetchPerpetualMarkets(args?: {
        restUrl?: string;
        /** Keep only these statuses (default: all). */
        statuses?: Array<"ACTIVE" | "INACTIVE" | "PAUSED">;
    }): Promise<SimpleMarketResolver> {
        const base =
            args?.restUrl ??
            this.config.relayerUrl ??
            this.config.dexRestUrl ??
            this.config.indexer;
        if (!base) {
            throw new Error(
                "fetchPerpetualMarkets: no relayer URL (set IntentionConfig.relayerUrl or pass args.restUrl)",
            );
        }
        const url = `${base.replace(/\/+$/, "")}/v1/perpetualMarkets`;
        const response = await fetch(url, { headers: this.config.clientConfig?.HEADERS });
        if (!response.ok) {
            throw new Error(
                `fetchPerpetualMarkets failed: ${response.status} ${response.statusText}`,
            );
        }
        const body = (await response.json()) as {
            code?: number;
            message?: string;
            data?: { markets?: Record<string, PerpetualMarketApiEntry> };
        };
        if (body.code != null && body.code !== 0) {
            throw new Error(`fetchPerpetualMarkets API error: ${body.message ?? body.code}`);
        }
        const markets = body.data?.markets ?? {};
        const inputs: PerpMarketInput[] = [];
        for (const [ticker, m] of Object.entries(markets)) {
            if (args?.statuses && m.status != null && !args.statuses.includes(m.status)) {
                continue;
            }
            inputs.push({
                symbol: ticker,
                clobPairId: m.clobPairId,
                atomicResolution: m.atomicResolution,
                quantumConversionExponent: m.quantumConversionExponent,
                stepBaseQuantums: m.stepBaseQuantums,
                subticksPerTick: m.subticksPerTick,
            });
        }
        return new SimpleMarketResolver(inputs);
    }

    /**
     * Sign and submit any already-built DEX orderless transaction.
     *
     * This is the common low-latency path used by account, agent, transfer,
     * vault and order clients. It returns after node acceptance, before
     * commitment.
     */
    async submitDexOrderless(args: {
        signer: Account;
        orderlessTx: DexOrderlessTx;
        options?: DexOrderlessSubmitOptions;
    }): Promise<PendingTransactionResponse> {
        const payload = new TransactionPayloadDexOrderless(args.orderlessTx);
        const ledgerInfo = await this.getLedgerInfo();
        const maxGasAmount = args.options?.maxGasAmount ?? 5000n;
        const gasUnitPrice = args.options?.gasUnitPrice ?? 2000n;
        const expirationTimestampSecs =
            args.options?.expirationTimestampSecs ??
            BigInt(Math.floor(Date.now() / 1000) + 60);
        const chainId = new ChainId(ledgerInfo.chain_id);
        const rawTx = isCrossTransferOrderlessPayload(payload)
            ? RawTransaction.createCrossTransferOrderless(
                  args.signer.accountAddress,
                  payload,
                  args.options?.replayProtectionNonce ??
                      generateCrossTransferReplayNonce(),
                  maxGasAmount,
                  gasUnitPrice,
                  expirationTimestampSecs,
                  chainId,
              )
            : RawTransaction.createOrderless(
                  args.signer.accountAddress,
                  payload,
                  maxGasAmount,
                  gasUnitPrice,
                  expirationTimestampSecs,
                  chainId,
              );
        const transaction = new SimpleTransaction(rawTx);
        const senderAuthenticator = this.transaction.sign({
            signer: args.signer,
            transaction,
        });
        return this.transaction.submit.simple({ transaction, senderAuthenticator });
    }

    /**
     * Submit an orderless transaction, wait for commitment, check VM success,
     * and decode any known DEX events.
     */
    async executeDexOrderless(args: {
        signer: Account;
        orderlessTx: DexOrderlessTx;
        options?: DexOrderlessExecutionOptions;
    }): Promise<DexOrderlessExecutionResult> {
        const pending = await this.submitDexOrderless(args);
        const transaction = await this.waitForTransaction({
            transactionHash: pending.hash,
            options: {
                timeoutSecs: args.options?.timeoutSecs ?? 30,
                checkIntervalMs: args.options?.pollIntervalMs ?? 1000,
                checkSuccess: true,
            },
        });
        const rawEvents = Array.isArray(transaction.events)
            ? transaction.events.filter(
                  (event): event is { type: string; data: unknown } =>
                      typeof event === "object" &&
                      event !== null &&
                      typeof (event as { type?: unknown }).type === "string" &&
                      "data" in event,
              )
            : [];
        const events = decodeTransactionEvents(rawEvents).map(({ eventType, event }) => ({
            eventType,
            event,
        }));
        return { hash: pending.hash, transaction, events };
    }

    /**
     * Wrap wire-ready `DexOrders` (from `OrderIntents`) into an orderless DEX
     * transaction, sign with `signer`, and submit. This is the async glue that
     * ties `OrderIntents.build*` -> `DexTx` -> orderless payload -> sign -> submit.
     *
     * `sender` (tx signer) is `signer.accountAddress`; the order's subaccount is
     * carried inside each `DexPlaceOrder`/`DexCancelOrder` (built by `OrderIntents`).
     */
    async submitDexOrders(args: {
        signer: Account;
        dexOrders: DexOrders;
        createdBy?: CreatedBy;
        onBehalfOf?: AccountAddress;
        /** Replay-protection nonce; defaults to `Date.now()`. */
        nonce?: bigint;
        options?: {
            maxGasAmount?: bigint;
            gasUnitPrice?: bigint;
            /** Absolute expiration unix secs; defaults to now + 60s. */
            expirationTimestampSecs?: bigint;
        };
    }): Promise<PendingTransactionResponse> {
        const nonce = args.nonce ?? BigInt(Date.now());
        const dexTx = new DexTx(
            nonce,
            args.dexOrders,
            args.createdBy ?? CreatedBy.User,
            args.onBehalfOf,
        );
        const orderless = new DexOrderlessTx(DexOrderlessTxVariant.Dex, dexTx);
        return this.submitDexOrderless({
            signer: args.signer,
            orderlessTx: orderless,
            options: args.options,
        });
    }

    /**
     * Wait for a transaction to be confirmed.
     */
    async waitForTransaction(args: {
        transactionHash: string;
        options?: { timeoutSecs?: number; checkIntervalMs?: number; checkSuccess?: boolean };
    }): Promise<TransactionResponse> {
        const transaction = await rawWaitForTransaction(
            this.config.toClientConfig(),
            args.transactionHash,
            {
                timeoutMs: (args.options?.timeoutSecs ?? 30) * 1000,
                checkIntervalMs: args.options?.checkIntervalMs ?? 1000,
            },
        );
        if (args.options?.checkSuccess && !transaction.success) {
            throw new TransactionExecutionError(
                transaction.hash,
                transaction.vm_status,
                transaction,
            );
        }
        return transaction;
    }

    /**
     * Fund an account from the faucet.
     */
    async fundAccount(args: {
        accountAddress: string | AccountAddress;
        amount: number;
        options?: { timeoutSecs?: number; checkSuccess?: boolean };
    }): Promise<{ hash: string; success: boolean }> {
        const faucetUrl = this.config.faucet;
        const url = `${faucetUrl}/fund`;
        const address =
            typeof args.accountAddress === "string"
                ? args.accountAddress
                : args.accountAddress.toString();

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                address,
                amount: args.amount,
            }),
        });

        if (!response.ok) {
            throw new Error(
                `Faucet request failed: ${response.status} ${response.statusText}`,
            );
        }

        const data: { txn_hashes: string[] } = await response.json();
        const hash = data.txn_hashes[0];

        // If checkSuccess, wait for confirmation
        if (args.options?.checkSuccess && hash) {
            try {
                await this.waitForTransaction({
                    transactionHash: hash,
                    options: { timeoutSecs: args.options?.timeoutSecs ?? 30 },
                });
                return { hash, success: true };
            } catch {
                return { hash, success: false };
            }
        }

        return { hash, success: true };
    }

    /**
     * Get a block by height.
     */
    async getBlockByHeight(args: number | bigint | {
        blockHeight: number | bigint;
        options?: { withTransactions?: boolean };
    }, withTransactionsLegacy?: boolean): Promise<any> {
        let height: string;
        let withTxns: boolean;
        if (typeof args === "number" || typeof args === "bigint") {
            // Legacy positional-parameter style: getBlockByHeight(height, withTransactions)
            height = args.toString();
            withTxns = withTransactionsLegacy ?? false;
        } else {
            height = args.blockHeight.toString();
            withTxns = args.options?.withTransactions ?? false;
        }
        const url = `${this.config.fullnode}/blocks/by_height/${height}?with_transactions=${withTxns}`;
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get block by height: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get a block by version.
     */
    async getBlockByVersion(args: {
        ledgerVersion: number | bigint;
        options?: { withTransactions?: boolean };
    }): Promise<any> {
        const version = args.ledgerVersion.toString();
        const withTxns = args.options?.withTransactions ?? false;
        const url = `${this.config.fullnode}/blocks/by_version/${version}?with_transactions=${withTxns}`;
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get block by version: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Execute a view function.
     * Supports both new-style ({payload, options}) and legacy (viewRequest, ledgerVersion?) calling conventions.
     */
    async view<T extends any[]>(
        args: {
            payload: {
                function: string;
                type_arguments?: string[];
                functionArguments?: any[];
            };
            options?: { ledgerVersion?: string | number };
        } | {
            function: string;
            type_arguments?: string[];
            arguments?: any[];
        },
        legacyLedgerVersion?: string,
    ): Promise<T> {
        let url = `${this.config.fullnode}/view`;
        let body: any;

        if ("payload" in args) {
            // New-style: view({payload, options})
            if (args.options?.ledgerVersion !== undefined) {
                url += `?ledger_version=${args.options.ledgerVersion}`;
            }
            body = {
                function: args.payload.function,
                type_arguments: args.payload.type_arguments ?? [],
                arguments: args.payload.functionArguments ?? [],
            };
        } else {
            // Legacy-style: view(viewRequest, ledgerVersion?)
            if (legacyLedgerVersion !== undefined) {
                url += `?ledger_version=${legacyLedgerVersion}`;
            }
            body = {
                function: args.function,
                type_arguments: args.type_arguments ?? [],
                arguments: args.arguments ?? [],
            };
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...this.config.clientConfig?.HEADERS,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`View request failed: ${response.status} ${response.statusText}\n${errorBody}`);
        }
        return response.json();
    }

    /**
     * Get ANS name for an address (stub - returns undefined).
     * Explorer calls with { name: text } and expects { registered_address, owner_address }.
     */
    async getName(args: { name?: string; address?: string }): Promise<{ registered_address?: string; owner_address?: string } | undefined> {
        // Return undefined to indicate no name found.
        return undefined;
    }

    /**
     * Get account owned objects (stub - returns empty array).
     */
    async getAccountOwnedObjects(args: {
        accountAddress: string;
        options?: { limit?: number; offset?: number };
    }): Promise<any[]> {
        // Objects query requires indexer support.
        // Return empty array as fallback.
        return [];
    }

    /**
     * Get digital asset activity (stub - returns empty array).
     */
    async getDigitalAssetActivity(args: {
        digitalAssetAddress: string;
        options?: {
            limit?: number;
            offset?: number;
            orderBy?: Array<Record<string, string>>;
        };
    }): Promise<any[]> {
        // Digital asset indexer queries not available.
        return [];
    }

    /**
     * Query the indexer with a raw GraphQL query (stub).
     * Returns an empty-ish response matching the expected shape.
     */
    async queryIndexer<T = any>(args: {
        query: {
            query: string;
            variables?: Record<string, unknown>;
        };
    }): Promise<T> {
        // Indexer GraphQL queries not available in intention-ts-sdk.
        // Return a proxy that returns empty/zero for any property access.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new Proxy({} as any, {
            get: (_target: any, prop: string | symbol) => {
                if (prop === 'then') return undefined; // Not a thenable
                return { aggregate: { count: 0 } };
            },
        }) as T;
    }


    /**
     * Get a transaction by its hash.
     */
    async getTransactionByHash(args: string | {
        transactionHash: string;
    }): Promise<any> {
        const hash = typeof args === "string" ? args : args.transactionHash;
        const url = `${this.config.fullnode}/transactions/by_hash/${hash}`;
        const response = await fetch(url, {
            headers: { Accept: "application/json" },
        });

        if (!response.ok) {
            throw new Error(
                `Failed to get transaction: ${response.status} ${response.statusText}`,
            );
        }

        return response.json();
    }

    /**
     * Get account info (sequence number, authentication key, etc.).
     */
    async getAccountInfo(args: {
        accountAddress: string | AccountAddress;
    }): Promise<{ sequence_number: string; authentication_key: string }> {
        const address =
            typeof args.accountAddress === "string"
                ? args.accountAddress
                : args.accountAddress.toString();
        const url = `${this.config.fullnode}/accounts/${address}`;

        const response = await fetch(url, {
            headers: { Accept: "application/json" },
        });

        if (!response.ok) {
            throw new Error(
                `Failed to get account info: ${response.status} ${response.statusText}`,
            );
        }

        return response.json();
    }


    /**
     * Transfer fungible assets (e.g., USDC).
     */
    async transferFungibleAsset(args: {
        sender: string | AccountAddress | Account;
        fungibleAssetMetadataAddress: string;
        recipient: string | AccountAddress;
        amount: number;
        options?: { maxGasAmount?: number; gasUnitPrice?: number };
    }): Promise<SimpleTransaction> {
        const { buildTransaction, generateTransactionPayload } = await import("../transactions/transactionBuilder");
        const senderAddr = args.sender instanceof Account ? args.sender.accountAddress.toString() : (typeof args.sender === "string" ? args.sender : args.sender.toString());
        const recipientAddr = typeof args.recipient === "string" ? args.recipient : args.recipient.toString();

        const payload = await generateTransactionPayload({
            intentionConfig: this.config,
            function: "0x1::primary_fungible_store::transfer",
            type_arguments: ["0x1::fungible_asset::Metadata"],
            functionArguments: [args.fungibleAssetMetadataAddress, recipientAddr, args.amount],
        });

        return buildTransaction({
            intentionConfig: this.config,
            sender: senderAddr,
            payload,
            options: args.options,
        });
    }

    // =========================================================================
    // Legacy REST convenience methods (positional-parameter style)
    // Used by the explorer's api/index.ts
    // =========================================================================

    /**
     * Get a list of transactions.
     * Legacy positional-parameter API for explorer compatibility.
     */
    async getTransactions(params?: { start?: bigint; limit?: number }): Promise<any[]> {
        let url = `${this.config.fullnode}/transactions`;
        const qp: string[] = [];
        if (params?.start !== undefined) qp.push(`start=${params.start.toString()}`);
        if (params?.limit !== undefined) qp.push(`limit=${params.limit}`);
        if (qp.length > 0) url += `?${qp.join("&")}`;
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get transactions: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get transactions for a specific account.
     */
    async getAccountTransactions(
        address: string,
        params?: { start?: bigint; limit?: number },
    ): Promise<any[]> {
        let url = `${this.config.fullnode}/accounts/${address}/transactions`;
        const qp: string[] = [];
        if (params?.start !== undefined) qp.push(`start=${params.start.toString()}`);
        if (params?.limit !== undefined) qp.push(`limit=${params.limit}`);
        if (qp.length > 0) url += `?${qp.join("&")}`;
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get account transactions: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get transaction summaries for an account (includes both sequence-number and orderless transactions).
     */
    async getAccountTransactionSummaries(
        address: string,
        params?: { start?: bigint; limit?: number },
    ): Promise<{ sender: string; version: string; transaction_hash: string; replay_protector: string }[]> {
        let url = `${this.config.fullnode}/accounts/${address}/transaction_summaries`;
        const qp: string[] = [];
        if (params?.start !== undefined) qp.push(`start=${params.start.toString()}`);
        if (params?.limit !== undefined) qp.push(`limit=${params.limit}`);
        if (qp.length > 0) url += `?${qp.join("&")}`;
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get account transaction summaries: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get a transaction by version number.
     */
    async getTransactionByVersion(version: bigint): Promise<any> {
        const url = `${this.config.fullnode}/transactions/by_version/${version.toString()}`;
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get transaction by version: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get account data (sequence number, authentication key).
     */
    async getAccount(address: string): Promise<{ sequence_number: string; authentication_key: string }> {
        return this.getAccountInfo({ accountAddress: address });
    }

    /**
     * Get all resources for an account.
     */
    async getAccountResources(
        address: string,
        params?: { ledgerVersion?: bigint },
    ): Promise<any[]> {
        let url = `${this.config.fullnode}/accounts/${address}/resources`;
        if (params?.ledgerVersion !== undefined) {
            url += `?ledger_version=${params.ledgerVersion.toString()}`;
        }
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get account resources: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get a specific resource for an account.
     */
    async getAccountResource(
        address: string,
        resourceType: string,
        params?: { ledgerVersion?: bigint },
    ): Promise<any> {
        let url = `${this.config.fullnode}/accounts/${address}/resource/${encodeURIComponent(resourceType)}`;
        if (params?.ledgerVersion !== undefined) {
            url += `?ledger_version=${params.ledgerVersion.toString()}`;
        }
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get account resource: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get all modules for an account.
     */
    async getAccountModules(
        address: string,
        params?: { ledgerVersion?: bigint },
    ): Promise<any[]> {
        let url = `${this.config.fullnode}/accounts/${address}/modules`;
        if (params?.ledgerVersion !== undefined) {
            url += `?ledger_version=${params.ledgerVersion.toString()}`;
        }
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get account modules: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get a specific module for an account.
     */
    async getAccountModule(
        address: string,
        moduleName: string,
        params?: { ledgerVersion?: bigint },
    ): Promise<any> {
        let url = `${this.config.fullnode}/accounts/${address}/module/${encodeURIComponent(moduleName)}`;
        if (params?.ledgerVersion !== undefined) {
            url += `?ledger_version=${params.ledgerVersion.toString()}`;
        }
        const response = await fetch(url, {
            headers: { Accept: "application/json", ...this.config.clientConfig?.HEADERS },
        });
        if (!response.ok) {
            throw new Error(`Failed to get account module: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Get a table item by handle and key.
     */
    async getTableItem(
        tableHandle: string,
        data: { key_type: string; value_type: string; key: any },
    ): Promise<any> {
        const url = `${this.config.fullnode}/tables/${tableHandle}/item`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...this.config.clientConfig?.HEADERS,
            },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            throw new Error(`Failed to get table item: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
}

// =============================================================================
// Transaction helper (intention.transaction.sign / submit)
// =============================================================================

class TransactionHelper {
    private readonly intention: Intention;
    readonly submit: SubmitHelper;
    readonly build: BuildHelper;

    constructor(intention: Intention) {
        this.intention = intention;
        this.submit = new SubmitHelper(intention);
        this.build = new BuildHelper(intention);
    }

    /**
     * Sign a transaction with the given signer.
     */
    sign(args: {
        signer: Account;
        transaction: SimpleTransaction;
    }): AccountAuthenticatorSingleKey {
        // Goes through the account so that the choice of what the signature
        // covers is made in exactly one place; see `Account.signTransaction`.
        return new AccountAuthenticatorSingleKey(
            args.signer.publicKey,
            args.signer.signTransaction(args.transaction),
        );
    }
}

class BuildHelper {
    private readonly intention: Intention;

    constructor(intention: Intention) {
        this.intention = intention;
    }

    /**
     * Build a simple transaction.
     * Compatible with: intention.transaction.build.simple({sender, data: {function, functionArguments}, options})
     */
    async simple(args: {
        sender: string | AccountAddress | Account;
        data: {
            function: string;
            functionArguments: unknown[];
            type_arguments?: string[];
        };
        payload?: unknown;
        options?: { maxGasAmount?: number; gasUnitPrice?: number };
    }): Promise<SimpleTransaction> {
        const { buildTransaction, generateTransactionPayload } = await import("../transactions/transactionBuilder");
        const senderAddr = args.sender instanceof Account
            ? args.sender.accountAddress.toString()
            : (typeof args.sender === "string" ? args.sender : args.sender.toString());

        const payload = await generateTransactionPayload({
            intentionConfig: this.intention.config,
            function: args.data.function,
            type_arguments: args.data.type_arguments,
            functionArguments: args.data.functionArguments,
        });

        return buildTransaction({
            intentionConfig: this.intention.config,
            sender: senderAddr,
            payload,
            options: args.options,
        });
    }
}

class SubmitHelper {
    private readonly intention: Intention;

    constructor(intention: Intention) {
        this.intention = intention;
    }

    /**
     * Submit a simple transaction.
     */
    async simple(args: {
        transaction: SimpleTransaction;
        senderAuthenticator: AccountAuthenticatorSingleKey;
        encoding?: TransactionSubmissionEncoding;
        options?: { encoding?: TransactionSubmissionEncoding };
    }): Promise<PendingTransactionResponse> {
        const encoding = args.encoding ?? args.options?.encoding;
        return rawSubmitTransaction(
            this.intention.config.toClientConfig(),
            {
                transaction: args.transaction,
                senderAuthenticator: args.senderAuthenticator,
                ...(encoding !== undefined ? { encoding } : {}),
            },
        );
    }
}

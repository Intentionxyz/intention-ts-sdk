// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP Client for submitting transactions and querying the node.
 *
 * Minimal implementation - just fetch-based HTTP calls.
 */

import type { AccountAuthenticatorSingleKey } from "../transactions/authenticator";
import { generateSignedTransaction } from "../transactions/authenticator";
import {
    generateSubmitTransactionRequest,
    UnsupportedJsonPayloadError,
} from "../transactions/jsonSubmit";
import type { RawTransaction, SimpleTransaction } from "../transactions/rawTransaction";

const MIME_BCS_SIGNED_TRANSACTION = "application/x.intention.signed_transaction+bcs";
const MIME_JSON = "application/json";

export interface IntentionClientConfig {
    nodeUrl: string;
    defaultSubmissionEncoding?: TransactionSubmissionEncoding;
    jsonUnsupportedPayloadFallback?: JsonUnsupportedPayloadFallback;
}

export interface PendingTransactionResponse {
    hash: string;
    sender: string;
    sequence_number: string;
    max_gas_amount: string;
    gas_unit_price: string;
    expiration_timestamp_secs: string;
    payload: unknown;
    signature: unknown;
}

export interface LedgerInfo {
    chain_id: number;
    epoch: string;
    ledger_version: string;
    oldest_ledger_version: string;
    ledger_timestamp: string;
    node_role: string;
    oldest_block_height: string;
    block_height: string;
    git_hash: string;
}

export interface TransactionResponse {
    type: string;
    version: string;
    hash: string;
    state_change_hash: string;
    event_root_hash: string;
    state_checkpoint_hash: string;
    gas_used: string;
    success: boolean;
    vm_status: string;
    accumulator_root_hash: string;
    changes: unknown[];
    sender: string;
    sequence_number: string;
    replay_protection_nonce?: string;
    max_gas_amount: string;
    gas_unit_price: string;
    expiration_timestamp_secs: string;
    payload: unknown;
    signature: unknown;
    events: unknown[];
    timestamp: string;
}

export type TransactionSubmissionEncoding = "bcs" | "json";
export type JsonUnsupportedPayloadFallback = "error" | "bcs";

export interface SubmitTransactionArgs {
    transaction: SimpleTransaction | RawTransaction;
    senderAuthenticator: AccountAuthenticatorSingleKey;
    encoding?: TransactionSubmissionEncoding;
}

/** Transaction was submitted but did not commit before the caller's deadline. */
export class TransactionTimeoutError extends Error {
    constructor(
        public readonly transactionHash: string,
        public readonly timeoutMs: number,
    ) {
        super(`Transaction ${transactionHash} not confirmed within ${timeoutMs}ms`);
        this.name = "TransactionTimeoutError";
    }
}

/** Transaction committed on-chain but failed at the VM/execution layer. */
export class TransactionExecutionError extends Error {
    constructor(
        public readonly transactionHash: string,
        public readonly vmStatus: string,
        public readonly transaction: TransactionResponse,
    ) {
        super(`Transaction ${transactionHash} failed: ${vmStatus}`);
        this.name = "TransactionExecutionError";
    }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Submit a BCS-serialized signed transaction to the node.
 */
export async function submitTransaction(
    config: IntentionClientConfig,
    signedTransaction: Uint8Array | SubmitTransactionArgs,
): Promise<PendingTransactionResponse> {
    const url = `${config.nodeUrl}/transactions`;
    const { contentType, body } = renderSubmitTransactionBody(config, signedTransaction);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": contentType,
        },
        body,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `Failed to submit transaction: ${response.status} ${response.statusText}\n${errorBody}`,
        );
    }

    return response.json();
}

function renderSubmitTransactionBody(
    config: IntentionClientConfig,
    signedTransaction: Uint8Array | SubmitTransactionArgs,
): { contentType: string; body: BodyInit } {
    if (signedTransaction instanceof Uint8Array) {
        return {
            contentType: MIME_BCS_SIGNED_TRANSACTION,
            body: signedTransaction as unknown as BodyInit,
        };
    }

    const explicitEncoding = signedTransaction.encoding;
    const encoding = explicitEncoding ?? config.defaultSubmissionEncoding ?? "json";
    if (encoding === "json") {
        try {
            return {
                contentType: MIME_JSON,
                body: JSON.stringify(generateSubmitTransactionRequest(signedTransaction)),
            };
        } catch (error) {
            if (
                error instanceof UnsupportedJsonPayloadError &&
                explicitEncoding === undefined &&
                config.jsonUnsupportedPayloadFallback === "bcs"
            ) {
                return renderBcsSubmitTransactionBody(signedTransaction);
            }
            throw error;
        }
    }

    return renderBcsSubmitTransactionBody(signedTransaction);
}

function renderBcsSubmitTransactionBody(
    signedTransaction: SubmitTransactionArgs,
): { contentType: string; body: BodyInit } {
    return {
        contentType: MIME_BCS_SIGNED_TRANSACTION,
        body: generateSignedTransaction(signedTransaction) as unknown as BodyInit,
    };
}

/**
 * Get ledger info from the node.
 */
export async function getLedgerInfo(
    config: IntentionClientConfig,
): Promise<LedgerInfo> {
    const url = config.nodeUrl;

    const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
    });

    if (!response.ok) {
        throw new Error(
            `Failed to get ledger info: ${response.status} ${response.statusText}`,
        );
    }

    return response.json();
}

/**
 * Wait for a transaction to be confirmed.
 */
export async function waitForTransaction(
    config: IntentionClientConfig,
    txnHash: string,
    options?: {
        timeoutMs?: number;
        checkIntervalMs?: number;
    },
): Promise<TransactionResponse> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const checkIntervalMs = options?.checkIntervalMs ?? 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const url = `${config.nodeUrl}/transactions/by_hash/${txnHash}`;
            const response = await fetch(url, {
                headers: { Accept: "application/json" },
            });

            if (response.ok) {
                const txn: TransactionResponse = await response.json();
                if (txn.type !== "pending_transaction") {
                    return txn;
                }
            }
        } catch {
            // Retry on network errors
        }

        await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
    }

    throw new TransactionTimeoutError(txnHash, timeoutMs);
}

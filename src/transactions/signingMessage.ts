// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Signing message generation for transactions.
 *
 * SHA3-256 prefix ++ BCS(rawTx)
 */

import { sha3_256 } from "@noble/hashes/sha3";
import { RawTransaction, SimpleTransaction } from "./rawTransaction";
import { AccountAuthenticatorSingleKey, generateSignedTransaction } from "./authenticator";


/**
 * Generate the raw signing bytes prefix: SHA3-256
 */
const RAW_TRANSACTION_SALT = "INTENTION::RawTransaction";

let cachedPrefix: Uint8Array | null = null;

function getHashPrefix(): Uint8Array {
    if (!cachedPrefix) {
        cachedPrefix = sha3_256(new TextEncoder().encode(RAW_TRANSACTION_SALT));
    }
    return cachedPrefix;
}

/**
 * Generate signing message for a transaction.
 */
export function generateSigningMessageForTransaction(
    transaction: SimpleTransaction | RawTransaction,
): Uint8Array {
    const rawTx =
        transaction instanceof SimpleTransaction
            ? transaction.rawTransaction
            : transaction;

    const prefix = getHashPrefix();
    const body = rawTx.bcsToBytes();

    // Concatenate prefix + body
    const message = new Uint8Array(prefix.length + body.length);
    message.set(prefix);
    message.set(body, prefix.length);

    return message;
}

/**
 * Hash multiple values (strings or byte arrays) with SHA3-256.
 */
function hashValues(input: (Uint8Array | string)[]): Uint8Array {
    const hash = sha3_256.create();
    for (const item of input) {
        if (typeof item === "string") {
            hash.update(new TextEncoder().encode(item));
        } else {
            hash.update(item);
        }
    }
    return hash.digest();
}

const TRANSACTION_PREFIX = hashValues(["INTENTION::Transaction"]);

/**
 * Generate the on-chain user transaction hash.
 * = SHA3-256("0x00 || BCS(SignedTransaction))
 *
 * This allows predicting the transaction hash before submission.
 */
export function generateUserTransactionHash(args: {
    transaction: SimpleTransaction | RawTransaction;
    senderAuthenticator: AccountAuthenticatorSingleKey;
}): string {
    const signedTransactionBytes = generateSignedTransaction(args);
    const hash = hashValues([TRANSACTION_PREFIX, new Uint8Array([0]), signedTransactionBytes]);
    return "0x" + Array.from(hash).map((b) => b.toString(16).padStart(2, "0")).join("");
}


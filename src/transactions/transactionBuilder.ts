// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Transaction builder utilities for generic Move entry function calls.
 *
 * These are used for non-DEX transactions like USDC transfers via
 * `0x1::primary_fungible_store::transfer`.
 *
 * NOTE: This is a simplified implementation. For full Move ABI resolution,
 * use the original @intention-ts-sdk.
 */

import { Serializable, Serializer } from "../bcs/serializer";
import { AccountAddress } from "../core/accountAddress";
import {
    RawTransaction,
    SimpleTransaction,
} from "./rawTransaction";
import { TransactionPayload } from "./dexPayloads";
import { ChainId } from "./chainId";
import {
    TransactionPayloadVariants,
} from "../types/enums";
import type { IntentionConfig } from "../api/intention";
import { getLedgerInfo } from "../api/client";

// =============================================================================
// EntryFunction payload
// =============================================================================

/**
 * Represents an entry function payload for Move calls.
 */
export class EntryFunction extends Serializable {
    readonly module_address: AccountAddress;
    readonly module_name: string;
    readonly function_name: string;
    readonly type_args: string[];
    readonly args: Uint8Array[];

    constructor(
        module_address: AccountAddress,
        module_name: string,
        function_name: string,
        type_args: string[],
        args: Uint8Array[],
    ) {
        super();
        this.module_address = module_address;
        this.module_name = module_name;
        this.function_name = function_name;
        this.type_args = type_args;
        this.args = args;
    }

    serialize(serializer: Serializer): void {
        // Module ID: address + module_name
        this.module_address.serialize(serializer);
        serializer.serializeStr(this.module_name);
        // Function name
        serializer.serializeStr(this.function_name);
        // Type arguments (simplified: serialize count as 0 for now)
        serializer.serializeU32AsUleb128(this.type_args.length);
        for (const _typeArg of this.type_args) {
            // Type tag serialization - simplified for common types
            // For full implementation, would need full Move type tag parser
            // This is a placeholder that writes a struct type tag
            serializer.serializeU8(7); // STRUCT tag
            // Would need full struct tag serialization here
        }
        // Arguments
        serializer.serializeU32AsUleb128(this.args.length);
        for (const arg of this.args) {
            serializer.serializeBytes(arg);
        }
    }
}

/**
 * Transaction payload wrapping an entry function.
 */
export class TransactionPayloadEntryFunction extends TransactionPayload {
    readonly entryFunction: EntryFunction;

    constructor(entryFunction: EntryFunction) {
        super();
        this.entryFunction = entryFunction;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU32AsUleb128(TransactionPayloadVariants.EntryFunction);
        this.entryFunction.serialize(serializer);
    }
}

// =============================================================================
// generateTransactionPayload
// =============================================================================

/**
 * Generate an entry function transaction payload.
 *
 * NOTE: This is a simplified version. For complex Move calls with
 * type arguments and ABI resolution, use the original @intention-ts-sdk.
 *
 * @example
 * ```ts
 * const payload = await generateTransactionPayload({
 *   intentionConfig,
 *   function: "0x1::primary_fungible_store::transfer",
 *   type_arguments: ["0x1::fungible_asset::Metadata"],
 *   functionArguments: [metadataAddress, recipientAddress, amount],
 * });
 * ```
 */
export async function generateTransactionPayload(args: {
    intentionConfig: IntentionConfig;
    function: string;
    type_arguments?: string[];
    functionArguments?: unknown[];
}): Promise<TransactionPayloadEntryFunction> {
    // Parse function string: "0xADDR::module::function"
    const parts = args.function.split("::");
    if (parts.length !== 3) {
        throw new Error(`Invalid function format: ${args.function}. Expected "address::module::function"`);
    }

    const moduleAddress = AccountAddress.from(parts[0]);
    const moduleName = parts[1];
    const functionName = parts[2];

    // Serialize function arguments to BCS bytes
    const serializedArgs: Uint8Array[] = [];
    if (args.functionArguments) {
        for (const arg of args.functionArguments) {
            const s = new Serializer();
            if (typeof arg === "string") {
                // Could be an address or a string
                if (arg.startsWith("0x")) {
                    AccountAddress.from(arg).serialize(s);
                } else {
                    s.serializeStr(arg);
                }
            } else if (typeof arg === "number") {
                s.serializeU64(BigInt(arg));
            } else if (typeof arg === "bigint") {
                s.serializeU64(arg);
            } else if (arg instanceof AccountAddress) {
                arg.serialize(s);
            } else if (arg instanceof Uint8Array) {
                s.serializeBytes(arg);
            } else {
                throw new Error(`Unsupported argument type: ${typeof arg}`);
            }
            serializedArgs.push(s.toUint8Array());
        }
    }

    const entryFunction = new EntryFunction(
        moduleAddress,
        moduleName,
        functionName,
        args.type_arguments ?? [],
        serializedArgs,
    );

    return new TransactionPayloadEntryFunction(entryFunction);
}

// =============================================================================
// buildTransaction
// =============================================================================

/**
 * Build a SimpleTransaction from a payload.
 *
 * @example
 * ```ts
 * const txn = await buildTransaction({
 *   intentionConfig,
 *   sender: senderAddress,
 *   payload,
 *   options: { maxGasAmount: 5000, gasUnitPrice: 2000 },
 * });
 * ```
 */
export async function buildTransaction(args: {
    intentionConfig: IntentionConfig;
    sender: string | AccountAddress;
    payload: TransactionPayloadEntryFunction;
    options?: {
        maxGasAmount?: number;
        gasUnitPrice?: number;
        expireTimestamp?: number;
    };
}): Promise<SimpleTransaction> {
    const senderAddress =
        typeof args.sender === "string"
            ? AccountAddress.from(args.sender)
            : args.sender;

    // Get chain info
    const ledgerInfo = await getLedgerInfo(args.intentionConfig.toClientConfig());

    // Get account sequence number
    const accountUrl = `${args.intentionConfig.fullnode}/accounts/${senderAddress.toString()}`;
    const accountResponse = await fetch(accountUrl, {
        headers: { Accept: "application/json" },
    });
    if (!accountResponse.ok) {
        throw new Error(`Failed to get account info: ${accountResponse.status}`);
    }
    const accountData: { sequence_number: string } = await accountResponse.json();
    const sequenceNumber = BigInt(accountData.sequence_number);

    const maxGasAmount = BigInt(args.options?.maxGasAmount ?? 5000);
    const gasUnitPrice = BigInt(args.options?.gasUnitPrice ?? 100);
    const expireTimestamp = BigInt(
        args.options?.expireTimestamp ?? Math.floor(Date.now() / 1000) + 30,
    );

    const rawTx = new RawTransaction(
        senderAddress,
        sequenceNumber,
        args.payload,
        maxGasAmount,
        gasUnitPrice,
        expireTimestamp,
        new ChainId(ledgerInfo.chain_id),
    );

    return new SimpleTransaction(rawTx);
}

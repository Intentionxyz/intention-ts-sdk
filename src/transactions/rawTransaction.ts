// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * RawTransaction and SimpleTransaction
 *
 * Minimal implementation for constructing DEX transactions.
 */

import { Serializable, Serializer, MAX_U64_BIG_INT } from "../bcs/serializer";
import { AccountAddress } from "../core/accountAddress";
import { ChainId } from "./chainId";
import {
    isCrossTransferOrderlessPayload,
    TransactionPayload,
    TransactionPayloadDexOrderless,
} from "./dexPayloads";

// ============================================================================
// RawTransaction
// ============================================================================

/**
 * Raw transaction that can be signed and submitted.
 */
export class RawTransaction extends Serializable {
    public readonly sender: AccountAddress;
    public readonly sequence_number: bigint;
    public readonly payload: TransactionPayload;
    public readonly max_gas_amount: bigint;
    public readonly gas_unit_price: bigint;
    public readonly expiration_timestamp_secs: bigint;
    public readonly chain_id: ChainId;

    constructor(
        sender: AccountAddress,
        sequence_number: bigint,
        payload: TransactionPayload,
        max_gas_amount: bigint,
        gas_unit_price: bigint,
        expiration_timestamp_secs: bigint,
        chain_id: ChainId,
    ) {
        super();
        this.sender = sender;
        this.sequence_number = sequence_number;
        this.payload = payload;
        this.max_gas_amount = max_gas_amount;
        this.gas_unit_price = gas_unit_price;
        this.expiration_timestamp_secs = expiration_timestamp_secs;
        this.chain_id = chain_id;
    }

    serialize(serializer: Serializer): void {
        this.sender.serialize(serializer);
        serializer.serializeU64(this.sequence_number);
        this.payload.serialize(serializer);
        serializer.serializeU64(this.max_gas_amount);
        serializer.serializeU64(this.gas_unit_price);
        serializer.serializeU64(this.expiration_timestamp_secs);
        this.chain_id.serialize(serializer);
    }

    /**
     * Create an orderless RawTransaction (sequence_number = MAX_U64).
     */
    static createOrderless(
        sender: AccountAddress,
        payload: TransactionPayloadDexOrderless,
        maxGasAmount: bigint,
        gasUnitPrice: bigint,
        expirationTimestampSecs: bigint,
        chainId: ChainId,
    ): RawTransaction {
        if (isCrossTransferOrderlessPayload(payload)) {
            throw new Error(
                "CrossTransfer requires an explicit replay nonce; use createCrossTransferOrderless",
            );
        }

        return new RawTransaction(
            sender,
            MAX_U64_BIG_INT, // orderless uses max u64
            payload,
            maxGasAmount,
            gasUnitPrice,
            expirationTimestampSecs,
            chainId,
        );
    }

    /**
     * Create a CrossTransfer orderless RawTransaction with an explicit
     * transaction-level replay nonce.
     */
    static createCrossTransferOrderless(
        sender: AccountAddress,
        payload: TransactionPayloadDexOrderless,
        replayProtectionNonce: bigint,
        maxGasAmount: bigint,
        gasUnitPrice: bigint,
        expirationTimestampSecs: bigint,
        chainId: ChainId,
    ): RawTransaction {
        if (!isCrossTransferOrderlessPayload(payload)) {
            throw new Error(
                "createCrossTransferOrderless requires a CrossTransfer orderless payload",
            );
        }
        if (typeof replayProtectionNonce !== "bigint") {
            throw new Error("CrossTransfer replay nonce is required and must be a bigint");
        }
        if (
            replayProtectionNonce < 0n ||
            replayProtectionNonce > MAX_U64_BIG_INT
        ) {
            throw new Error("CrossTransfer replay nonce must be in the u64 range");
        }
        if (replayProtectionNonce === MAX_U64_BIG_INT) {
            throw new Error(
                "CrossTransfer replay nonce must not use the reserved MAX_U64 value",
            );
        }

        return new RawTransaction(
            sender,
            replayProtectionNonce,
            payload,
            maxGasAmount,
            gasUnitPrice,
            expirationTimestampSecs,
            chainId,
        );
    }
}

// ============================================================================
// SimpleTransaction
// ============================================================================

/**
 * Wrapper around RawTransaction for single-signer transactions.
 */
export class SimpleTransaction {
    public readonly rawTransaction: RawTransaction;
    public feePayerAddress?: AccountAddress;

    constructor(rawTransaction: RawTransaction, feePayerAddress?: AccountAddress) {
        this.rawTransaction = rawTransaction;
        this.feePayerAddress = feePayerAddress;
    }
}

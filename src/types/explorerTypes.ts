// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Explorer-specific types
 */

// ============================================================================
// Transaction Response Types
// ============================================================================

/** Different types of transaction responses. */
export enum TransactionResponseType {
    Pending = "pending_transaction",
    User = "user_transaction",
    Genesis = "genesis_transaction",
    BlockMetadata = "block_metadata_transaction",
    StateCheckpoint = "state_checkpoint_transaction",
    Validator = "validator_transaction",
    BlockEpilogue = "block_epilogue_transaction",
}

/** Write-set change types used in transaction responses. */
export type WriteSetChange = {
    type: string;
    [key: string]: any;
};

/** Event structure in transaction responses. */
export type Event = {
    guid: { creation_number: string; account_address: string };
    sequence_number: string;
    type: string;
    data: any;
};

/** Transaction payload response (generic). */
export type TransactionPayloadResponse = {
    type: string;
    [key: string]: any;
};

/** Transaction signature (generic). */
export type TransactionSignature = {
    type: string;
    [key: string]: any;
};

// --- Individual transaction response types ---

export type PendingTransactionResponse = {
    type: TransactionResponseType.Pending;
    hash: string;
    sender: string;
    sequence_number: string;
    max_gas_amount: string;
    gas_unit_price: string;
    expiration_timestamp_secs: string;
    payload: TransactionPayloadResponse;
    signature?: TransactionSignature;
};

export type UserTransactionResponse = {
    type: TransactionResponseType.User;
    version: string;
    hash: string;
    state_change_hash: string;
    event_root_hash: string;
    state_checkpoint_hash: string | null;
    gas_used: string;
    success: boolean;
    vm_status: string;
    accumulator_root_hash: string;
    changes: Array<WriteSetChange>;
    sender: string;
    sequence_number: string;
    replay_protection_nonce?: string;
    max_gas_amount: string;
    gas_unit_price: string;
    expiration_timestamp_secs: string;
    payload: TransactionPayloadResponse;
    signature?: TransactionSignature;
    events: Array<Event>;
    timestamp: string;
};

export type GenesisTransactionResponse = {
    type: TransactionResponseType.Genesis;
    version: string;
    hash: string;
    state_change_hash: string;
    event_root_hash: string;
    state_checkpoint_hash?: string;
    gas_used: string;
    success: boolean;
    vm_status: string;
    accumulator_root_hash: string;
    changes: Array<WriteSetChange>;
    payload: { type: string;[key: string]: any };
    events: Array<Event>;
};

export type BlockMetadataTransactionResponse = {
    type: TransactionResponseType.BlockMetadata;
    version: string;
    hash: string;
    state_change_hash: string;
    event_root_hash: string;
    state_checkpoint_hash: string | null;
    gas_used: string;
    success: boolean;
    vm_status: string;
    accumulator_root_hash: string;
    changes: Array<WriteSetChange>;
    id: string;
    epoch: string;
    round: string;
    events: Array<Event>;
    previous_block_votes_bitvec: Array<number>;
    proposer: string;
    failed_proposer_indices: Array<number>;
    timestamp: string;
};

export type StateCheckpointTransactionResponse = {
    type: TransactionResponseType.StateCheckpoint;
    version: string;
    hash: string;
    state_change_hash: string;
    event_root_hash: string;
    state_checkpoint_hash: string | null;
    gas_used: string;
    success: boolean;
    vm_status: string;
    accumulator_root_hash: string;
    changes: Array<WriteSetChange>;
    timestamp: string;
};

export type ValidatorTransactionResponse = {
    type: TransactionResponseType.Validator;
    version: string;
    hash: string;
    state_change_hash: string;
    event_root_hash: string;
    state_checkpoint_hash: string | null;
    gas_used: string;
    success: boolean;
    vm_status: string;
    accumulator_root_hash: string;
    changes: Array<WriteSetChange>;
    events: Array<Event>;
    timestamp: string;
};

export type BlockEpilogueTransactionResponse = {
    type: TransactionResponseType.BlockEpilogue;
    version: string;
    hash: string;
    state_change_hash: string;
    event_root_hash: string;
    state_checkpoint_hash: string | null;
    gas_used: string;
    success: boolean;
    vm_status: string;
    accumulator_root_hash: string;
    changes: Array<WriteSetChange>;
    timestamp: string;
};

// --- Union types ---

export type CommittedTransactionResponse =
    | UserTransactionResponse
    | GenesisTransactionResponse
    | BlockMetadataTransactionResponse
    | StateCheckpointTransactionResponse
    | ValidatorTransactionResponse
    | BlockEpilogueTransactionResponse;

export type TransactionResponse =
    | PendingTransactionResponse
    | CommittedTransactionResponse;

// --- Type guard functions ---

export function isBlockMetadataTransactionResponse(
    response: TransactionResponse,
): response is BlockMetadataTransactionResponse {
    return response.type === TransactionResponseType.BlockMetadata;
}

export function isUserTransactionResponse(
    response: TransactionResponse,
): response is UserTransactionResponse {
    return response.type === TransactionResponseType.User;
}

export function isPendingTransactionResponse(
    response: TransactionResponse,
): response is PendingTransactionResponse {
    return response.type === TransactionResponseType.Pending;
}

// ============================================================================
// Block Type
// ============================================================================

export type Block = {
    block_height: string;
    block_hash: string;
    block_timestamp: string;
    first_version: string;
    last_version: string;
    transactions?: Array<TransactionResponse>;
};

// ============================================================================
// DeriveScheme
// ============================================================================

/** Schemes for deriving account addresses from data sources. */
export enum DeriveScheme {
    DeriveAuid = 251,
    DeriveObjectAddressFromObject = 252,
    DeriveObjectAddressFromGuid = 253,
    DeriveObjectAddressFromSeed = 254,
    DeriveResourceAccountAddress = 255,
}


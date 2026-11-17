// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Address utility functions.
 */

import { sha3_256 } from "@noble/hashes/sha3";
import { AccountAddress } from "./accountAddress";

/** Length of derived subaccount address in bytes (EVM-compatible 20 bytes). */
const SUBACCOUNT_ADDRESS_LENGTH = 20;

/**
 * Derive subaccount address from main account address and subaccount number.
 * Uses SHA3-256 hash truncated to 20 bytes, left-padded to 32-byte AccountAddress.
 *
 * Algorithm:
 *   data = "dex_account" || last_20_bytes(address) || little_endian_u32(number)
 *   hash = SHA3-256(data)
 *   sub_address = pad_left_to_32(hash[0..20])
 *
 * @param mainAddress - The main account address (32 bytes)
 * @param number - The subaccount number (u32)
 * @returns The derived subaccount address
 */
export const deriveSubaccountAddress = (mainAddress: AccountAddress, number: number): AccountAddress => {
    const prefix = new TextEncoder().encode("dex_account");
    const addrBytes = mainAddress.toUint8Array();
    // Take the last 20 bytes of the address (EVM-compatible)
    const last20 = addrBytes.slice(addrBytes.length - SUBACCOUNT_ADDRESS_LENGTH);
    // Encode number as little-endian u32
    const numBytes = new Uint8Array(4);
    new DataView(numBytes.buffer).setUint32(0, number, true);
    // Concatenate: prefix + last20 + numBytes
    const data = new Uint8Array(prefix.length + last20.length + numBytes.length);
    data.set(prefix, 0);
    data.set(last20, prefix.length);
    data.set(numBytes, prefix.length + last20.length);
    // Hash and take first 20 bytes, pad to 32
    const hash = sha3_256(data);
    const result = new Uint8Array(32);
    result.set(hash.slice(0, SUBACCOUNT_ADDRESS_LENGTH), 32 - SUBACCOUNT_ADDRESS_LENGTH);
    return new AccountAddress(result);
};

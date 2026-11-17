// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * Common utilities for parsing and error handling.
 */

/**
 * Error thrown when parsing fails (e.g. in fromString).
 */
export class ParsingError<T> extends Error {
    public invalidReason: T;

    constructor(message: string, invalidReason: T) {
        super(message);
        this.invalidReason = invalidReason;
    }
}

/**
 * Result type returned from defensive functions like isValid.
 */
export type ParsingResult<T> = {
    valid: boolean;
    invalidReason?: T;
    invalidReasonMessage?: string;
};

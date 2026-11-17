// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/**
 * ChainId - wraps a single u8 chain identifier.
 */

import { Serializable, Serializer } from "../bcs/serializer";

export class ChainId extends Serializable {
    public readonly chainId: number;

    constructor(chainId: number) {
        super();
        this.chainId = chainId;
    }

    serialize(serializer: Serializer): void {
        serializer.serializeU8(this.chainId);
    }
}

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";

import { decodeDexEvent, type DexFundingRateEvent } from "../src/index";

test("FundingRateEvent decodes funding_rate_ppm as signed i32", () => {
    // symbolId(u32) fundingRatePpm(i32) markPrice(u64) blockHeight(u64) timestamp(u64)
    const buf = new ArrayBuffer(4 + 4 + 8 + 8 + 8);
    const dv = new DataView(buf);
    let o = 0;
    dv.setUint32(o, 5, true);
    o += 4;
    dv.setInt32(o, -100, true); // negative rate exercises the signed path
    o += 4;
    dv.setBigUint64(o, 1000n, true);
    o += 8;
    dv.setBigUint64(o, 2n, true);
    o += 8;
    dv.setBigUint64(o, 3n, true);
    const hex = Buffer.from(buf).toString("hex");

    const decoded = decodeDexEvent("0x1::dex::FundingRateEvent", hex);
    assert.notEqual(decoded, null);
    assert.equal(decoded?.eventType, "FundingRateEvent");
    const event = decoded?.event as DexFundingRateEvent;
    assert.equal(event.symbolId, 5);
    // Under the old deserializeU32() bug this would decode as 4294967196.
    assert.equal(event.fundingRatePpm, -100);
    assert.equal(event.markPrice, 1000n);
    assert.equal(event.blockHeight, 2n);
    assert.equal(event.timestamp, 3n);
});

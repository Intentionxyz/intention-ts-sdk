import { test } from "node:test";
import assert from "node:assert/strict";

import {
    DelistingLegMarginMode,
    DelistingLegSide,
    DelistingPriceSource,
    SymbolStatus,
    decodeDexEvent,
    decodeTransactionEvents,
    isDexEvent,
} from "../src/index";

/**
 * The delisting events. The bytes are the golden every SDK shares, which the chain's own
 * tests assert as well; the JSON is what the node's Move mirrors render for the same values.
 */

const tag = (name: string) => `0x0000000000000000000000000000000000000001::dex::${name}`;

const GOLDEN: Record<string, string> = {
    DelistingPlanSetEvent:
        "2a000000070000000100000000f1536500000000100e0000100e0000f0e2536500000000f4010000c800"
        + "0000e8030000000000000058a7cf0c0a0600",
    DelistingPricedEvent:
        "2a000000070000000100000090b25b070000000000a493d6000000000030edecffffffffffffffffffff"
        + "ffffffd007000000000000805a2418240a0600",
    DelistingSettledEvent:
        "2a0000000700000000000000000000000000000000000000000000000000000000000000000000010000"
        + "0000000000000000000000000000000000000000000000000000000000020000000090b25b0700000000"
        + "01000140420f0000000000a0f99449000000000000000000000000800f05fdffffffffffffffffffffff"
        + "ff0000000000000000000000000000000000000000000000000000000000000000d10700000000000000"
        + "752a18240a0600",
    SymbolClosedEvent:
        "2a000000070000000100000090b25b0700000000020000000000000080841e0000000000000000000000"
        + "000040f32993000000000000000000000000030000000000000030edecffffffffffffffffffffffffff"
        + "00000000000000000000000000000000d207000000000000808f3018240a0600",
};

/** The unsigned decimal reading of a value's 128-bit two's complement, as Move renders it. */
const bits = (value: bigint) => BigInt.asUintN(128, value).toString();

const OWNER = "0x0000000000000000000000000000000000000001";
const SUB_ADDRESS = "0x0000000000000000000000000000000000000002";

const EXPECTED: Record<string, unknown> = {
    DelistingPlanSetEvent: {
        perpetualId: 42,
        symbolId: 7,
        planVersion: 1,
        t0Secs: 1_700_000_000n,
        reduceOnlyLeadSecs: 3_600,
        twapWindowSecs: 3_600,
        reduceOnlyAtSecs: 1_699_996_400n,
        maxCancelPerBlock: 500,
        maxSettlePerBlock: 200,
        blockHeight: 1_000n,
        timestampUs: 1_699_900_000_000_000n,
    },
    DelistingPricedEvent: {
        perpetualId: 42,
        symbolId: 7,
        planVersion: 1,
        finalPriceSubticks: 123_450_000n,
        sampleWeightUs: 3_600_000_000n,
        priceSource: DelistingPriceSource.WindowTwap,
        expectedTotalPnl: -1_250_000n,
        blockHeight: 2_000n,
        timestampUs: 1_700_000_000_400_000n,
    },
    DelistingSettledEvent: {
        perpetualId: 42,
        symbolId: 7,
        owner: OWNER,
        subAddress: SUB_ADDRESS,
        subaccountNumber: 0,
        finalPriceSubticks: 123_450_000n,
        legs: [{
            side: DelistingLegSide.Long,
            marginMode: DelistingLegMarginMode.Isolated,
            quantums: 1_000_000n,
            quoteQuantums: 1_234_500_000n,
            realizedPnl: -50_000_000n,
            isolatedShortfall: 0n,
        }],
        crossShortfall: 0n,
        blockHeight: 2_001n,
        timestampUs: 1_700_000_000_800_000n,
    },
    SymbolClosedEvent: {
        perpetualId: 42,
        symbolId: 7,
        planVersion: 1,
        finalPriceSubticks: 123_450_000n,
        settledAccounts: 2n,
        settledQuantums: 2_000_000n,
        settledQuoteQuantums: 2_469_000_000n,
        canceledOrders: 3n,
        realizedPnlSum: -1_250_000n,
        shortfallQuote: 0n,
        blockHeight: 2_002n,
        timestampUs: 1_700_000_001_200_000n,
    },
};

const JSON_FORM: Record<string, Record<string, unknown>> = {
    DelistingPlanSetEvent: {
        perpetual_id: 42,
        symbol_id: 7,
        plan_version: 1,
        t0_secs: "1700000000",
        reduce_only_lead_secs: 3600,
        twap_window_secs: 3600,
        reduce_only_at_secs: "1699996400",
        max_cancel_per_block: 500,
        max_settle_per_block: 200,
        block_height: "1000",
        timestamp_us: "1699900000000000",
    },
    DelistingPricedEvent: {
        perpetual_id: 42,
        symbol_id: 7,
        plan_version: 1,
        final_price_subticks: "123450000",
        sample_weight_us: "3600000000",
        price_source: 0,
        expected_total_pnl_bits: bits(-1_250_000n),
        block_height: "2000",
        timestamp_us: "1700000000400000",
    },
    DelistingSettledEvent: {
        perpetual_id: 42,
        symbol_id: 7,
        owner: OWNER,
        sub_address: SUB_ADDRESS,
        subaccount_number: 0,
        final_price_subticks: "123450000",
        legs: [{
            side: 0,
            margin_mode: 1,
            quantums: "1000000",
            quote_quantums: "1234500000",
            realized_pnl_bits: bits(-50_000_000n),
            isolated_shortfall: "0",
        }],
        cross_shortfall: "0",
        block_height: "2001",
        timestamp_us: "1700000000800000",
    },
    SymbolClosedEvent: {
        perpetual_id: 42,
        symbol_id: 7,
        plan_version: 1,
        final_price_subticks: "123450000",
        settled_accounts: "2",
        settled_quantums: "2000000",
        settled_quote_quantums: "2469000000",
        canceled_orders: "3",
        realized_pnl_sum_bits: bits(-1_250_000n),
        shortfall_quote: "0",
        block_height: "2002",
        timestamp_us: "1700000001200000",
    },
};

const NAMES = Object.keys(GOLDEN);

test("the golden bytes decode into the stated values, signed fields restored", () => {
    assert.equal(GOLDEN.DelistingPlanSetEvent.length / 2, 60);
    assert.equal(GOLDEN.DelistingPricedEvent.length / 2, 61);
    assert.equal(GOLDEN.DelistingSettledEvent.length / 2, 175);
    assert.equal(GOLDEN.SymbolClosedEvent.length / 2, 116);
    for (const name of NAMES) {
        assert.ok(isDexEvent(tag(name)), name);
        assert.deepStrictEqual(
            decodeDexEvent(tag(name), GOLDEN[name]),
            { eventType: name, event: EXPECTED[name] },
            name,
        );
    }
});

test("the JSON a Move mirror renders decodes into the same values", () => {
    for (const name of NAMES) {
        assert.deepStrictEqual(
            decodeDexEvent(tag(name), JSON_FORM[name]),
            { eventType: name, event: EXPECTED[name] },
            name,
        );
    }
});

test("fields a later version appends are ignored, a short payload is refused", () => {
    for (const name of NAMES) {
        assert.deepStrictEqual(
            decodeDexEvent(tag(name), `0x${GOLDEN[name]}0102030405060708`),
            { eventType: name, event: EXPECTED[name] },
            `${name} with a tail`,
        );
        assert.equal(decodeDexEvent(tag(name), GOLDEN[name].slice(0, -2)), null, name);
    }
});

test("a settled account carries every leg, and a price source is kept as read", () => {
    // Two legs, short after long, then the Cross shortfall.
    const leg = (side: string, pnl: string) => `${side}00`
        + "40420f0000000000"
        + "a0f99449000000000000000000000000"
        + pnl
        + "00000000000000000000000000000000";
    const twoLegs = GOLDEN.DelistingSettledEvent.slice(0, 2 * (4 + 4 + 32 + 32 + 4 + 8))
        + "02"
        + leg("00", "80f0fa02000000000000000000000000")
        + leg("01", "800f05fdffffffffffffffffffffffff")
        + "e8030000000000000000000000000000"
        + "d10700000000000000752a18240a0600";
    const decoded = decodeDexEvent(tag("DelistingSettledEvent"), twoLegs);
    const event = decoded?.event as {
        legs: Array<{ side: number; marginMode: number; realizedPnl: bigint }>;
        crossShortfall: bigint;
    };
    assert.deepStrictEqual(
        event.legs.map((l) => [l.side, l.marginMode, l.realizedPnl]),
        [[DelistingLegSide.Long, DelistingLegMarginMode.Cross, 50_000_000n],
            [DelistingLegSide.Short, DelistingLegMarginMode.Cross, -50_000_000n]],
    );
    assert.equal(event.crossShortfall, 1_000n);

    // A price source this SDK does not know yet stays a number.
    const priced = GOLDEN.DelistingPricedEvent;
    const at = 2 * (4 + 4 + 4 + 8 + 8);
    const unknownSource = `${priced.slice(0, at)}07${priced.slice(at + 2)}`;
    const pricedEvent = decodeDexEvent(tag("DelistingPricedEvent"), unknownSource)?.event as {
        priceSource: number;
    };
    assert.equal(pricedEvent.priceSource, 7);
});

test("a transaction's delisting events are picked out with the rest", () => {
    const decoded = decodeTransactionEvents([
        { type: "0x1::coin::CoinDeposit", data: "00" },
        { type: tag("DelistingPricedEvent"), data: GOLDEN.DelistingPricedEvent },
        { type: tag("DelistingSettledEvent"), data: JSON_FORM.DelistingSettledEvent },
        { type: tag("SymbolClosedEvent"), data: GOLDEN.SymbolClosedEvent },
    ]);
    assert.deepStrictEqual(
        decoded.map((item) => [item.index, item.eventType]),
        [[1, "DelistingPricedEvent"], [2, "DelistingSettledEvent"], [3, "SymbolClosedEvent"]],
    );
});

test("SymbolStatus knows the chain's names, the old one kept", () => {
    assert.equal(SymbolStatus.ReduceOnly, 2);
    assert.equal(SymbolStatus.CancelOnly, SymbolStatus.ReduceOnly);
    assert.equal(SymbolStatus[2], "ReduceOnly");
    assert.equal(SymbolStatus.FinalSettlement, 5);
    assert.equal(SymbolStatus.PreOpen, 6);
    assert.equal(SymbolStatus.Closed, 7);
    assert.equal(SymbolStatus[7], "Closed");
});

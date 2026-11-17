// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import { Deserializer } from "../bcs/deserializer";
import { AccountAddress } from "../core/accountAddress";
export type ReferralEventName = "ReferralCodeRegisteredEvent" | "ReferralBoundEvent" | "ReferralConfigUpdatedEvent" | "ReferralReservedCodesUpdatedEvent" | "ReferralRewardsClaimedEvent" | "DexReferralFeeEvent";
export interface ReferralWireParameters { invitee_fee_discount_ppm: number; commission_rate_ppm: number; referral_threshold_volume: bigint; discount_volume_cap: bigint; commission_volume_cap: bigint; min_claim_amount: bigint }
export interface ReferralCodeRegisteredEvent { master: string; code: string }
export interface ReferralReservedCodesUpdatedEvent { revision: bigint; effective_block_height: bigint; codes: string[] }
function reservedCodes(codes: unknown): string[] {
    if (!Array.isArray(codes) || codes.length > 256 || codes.some((code, index) =>
        typeof code !== "string" || !/^[A-Z0-9]{6,20}$/.test(code) || (index > 0 && codes[index - 1] >= code))) {
        throw new Error("Invalid canonical reserved code list");
    }
    return codes as string[];
}
export interface ReferralBoundEvent { referee_master: string; referrer_master: string; code: string; volume_at_bind_usd: bigint }
export interface ReferralConfigUpdatedEvent { config: { version: number; revision: bigint; effective_block_height: bigint; parameters: ReferralWireParameters; previous_parameters: ReferralWireParameters | null } }
export interface ReferralRewardsClaimedEvent { master: string; amount: bigint; total_claimed: bigint }
export interface DexReferralFeeEvent { block_height: bigint; symbol_id: number; fill_order_id: bigint; master: string; sub_address: string; discount: bigint; commission: bigint }
export type ReferralEvent = ReferralCodeRegisteredEvent | ReferralBoundEvent | ReferralConfigUpdatedEvent | ReferralReservedCodesUpdatedEvent | ReferralRewardsClaimedEvent | DexReferralFeeEvent;
function address(d: Deserializer) { return new AccountAddress(d.deserializeFixedBytes(32)).toString().toLowerCase(); }
function params(d: Deserializer): ReferralWireParameters { return { invitee_fee_discount_ppm: d.deserializeU32(), commission_rate_ppm: d.deserializeU32(), referral_threshold_volume: d.deserializeU64(), discount_volume_cap: d.deserializeU64(), commission_volume_cap: d.deserializeU64(), min_claim_amount: d.deserializeU64() }; }
function count(d: Deserializer, max: number) { const n = d.deserializeU32FromUleb128(); if (n > max) throw new Error("Referral event vector too large"); return n; }
export function decodeReferralEventBytes(name: ReferralEventName, bytes: Uint8Array): ReferralEvent {
    const d = new Deserializer(bytes); let value: ReferralEvent;
    switch (name) {
    case "ReferralReservedCodesUpdatedEvent": value = { revision: d.deserializeU64(), effective_block_height: d.deserializeU64(), codes: reservedCodes(Array.from({length: count(d, 256)}, () => d.deserializeStr())) }; break;
    case "ReferralCodeRegisteredEvent": value = { master: address(d), code: d.deserializeStr() }; break;
    case "ReferralBoundEvent": value = { referee_master: address(d), referrer_master: address(d), code: d.deserializeStr(), volume_at_bind_usd: d.deserializeU64() }; break;
    case "ReferralConfigUpdatedEvent": {
        const config = { version: d.deserializeU8(), revision: d.deserializeU64(), effective_block_height: d.deserializeU64(), parameters: params(d), previous_parameters: null as ReferralWireParameters | null };
        if (count(d, 1)) config.previous_parameters = params(d);
        if (config.version !== 1) throw new Error("Unsupported referral config version"); value = { config }; break;
    }
    case "ReferralRewardsClaimedEvent": {
        value = { master: address(d), amount: d.deserializeU64(), total_claimed: d.deserializeU64() }; break;
    }
    case "DexReferralFeeEvent": value = { block_height: d.deserializeU64(), symbol_id: d.deserializeU32(), fill_order_id: d.deserializeU64(), master: address(d), sub_address: address(d), discount: d.deserializeU64(), commission: d.deserializeU64() }; break;
    }
    if (d.remaining !== 0) throw new Error("Unexpected trailing referral event bytes"); return value;
}
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid referral JSON object");
    return value as Record<string, unknown>;
}
function integer(value: unknown, bits = 64): bigint {
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Unsafe referral JSON integer");
    const text = String(value); if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error("Invalid referral JSON integer");
    const result = BigInt(text); if (result >= (1n << BigInt(bits))) throw new Error("Referral JSON integer overflow"); return result;
}
function jsonAddress(value: unknown): string {
    if (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(value)) throw new Error("Invalid referral JSON address");
    return AccountAddress.fromString(value, { maxMissingChars: 64 }).toString().toLowerCase();
}
function jsonParams(value: unknown): ReferralWireParameters {
    const p = object(value); return { invitee_fee_discount_ppm: Number(integer(p.invitee_fee_discount_ppm, 32)), commission_rate_ppm: Number(integer(p.commission_rate_ppm, 32)), referral_threshold_volume: integer(p.referral_threshold_volume), discount_volume_cap: integer(p.discount_volume_cap), commission_volume_cap: integer(p.commission_volume_cap), min_claim_amount: integer(p.min_claim_amount) };
}
function decodeJson(name: ReferralEventName, value: unknown): ReferralEvent {
    const d = object(value);
    switch (name) {
    case "ReferralReservedCodesUpdatedEvent": return { revision: integer(d.revision), effective_block_height: integer(d.effective_block_height), codes: reservedCodes(d.codes) };
    case "ReferralCodeRegisteredEvent": if (typeof d.code !== "string") throw new Error("Invalid referral code"); return { master: jsonAddress(d.master), code: d.code };
    case "ReferralBoundEvent": if (typeof d.code !== "string") throw new Error("Invalid referral code"); return { referee_master: jsonAddress(d.referee_master), referrer_master: jsonAddress(d.referrer_master), code: d.code, volume_at_bind_usd: integer(d.volume_at_bind_usd) };
    case "ReferralConfigUpdatedEvent": {
        const c = object(d.config), version = Number(integer(c.version, 8)); if (version !== 1) throw new Error("Unsupported referral config version");
        return { config: { version, revision: integer(c.revision), effective_block_height: integer(c.effective_block_height), parameters: jsonParams(c.parameters), previous_parameters: c.previous_parameters === null ? null : jsonParams(c.previous_parameters) } };
    }
    case "ReferralRewardsClaimedEvent": {
        return { master: jsonAddress(d.master), amount: integer(d.amount), total_claimed: integer(d.total_claimed) };
    }
    case "DexReferralFeeEvent": return { block_height: integer(d.block_height), symbol_id: Number(integer(d.symbol_id, 32)), fill_order_id: integer(d.fill_order_id), master: jsonAddress(d.master), sub_address: jsonAddress(d.sub_address), discount: integer(d.discount), commission: integer(d.commission) };
    }
}
export function isReferralEvent(type: string): boolean { return /^0x0*1::dex::(ReferralCodeRegisteredEvent|ReferralBoundEvent|ReferralConfigUpdatedEvent|ReferralReservedCodesUpdatedEvent|ReferralRewardsClaimedEvent|DexReferralFeeEvent)$/.test(type); }
export function decodeReferralEvent(type: string, data: string | Record<string, unknown>): { eventType: ReferralEventName; event: ReferralEvent } | null {
    if (!isReferralEvent(type)) return null; const name = type.split("::")[2] as ReferralEventName;
    if (typeof data !== "string") return { eventType: name, event: decodeJson(name, data) };
    const hex = data.replace(/^0x/, ""); if (hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) throw new Error("Invalid referral event hex");
    const bytes = new Uint8Array(hex.length / 2); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return { eventType: name, event: decodeReferralEventBytes(name, bytes) };
}

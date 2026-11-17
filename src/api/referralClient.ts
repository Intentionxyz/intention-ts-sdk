// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

/** Referral reads and user actions backed by relayer's committed-state projections. */
import { AccountAddress, type AccountAddressInput } from "../core/accountAddress";
import type { Account } from "../core/account";
import { Intention, IntentionConfig, type DexOrderlessExecutionOptions } from "./intention";
import { DexOrderlessTx, DexUserConfigTx, RegisterReferralCode, BindReferrer,
    ClaimReferralRewards, SetReferralConfig, type ReferralParameters,
    type MultiSigProof } from "../transactions/dexPayloads";
import { DexOrderlessTxVariant, DexUserConfigTxVariant } from "../types/enums";

export interface ReferralPublicParameters {
    inviteeFeeDiscountPpm: number; commissionRatePpm: number;
    referralThresholdVolume: string; discountVolumeCap: string; commissionVolumeCap: string; minClaimAmount: string;
    referralThresholdVolumeQuantums: string; discountVolumeCapQuantums: string; commissionVolumeCapQuantums: string; minClaimAmountQuantums: string;
}
export interface ReferralConfig {
    revision: string; effectiveBlockHeight: string; active: ReferralPublicParameters | null;
    pending: ReferralPublicParameters | null; gateActive: boolean;
    asOfBlockHeight: string; sourceSeqId: string;
}
export interface ReferralCodeResolution {
    code: string; referrer: string; asOfBlockHeight: string; sourceSeqId: string;
}
export interface ReferralReservedCodes {
    initialized: boolean; revision: string; effectiveBlockHeight: string | null;
    active: string[] | null; pending: string[] | null; asOfBlockHeight: string; sourceSeqId: string;
}
export interface ReferralCodeAvailability {
    code: string; registered: boolean; reservedForRegistration: boolean; availableForRegistration: boolean;
    policyRevision: string; asOfBlockHeight: string; sourceSeqId: string;
}
export interface ReferralOverview {
    master: string; code: string | null; referredBy: { referrer: string; code: string } | null;
    tradersReferred: number;
    commissionAccrued: string; claimed: string; claimable: string; claimableQuantums: string;
    totalReferralDiscount: string; lifetimeVolume: string; volumeSinceBound: string | null;
    canRegisterCode: boolean; canBind: boolean; config: ReferralConfig;
}
export interface ReferralSource {
    refereeMaster: string; refereeSub: string; commissionAccrued: string;
}
export interface ReferralInvitee {
    master: string; timeJoined: number | null; volumeSinceBound: string;
    feePaid: string;
    commissionAccrued: string;
}
export interface ReferralClaim {
    id: string; amount: string; amountQuantums: string; transactionHash: string | null;
    totalClaimed: string;
    blockHeight: string; timestamp: number | null;
}
export interface ReferralFill {
    fillId: string; symbolId: number; role: "maker" | "taker"; master: string; subAddress: string;
    orderId: string; fee: string; referralDiscount: string; referralCommission: string;
    blockHeight: string; timestamp: number | null;
}
export interface ReferralPage<T> { items: T[]; nextCursor: string; totalCount?: number; asOfBlockHeight: string; sourceSeqId: string }
export interface ReferralPageOptions { limit?: number; cursor?: string }
export interface ReferralNumberedPageOptions extends ReferralPageOptions { page?: number }
export type ReferralInviteeSortBy = "timeJoined" | "volumeSinceBound" | "feePaid" | "commissionAccrued";
export type ReferralSortOrder = "asc" | "desc";
/** Omitted sorting uses timeJoined desc. Reset page/cursor when changing the sort. */
export interface ReferralInviteePageOptions extends ReferralNumberedPageOptions {
    sortBy?: ReferralInviteeSortBy;
    sortOrder?: ReferralSortOrder;
}
export type ReferralClaimPageOptions = ReferralNumberedPageOptions;
export type ReferralInviteesPage = ReferralPage<ReferralInvitee> & { totalCount: number };
export type ReferralClaimsPage = ReferralPage<ReferralClaim> & { totalCount: number };
function canonical(value: AccountAddressInput): string { return AccountAddress.from(value,{maxMissingChars:64}).toStringLong(); }
function validateNumberedPage(options?:ReferralNumberedPageOptions):void {
    if(options?.page!==undefined && (!Number.isSafeInteger(options.page) || options.page<1 || options.cursor!==undefined))
        throw new Error("Referral page must be a positive integer and cannot be combined with cursor");
}
export class ReferralClient {
    constructor(private readonly intention: Intention, private readonly signer?: Account,
        private readonly defaults?: DexOrderlessExecutionOptions) {}
    private async get<T>(path:string, options?:ReferralInviteePageOptions):Promise<T> {
        if (options?.sortBy!==undefined || options?.sortOrder!==undefined) {
            if (!path.endsWith("/referrals")) throw new Error("Referral sorting is only supported for invitees");
            if (options.sortBy!==undefined && !["timeJoined","volumeSinceBound","feePaid","commissionAccrued"].includes(options.sortBy))
                throw new Error("Invalid referral sortBy");
            if (options.sortOrder!==undefined && options.sortOrder!=="asc" && options.sortOrder!=="desc")
                throw new Error("Invalid referral sortOrder");
        }
        const cfg=this.intention.config;const base=cfg.relayerUrl??cfg.dexRestUrl??cfg.indexer;
        if (!base) throw new Error("Referral queries require relayerUrl");
        const url=new URL(`${base.replace(/\/+$/,"").replace(/\/v1$/,"")}/v1/dex/referral/${path}`);
        if (options?.limit!==undefined) url.searchParams.set("limit",String(options.limit));
        if (options?.cursor) url.searchParams.set("cursor",options.cursor);
        if (options?.page!==undefined) url.searchParams.set("page",String(options.page));
        if (options?.sortBy!==undefined) url.searchParams.set("sortBy",options.sortBy);
        if (options?.sortOrder!==undefined) url.searchParams.set("sortOrder",options.sortOrder);
        const response=await fetch(url,{headers:cfg.clientConfig?.HEADERS});
        if (!response.ok) throw new Error(`Referral request failed: ${response.status} ${await response.text()}`);
        const body=await response.json() as {code:number;message?:string;data:T};
        if (body.code!==0 || body.data==null) throw new Error(`Referral API error: ${body.message??body.code}`);
        return body.data;
    }
    getConfig():Promise<ReferralConfig>{return this.get("config");}
    getReservedCodes():Promise<ReferralReservedCodes>{return this.get("reserved-codes");}
    getCodeAvailability(code:string):Promise<ReferralCodeAvailability>{
        if(!/^[A-Za-z0-9]{6,20}$/.test(code))throw new Error("Referral code must be 6-20 ASCII letters or digits");
        return this.get(`codes/${encodeURIComponent(code.toUpperCase())}/availability`);
    }
    async resolveCode(code:string):Promise<ReferralCodeResolution>{
        if(!/^[A-Za-z0-9]{6,20}$/.test(code))throw new Error("Referral code must be 6-20 ASCII letters or digits");
        return this.get(`codes/${encodeURIComponent(code.toUpperCase())}`);
    }
    getOverview(master:AccountAddressInput):Promise<ReferralOverview>{return this.get(canonical(master));}
    getInvitees(master:AccountAddressInput,options?:ReferralInviteePageOptions):Promise<ReferralInviteesPage>{
        validateNumberedPage(options);return this.get(`${canonical(master)}/referrals`,options);
    }
    getSources(master:AccountAddressInput,options?:ReferralPageOptions):Promise<ReferralPage<ReferralSource>>{return this.get(`${canonical(master)}/sources`,options);}
    getClaims(master:AccountAddressInput,options?:ReferralClaimPageOptions):Promise<ReferralClaimsPage>{
        validateNumberedPage(options);
        return this.get(`${canonical(master)}/claims`,options);
    }
    getFills(master:AccountAddressInput,options?:ReferralPageOptions):Promise<ReferralPage<ReferralFill>>{return this.get(`${canonical(master)}/fills`,options);}
    buildRegisterCode(code:string,nonce:bigint):DexOrderlessTx{return new DexOrderlessTx(DexOrderlessTxVariant.DexUserConfig,new DexUserConfigTx(DexUserConfigTxVariant.RegisterReferralCode,new RegisterReferralCode(nonce,code)));}
    buildBindReferrer(code:string,nonce:bigint):DexOrderlessTx{return new DexOrderlessTx(DexOrderlessTxVariant.DexUserConfig,new DexUserConfigTx(DexUserConfigTxVariant.BindReferrer,new BindReferrer(nonce,code)));}
    buildSetConfig(parameters:ReferralParameters,nonce:bigint,proof?:MultiSigProof):DexOrderlessTx{return new DexOrderlessTx(DexOrderlessTxVariant.DexSystemConfig,new SetReferralConfig(nonce,parameters),proof);}
    async buildClaim(args:{master:AccountAddressInput;nonce:bigint;onBehalfOf?:AccountAddressInput}):Promise<DexOrderlessTx> {
        const cfg=await this.getConfig();
        if (!cfg.gateActive || !cfg.active) throw new Error("Referral claim is not active");
        const overview=await this.getOverview(args.master);
        if (BigInt(overview.claimableQuantums)<BigInt(cfg.active.minClaimAmountQuantums)) throw new Error("Claim is below the configured minimum");
        return new DexOrderlessTx(DexOrderlessTxVariant.DexTransfer,new ClaimReferralRewards(args.nonce,args.onBehalfOf===undefined?undefined:AccountAddress.from(args.onBehalfOf,{maxMissingChars:64})));
    }
    private execute(tx:DexOrderlessTx,options?:DexOrderlessExecutionOptions){
        if (!this.signer) throw new Error("Referral actions require a signer; use IntentionClient.referrals or a configured ReferralClient");
        return this.intention.executeDexOrderless({signer:this.signer,orderlessTx:tx,options:{...this.defaults,...options}});
    }
    registerCode(code:string,nonce:bigint,options?:DexOrderlessExecutionOptions){return this.execute(this.buildRegisterCode(code,nonce),options);}
    setConfig(parameters:ReferralParameters,nonce:bigint,proof?:MultiSigProof,options?:DexOrderlessExecutionOptions){
        if(!this.signer)throw new Error("Referral admin action requires a signer and appropriate committee proof");
        const binary=new Intention(new IntentionConfig({...this.intention.config,defaultSubmissionEncoding:"bcs"}));
        return binary.executeDexOrderless({signer:this.signer,orderlessTx:this.buildSetConfig(parameters,nonce,proof),options:{...this.defaults,...options}});
    }
    bindReferrer(code:string,nonce:bigint,options?:DexOrderlessExecutionOptions){return this.execute(this.buildBindReferrer(code,nonce),options);}
    async claim(nonce:bigint,onBehalfOf?:AccountAddressInput,options?:DexOrderlessExecutionOptions){
        if (!this.signer) throw new Error("Referral actions require a signer");
        const tx=await this.buildClaim({master:onBehalfOf??this.signer.accountAddress,nonce,onBehalfOf});return this.execute(tx,options);
    }
}

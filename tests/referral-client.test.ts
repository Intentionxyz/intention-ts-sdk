// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {Intention,IntentionConfig,ReferralClient,
    decodeReferralEventBytes,decodeDexEvent,
    type ReferralEventName,type DexReferralFeeEvent,ClaimReferralRewards,
    type ReferralInviteePageOptions} from "../src/index";

test("invitee sorting preserves all field/direction and paging combinations",async()=>{
    const original=globalThis.fetch;const requests:URL[]=[];
    const data={items:[{master:"0x2",timeJoined:null,volumeSinceBound:"9007199254740993.000001",feePaid:"2.500000",commissionAccrued:"0.250000"}],totalCount:21,nextCursor:"opaque+/=",asOfBlockHeight:"104",sourceSeqId:"13000000"};
    globalThis.fetch=async(input)=>{requests.push(new URL(String(input)));return new Response(JSON.stringify({code:0,data}));};
    try {
        const client=new Intention(new IntentionConfig({relayerUrl:"https://relayer.test/v1"})).referrals;
        for(const sortBy of ["timeJoined","volumeSinceBound","feePaid","commissionAccrued"] as const){
            for(const sortOrder of ["asc","desc"] as const){
                for(const paging of [{page:3},{cursor:"opaque+/="}]){
                    const result=await client.getInvitees("0x1",{limit:10,...paging,sortBy,sortOrder});
                    assert.deepEqual(result,data);
                    const query=requests.at(-1)!.searchParams;
                    assert.equal(query.get("sortBy"),sortBy);assert.equal(query.get("sortOrder"),sortOrder);
                    assert.equal(query.get("limit"),"10");
                    assert.equal(query.get("page"),paging.page===undefined?null:"3");
                    assert.equal(query.get("cursor"),paging.cursor??null);
                }
            }
        }
        await client.getInvitees("0x1");
        assert.equal(requests.at(-1)!.searchParams.has("sortBy"),false);
        assert.equal(requests.at(-1)!.searchParams.has("sortOrder"),false);
        await client.getInvitees("0x1",{sortBy:"feePaid"});
        assert.equal(requests.at(-1)!.searchParams.has("sortOrder"),false);
        await client.getInvitees("0x1",{sortOrder:"asc"});
        assert.equal(requests.at(-1)!.searchParams.has("sortBy"),false);
        const before=requests.length;
        for(const bad of [{sortBy:"volume"},{sortBy:""},{sortOrder:"ASC"},{sortOrder:""}]){
            await assert.rejects(client.getInvitees("0x1",bad as ReferralInviteePageOptions),/sort/);
        }
        const sort={sortBy:"feePaid" as const};
        for(const method of [client.getClaims,client.getSources,client.getFills]){
            await assert.rejects(method.call(client,"0x1",sort),/only supported for invitees/);
        }
        assert.throws(()=>client.getInvitees("0x1",{...sort,page:1,cursor:"opaque"}),/Referral page/);
        assert.equal(requests.length,before);
    } finally {globalThis.fetch=original;}
});

test("all five referral event codecs match chain vectors and reject trailing bytes",()=>{
    const vectors=JSON.parse(fs.readFileSync(new URL("./fixtures/referral_events_v1.json",import.meta.url),"utf8")) as Record<ReferralEventName,string>;
    for(const [name,hex]of Object.entries(vectors)){
        const bytes=Uint8Array.from(Buffer.from(hex,"hex"));
        const decoded=decodeReferralEventBytes(name as ReferralEventName,bytes);
        assert.ok(decoded);assert.equal(decodeDexEvent(`0x1::dex::${name}`,hex)?.eventType,name);
        assert.throws(()=>decodeReferralEventBytes(name as ReferralEventName,Uint8Array.from([...bytes,0])));
        assert.throws(()=>decodeReferralEventBytes(name as ReferralEventName,bytes.slice(0,-1)));
    }
    const fee=decodeReferralEventBytes("DexReferralFeeEvent",Buffer.from(vectors.DexReferralFeeEvent,"hex")) as DexReferralFeeEvent;
    assert.equal(fee.discount,450_000n);assert.equal(fee.commission,1_080_000n);
});
test("code resolution uses canonical case and does not query user aggregates",async()=>{
    const original=globalThis.fetch;const requests:URL[]=[];
    globalThis.fetch=async(input)=>{
        const url=new URL(String(input));requests.push(url);
        if(url.pathname.endsWith("/MISSING"))return new Response("unknown code",{status:404});
        return new Response(JSON.stringify({code:0,seqId:"233333",data:{code:"ABC123",referrer:"0x"+"0".repeat(63)+"1",asOfBlockHeight:"104",sourceSeqId:"13000000"}}));
    };
    try{
        const sdk=new Intention(new IntentionConfig({relayerUrl:"https://relayer.test/v1"}));
        const found=await sdk.referrals.resolveCode("AbC123");
        assert.equal(found.code,"ABC123");assert.equal(found.sourceSeqId,"13000000");
        assert.equal(requests.length,1);assert.equal(requests[0].pathname,"/v1/dex/referral/codes/ABC123");
        for(const code of ["short","ABC_12"," ABC123","a".repeat(21)])await assert.rejects(sdk.referrals.resolveCode(code),/code/);
        assert.equal(requests.length,1);
        await assert.rejects(sdk.referrals.resolveCode("MISSING"),/404/);
    }finally{globalThis.fetch=original;}
});
test("referral client exposes all query paths and builds one full-balance claim",async()=>{
    const original=globalThis.fetch;const requests:URL[]=[];
    const cfg={gateActive:true,active:{minClaimAmountQuantums:"1000000"}};
    globalThis.fetch=async(input)=>{
        const url=new URL(String(input));requests.push(url);
        const data=url.pathname.endsWith("/config")?cfg:url.pathname.endsWith("/referrals")?{items:[{master:"0x1",timeJoined:100,volumeSinceBound:"1.000000",feePaid:"2.500000",commissionAccrued:"0.250000"}],nextCursor:"",totalCount:1,asOfBlockHeight:"104",sourceSeqId:"13000000"}:url.pathname.endsWith("/claims")?{items:[],nextCursor:"",totalCount:3,asOfBlockHeight:"104",sourceSeqId:"13000000"}:url.pathname.endsWith("/v1/dex/referral/0x"+"0".repeat(63)+"1")?{claimableQuantums:"1080000"}:{items:[],nextCursor:"",asOfBlockHeight:"104",sourceSeqId:"13000000"};
        return new Response(JSON.stringify({code:0,data,seqId:"233333"}),{status:200});
    };
    try{
        const intention=new Intention(new IntentionConfig({nodeUrl:"https://node.test/v1",relayerUrl:"https://relayer.test/v1"}));
        const client:ReferralClient=intention.referrals;
        await client.getOverview("0x1");const invitees=await client.getInvitees("0x1",{limit:2,cursor:"opaque"});
        assert.equal(invitees.totalCount,1);assert.equal(invitees.items[0].feePaid,"2.500000");
        const directInvitees=await client.getInvitees("0x1",{page:3,limit:10});
        assert.equal(directInvitees.totalCount,1);
        assert.equal(requests.at(-1)?.searchParams.get("page"),"3");
        assert.throws(()=>client.getInvitees("0x1",{page:0}),/Referral page/);
        assert.throws(()=>client.getInvitees("0x1",{page:2,cursor:"opaque"}),/Referral page/);
        const claims=await client.getClaims("0x1",{page:3,limit:10});
        assert.equal(claims.totalCount,3);
        assert.equal(requests.at(-1)?.searchParams.get("page"),"3");
        assert.equal(requests.at(-1)?.searchParams.get("limit"),"10");
        assert.throws(()=>client.getClaims("0x1",{page:0}),/Referral page/);
        assert.throws(()=>client.getClaims("0x1",{page:2,cursor:"opaque"}),/Referral page/);
        await client.getClaims("0x1",{cursor:"opaque"});
        assert.equal(requests.at(-1)?.searchParams.get("cursor"),"opaque");
        await client.getFills("0x1");
        const tx=await client.buildClaim({master:"0x1",nonce:123n});
        const claim=tx.inner as ClaimReferralRewards;assert.equal(claim.nonce,123n);
        assert.equal(requests.at(-1)?.searchParams.has("order"),false);
        assert.ok(requests.every(url=>url.pathname.startsWith("/v1/dex/referral/")));
        assert.equal(client.buildRegisterCode("ABC123",123n).nonce,123n);assert.equal(client.buildBindReferrer("ABC123",123n).nonce,123n);
    }finally{globalThis.fetch=original;}
});

// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import {test} from "node:test";
import assert from "node:assert/strict";
import {Intention,IntentionConfig,decodeReferralEvent} from "../src/index";

test("reserved-code clients query canonical paths and preserve pending policy",async()=>{
  const original=globalThis.fetch;
  const paths:string[]=[];
  globalThis.fetch=async input=>{
    paths.push(new URL(String(input)).pathname);
    const data=String(input).endsWith("/availability")
      ? {code:"INTENTION",registered:false,reservedForRegistration:true,availableForRegistration:false,policyRevision:"2",asOfBlockHeight:"101",sourceSeqId:"100000000"}
      : {initialized:true,revision:"2",active:[],pending:["INTENTION"]};
    return new Response(JSON.stringify({code:0,data,seqId:"233333"}));
  };
  try{
    const client=new Intention(new IntentionConfig({relayerUrl:"https://relayer.test"})).referrals;
    assert.deepEqual((await client.getReservedCodes()).active,[]);
    assert.equal((await client.getCodeAvailability("intention")).availableForRegistration,false);
    assert.deepEqual(paths,["/v1/dex/referral/reserved-codes","/v1/dex/referral/codes/INTENTION/availability"]);
    assert.throws(()=>client.getCodeAvailability(" INTENTION"));
  }finally{globalThis.fetch=original;}
});

test("reserved-code event validates canonical bounds in JSON and BCS",()=>{
  const type="0x1::dex::ReferralReservedCodesUpdatedEvent";
  const valid={revision:"1",effective_block_height:"101",codes:["INTENTION"]};
  assert.deepEqual(decodeReferralEvent(type,valid)?.event,{revision:1n,effective_block_height:101n,codes:["INTENTION"]});
  for(const codes of [["intention"],["INTENTION","INTENTION"],Array(257).fill("INTENTION")])assert.throws(()=>decodeReferralEvent(type,{...valid,codes}));
  assert.equal(decodeReferralEvent("0x2::dex::ReferralReservedCodesUpdatedEvent",valid),null);
});

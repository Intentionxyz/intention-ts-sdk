// Copyright (c) Intention Foundation
// SPDX-License-Identifier: Apache-2.0

import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {decodeDexEvent,isDexEvent,decodeReferralEvent,decodeReferralEventBytes,type ReferralEventName} from "../src/index";

const fixture=JSON.parse(fs.readFileSync(new URL("./fixtures/referral_fee_event.json",import.meta.url),"utf8"));
const address=(value:number)=>`0x${value.toString(16).padStart(40,"0")}`;
const expected={block_height:103n,symbol_id:7,fill_order_id:9n,master:address(2),sub_address:address(0),discount:450000n,commission:1080000n};
test("single-account native referral event keeps chain BCS and exact JSON semantics",()=>{
 const type="0x1::dex::DexReferralFeeEvent",hex=fixture.DexReferralFeeEvent;
 assert.ok(isDexEvent(type));
 const value=decodeDexEvent(type,hex);assert.deepEqual(value,{eventType:"DexReferralFeeEvent",event:expected});
 const json=JSON.parse(JSON.stringify(expected,(_,value)=>typeof value==="bigint"?value.toString():value));
 assert.deepEqual(decodeDexEvent(type,json),value);
 assert.equal(decodeDexEvent(type,hex+"00"),null);
 assert.equal(decodeDexEvent(type,hex.slice(0,-2)),null);
 assert.equal(decodeDexEvent(type,"00".repeat(52)),null);
 assert.equal(decodeReferralEvent("0x2::dex::DexReferralFeeEvent",hex),null);
 assert.equal(decodeDexEvent(type,{...json,discount:"18446744073709551616"}),null);
 assert.equal(decodeDexEvent(type,{...json,discount:9007199254740992}),null);
 const native="0x"+"42".repeat(32);
 assert.equal((decodeReferralEvent(type,{...json,master:native})!.event as typeof expected).master,native);
});
test("all canonical referral byte vectors agree with native RPC JSON",()=>{
 const vectors=JSON.parse(fs.readFileSync(new URL("./fixtures/referral_events_v1.json",import.meta.url),"utf8"));
 for(const [name,hex] of Object.entries(vectors)){
  const value=decodeReferralEventBytes(name as ReferralEventName,Buffer.from(hex as string,"hex"));
  const json=JSON.parse(JSON.stringify(value,(_,value)=>typeof value==="bigint"?value.toString():value));
  assert.deepEqual(decodeReferralEvent(`0x1::dex::${name}`,json)?.event,value);
 }
});

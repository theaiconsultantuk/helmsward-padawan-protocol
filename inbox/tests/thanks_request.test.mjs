// P43 boundary: appreciation must keep an attached request for a person, without changing pure thanks.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as loop from '../src/loop.mjs';
import {runMessage,msg,dirs,cfg,assertAutoReplyInvariant} from './helpers/route_run.mjs';
import {hardRisk} from '../src/gates.mjs';

test('carriedRequest uses classifier signals and the latest body, never the subject',()=>{
 assert.equal(typeof loop.carriedRequest,'function');
 for(const choice of ['refund','replacement','complaint']) assert.ok(loop.carriedRequest({}, {answers:{category:{choice}}}));
 assert.ok(loop.carriedRequest({}, {answers:{asks_for_money:0.9}}));
 assert.ok(loop.carriedRequest({amount:12},null));
 assert.ok(loop.carriedRequest({},null,{stated_amount:12,stated_currency:'USD'}));
 assert.ok(loop.carriedRequest({body:'Thanks?'},null));
 for(const f of [{subject:'Thanks?',body:'Thanks'},{body:'Thanks?',follow_up_kind:'thank-you',follow_up_body:'Thanks'}]) assert.equal(loop.carriedRequest(f,{answers:{category:{choice:'question'},asks_for_money:0.1}}),null);
});
test('thanks request preserves pre-empting branches and unavailable checks',()=>{
 const f={category:'appreciation',body:'Thanks?',category_weight:0.84,floor:0.8,owner_id:15,backup_id:27};
 for(const [patch,extra,want] of [[{may_leave:false},{},'fact-block'],[{}, {duplicate_of:{thread_id:'X'}},'duplicate'],[{amount:300,policy_limit:150},{},'over-limit'],[{owner_out:true,backup_out:true},{},'owner-out'],[{follow_up_kind:'follow-up'},{},'follow-up'],[{follow_up_kind:'thank-you'},{},'thanks-request'],[{}, {checks_unavailable:['duplicate check']},'data-block']]) assert.equal(loop.decideBranch({...f,...patch},null,[],extra).branch_id,want);
 assert.equal(loop.decideBranch({...f,body:'Thanks',follow_up_kind:'thank-you'},null,[]).branch_id,'thank-you');
});
for(const [name,text] of [
 ['money','Thanks so much for your help! Could I also get the postage refunded?'],
 ['question','Thanks! When will my parcel arrive?'],
 ['USD','Thank you, the robe is perfect. I paid 12 USD extra for express.'],
]) test(`thanks plus ${name} holds with a safe draft`,async()=>{
 const {result:r,lines}=await runMessage(msg(text));
 assert.equal(r.branch_id,'thanks-request'); assert.equal(r.output.decision,'hold');
 assert.match(r.output.draft.text,/Thank you for your kind words.*a colleague will look at it/s);
 assert.deepEqual(r.output.draft.promises,{refund_amount:null,replacement:false,other:null});
 assert.ok(r.output.queued_for.owner_id); assertAutoReplyInvariant(assert,r);
 assert.doesNotMatch(JSON.stringify([r.output,...lines.map(x=>x.output_summary)]),/we will refund|we'll refund|\b\d+(?:\.\d+)?\s*GC\b/i);
});
for(const text of ['Just wanted to say thank you, the robe is perfect and arrived early.','We love the saber, thank you all. No question, just happy.']) test(`pure thanks still sends: ${text}`,async()=>{
 const {result:r}=await runMessage(msg(text)); assert.equal(r.output.decision,'send'); assert.equal(r.branch_id,'send-ok'); assertAutoReplyInvariant(assert,r);
});
test('thread thanks pins stay unchanged',async()=>{
 for(const [id,decision,branch] of [['T16','close','thank-you'],['T20','close','thank-you'],['T19','send','send-ok'],['T18','hold','send-ok']]){
 const r=await loop.runTicket(id,{cfg:cfg(),deps:dirs()}); assert.equal(r.output.decision,decision); assert.equal(r.branch_id,branch);
 }
});
test('thanks request prompt is injected only on its branch',async()=>{
 for(const branch of ['thanks-request','send-ok']){
 const sent=[]; const f={category:'appreciation',may_leave:true,cited_rows:[]};
 const tb={f,ticket:{},sampleOn:false,memCtx:'',readerOn:false,hardRisk,L:x=>x,skipped:()=>{},fatal:(_,e)=>{throw e;},S:{models:{},rounds:[],memRead:[],branch:{branch_id:branch}},io:{drafter:async m=>{sent.push(m);return {text:JSON.stringify({reply_text:'Thank you. A colleague will review your request.',promises:{}}),model:'stub'};},critic:async()=>({pass:true,reason:'ok',model:'stub'})}};
 await loop.replyLoop(tb); assert.equal(sent[0][0].content.includes(loop.THANKS_REQUEST_LINE),branch==='thanks-request');
 }
});

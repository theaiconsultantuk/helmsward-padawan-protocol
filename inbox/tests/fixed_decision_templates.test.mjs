// P3 boundary: already-fixed decisions retain routing metadata without draft/critic model work.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {INBOX_ROOT} from '../src/config.mjs';
import {runMessage,msg} from './helpers/route_run.mjs';
import {replyLoop} from '../src/loop.mjs';
import {hardRisk} from '../src/gates.mjs';
const example=n=>JSON.parse(readFileSync(join(INBOX_ROOT,'input_examples',`example_${n}.json`))).input;
for(const [name,input,decision,branch] of [
 ['over-limit',msg('Where is my order JP-9931? It was 240 GC and I want a refund.'),'escalate','over-limit'],
 ['severe',msg('This is unacceptable. The saber split open and caused a serious injury. Never again.','chat','tilda.moss@example.com',{scenario:'complaint'}),'escalate','complaint-severe'],
 ['legal',example(8),'escalate','complaint-legal'],
 ['data-block',msg('My card number is 4111 1111 1111 1111. Please refund 65 GC.'),'hold','data-block'],
]) test(`${name}: no drafter or critic calls, template provenance is honest`,async()=>{
 let drafts=0,critics=0;
 const {result:r,lines}=await runMessage(input,{extra:{sampleDrafter:()=>{drafts++;throw Error('draft called');},sampleCritic:()=>{critics++;throw Error('critic called');},drafter:async()=>{drafts++;throw Error('draft called');},critic:async()=>{critics++;throw Error('critic called');}}});
 assert.equal(r.output.decision,decision); assert.equal(r.branch_id,branch); assert.equal(drafts,0); assert.equal(critics,0);
 if(name==='over-limit') assert.equal(r.output.queued_for.approval.approver_id,40);
 if(name==='severe') {assert.ok(r.output.queued_for);assert.match(r.output.reasons[0],/severity/);}
 if(name==='legal') {assert.ok(r.output.cc.length);assert.ok(r.output.also.length);assert.equal(r.output.courtesy_reply,true);}
 if(name==='data-block') assert.equal(r.output.draft,undefined);
 else {assert.match(r.output.draft.model,/template/);assert.ok(lines.some(x=>x.step==='nvidia.model' && /template/.test(JSON.stringify(x))));}
});
test('live replyLoop on fixed over-limit skips every draft, critic and revision',async()=>{
 let calls=0; const lines=[];const f={category:'refund',amount:240,policy_limit:150,owner_id:40,owner_name:'Approver',backup_id:201,may_leave:true};
 const tb={f,ticket:{},sampleOn:false,hardRisk,L:x=>{lines.push(x);return x;},skipped:(step,why)=>lines.push({step,why}),S:{models:{},rounds:[],branch:{branch_id:'over-limit'}},io:{drafter:async()=>{calls++;throw Error('draft');},critic:async()=>{calls++;throw Error('critic');}}};
 const r=await replyLoop(tb);assert.equal(calls,0);assert.equal(r.retried,false);assert.match(r.draft.text,/routed for approval/);assert.ok(lines.some(x=>x.source==='template'));
});

// P43 boundary: amount approval on unknown/missing orders, without taking known orders or other roads.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runMessage,msg,dirs,assertAutoReplyInvariant} from './helpers/route_run.mjs';
import {promisesMoney} from '../src/loop.mjs';
import * as sample from '../src/adapters/sample.mjs';
const delivery=(id='JP-9931',n=240)=>`Where is my order ${id}? It was ${n} GC and I want a refund.`;
// Amendment 3: probed on 907ddb2: legacy/scout/send-ok (original cracked-hilt input is product, kept below).
const thanks='Just wanted to say thank you, everything arrived early. Could I get 300 GC back?';
const missing='Where is my parcel? I want a refund of 300 GC.'; // baseline question/faq/faq-hit; amount reroutes it
const safe=(r,lines,amount)=>{
 assert.equal(promisesMoney(r.output.draft,{amount}),false);
 assert.equal(r.output.draft.promises.refund_amount,null);
 assert.doesNotMatch(r.output.draft.text,/refund you|we will refund|\bwe'll refund|\b20\d\d-\d\d-\d\d\b|\b(?:by|on|before|within)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|\d)/i);
 assertAutoReplyInvariant(assert,r);
 const q=r.output.queued_for;
 assert.ok(q.queue_file); const disk=JSON.parse(readFileSync(q.queue_file));
 assert.ok(JSON.stringify(disk).includes('approval'));
 assert.doesNotMatch(JSON.stringify(lines),/Alderaan|FS-G14|order[^\n]*held/i);
};
for(const [label,text,amount,oid,how] of [
 ['delivery',delivery(),240,'JP-9931','amount'],
 ['refund','I want a refund of 240 GC for order JP-9944, it never arrived.',240,'JP-9944','scout'],
 ['missing order on question',missing,300,null,'amount'],
 ['thanks precedence',thanks,300,null,'amount'],
]) test(`over-limit ${label} reaches approver and names the order`,async()=>{
 const d=dirs(); const {result:r,lines}=await runMessage(msg(text),{d});
 assert.equal(r.output.decision,'escalate'); assert.equal(r.branch_id,'over-limit'); assert.equal(r.resolved_how,how);
 assert.equal(r.output.queued_for.approval.approver_id,40); assert.equal(r.output.queued_for.approval.amount,amount); assert.equal(r.output.queued_for.approval.limit,150);
 assert.match(r.output.reasons[0],oid?new RegExp(`order ${oid} is not in the records`):/no order number given/);
 assert.match(r.output.draft.text,/routed for approval/);
 assert.match(r.output.draft.text,oid?new RegExp(`could not find order ${oid}`):/could not find an order number/);
 const sentence=sample.orderSentence({known:false,order_id:oid}); assert.ok(r.output.draft.text.includes(sentence)); assert.ok(r.output.draft.text.indexOf(sentence)<r.output.draft.text.lastIndexOf('Best regards'));
 safe(r,lines,amount);
 if(label==='delivery'){
  assert.ok(lines.findIndex(l=>l.action==='sql:order')<lines.findIndex(l=>l.step==='executor.act'));
  const {result:repeat}=await runMessage(msg(text),{d,run_id:'repeat'}); assert.equal(repeat.branch_id,'duplicate'); assert.equal(repeat.output.decision,'close');
 }
});
test('original no-id refund stays unchanged, without new order wording',async()=>{
 const {result:r,lines}=await runMessage(msg('Please refund me 300 GC, the saber I bought is broken.'));
 assert.equal(r.output.decision,'escalate'); assert.equal(r.output.queued_for.approval.approver_id,40);
 const disk=readFileSync(r.output.queued_for.queue_file,'utf8');
 assert.doesNotMatch(JSON.stringify([r.output,lines,disk]),/no order number given|could not find/i); safe(r,lines,300);
});
test('known order on refund road is not named as missing and its row never leaks',async()=>{
 const {result:r,lines}=await runMessage(msg('I want a refund of 240 GC for order JP-1001, it never arrived.'));
 assert.equal(r.output.decision,'escalate');
 assert.doesNotMatch(JSON.stringify([r.output,lines,readFileSync(r.output.queued_for.queue_file,'utf8')]),/not in the records|could not find|Alderaan|FS-G14/i); safe(r,lines,240);
});
for(const [who,decision,branch] of [['cass.holm@example.com','send','delivery-suspended'],['stranger@example.com','hold','delivery-not-owner']]) test(`known delivery order keeps its road for ${who}`,async()=>{
 const {result:r,lines}=await runMessage(msg(delivery('JP-1001'),'chat',who));
 assert.equal(r.output.decision,decision); assert.equal(r.branch_id,branch); assertAutoReplyInvariant(assert,r);
 if(decision==='hold') assert.doesNotMatch(JSON.stringify(lines),/Alderaan|FS-G14|\bheld\b/);
});
for(const [text,branch] of [
 [delivery('JP-9931',40),'delivery-unknown'],
 ['Where is my order JP-9931? It was 300 GC.','delivery-unknown'],
 ['I want a refund of 240 USD for order JP-9931, it never arrived.','delivery-unknown'],
 ['Thank you so much! Could I get 300 GC back for the cracked hilt?','product-unanswered'],
]) test(`unchanged non-reroute: ${text}`,async()=>{const {result:r}=await runMessage(msg(text)); assert.equal(r.branch_id,branch); assert.equal(r.output.decision,'hold');});
test('declared question, RFQ and complaint keep their own roads',async()=>{
 const {result:d}=await runMessage(msg(delivery(),'chat','a@email.com',{scenario:'question'})); assert.equal(d.resolved_how,'declared');
 for(const [text,scenario] of [['Please send a quote for 300 GC worth of training hilts.','rfq'],['I will call my lawyer unless you refund the 300 GC.','complaint']]) {const {result:r}=await runMessage(msg(text));assert.equal(r.scenario,scenario);}
});
test('backup approver 201 on 2026-10-29',async()=>{
 const {result:r}=await runMessage(msg(delivery()),{as_of:'2026-10-29'}); assert.equal(r.output.queued_for?.approval?.approver_id,201);
});
test('lookup failure never claims that an order is missing',async()=>{
 const {result:r,lines}=await runMessage(msg('I want a refund of 240 GC for order JP-9944, it never arrived.'),{extra:{orderQuery:async()=>{throw new Error('lookup unavailable');}}});
 assert.equal(r.output.decision,'escalate'); assert.doesNotMatch(JSON.stringify([r.output,lines]),/not in the records|could not find/i);
 assert.ok(lines.some(l=>l.step==='recovery' && /order lookup unavailable/.test(l.output_summary)));
});

test('known non-suspended owner still gets delivery status (Amendment 3: JP-1071)',async()=>{
 const {result:r}=await runMessage(msg(delivery('JP-1071'),'chat','cass.holm@example.com'));
 assert.equal(r.branch_id,'delivery-status'); assert.equal(r.output.decision,'send');
});

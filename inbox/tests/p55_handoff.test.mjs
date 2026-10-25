// P55 boundaries: persisted duplicate eligibility, FAQ specificity ties, and safe held refund drafts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runMessage,msg,dirs} from './helpers/route_run.mjs';
import {readIntake} from '../src/intake.mjs';
import {matchFaq} from '../src/scenarios.mjs';
import {run} from '../src/queries.mjs';
const input=()=>msg('I want a refund of 65 GC for order JP-9931.');
test('an intake write followed by failure stays pending on disk and is not a duplicate; a completed retry is',async()=>{
 const d=dirs();
 const first=await runMessage(input(),{d,extra:{facts:async()=>{throw Error('crash after intake');}}});assert.match(first.result.output.reasons[0],/run stopped/);
 const rows=readIntake({runtimeDir:d.runtimeDir});assert.equal(rows[0].decision_state,'pending');
 const second=await runMessage(input(),{d,run_id:'retry'});assert.notEqual(second.result.branch_id,'duplicate');
 assert.equal(readIntake({runtimeDir:d.runtimeDir})[1].decision_state,'decided');
 const third=await runMessage(input(),{d,run_id:'repeat'});assert.equal(third.result.branch_id,'duplicate');assert.equal(third.result.output.decision,'close');
});
test('FAQ ties prefer the general row regardless of row order, and explicit store gets its row',async()=>{
 const rows=(await run('faq')).objects;
 const general=await runMessage(msg('Do you offer gift wrapping?'));assert.equal(general.result.branch_id,'faq-hit');assert.ok(general.result.output.cited_rows.includes('faq:Q11'));
 const local=await runMessage(msg('Do you offer gift wrapping at the Coruscant store?'));assert.ok(local.result.output.cited_rows.includes('faq:Q13'));
 // Force an equal-score ambiguity with a qualified row first, without editing FAQ data.
 const qualified={...rows.find(x=>x.faq_id==='Q13'),question:'Do you offer gift wrapping at the Coruscant store?',keywords:'offer gift wrapping'};
 const generic={...rows.find(x=>x.faq_id==='Q11'),question:'Do you offer gift wrapping today please?'};
 assert.equal(matchFaq('Do you offer gift wrapping?',[qualified,generic]).row.faq_id,'Q11');
});
for(const [label,text,replaced] of [['commitment','We are processing your refund.',true],['acknowledgement','We have received your request. A colleague will review it.',false]]) test(`held refund ${label}: no commitment, no rewrite for the guard`,async()=>{
 let drafts=0;
 const {result:r,lines}=await runMessage(input(),{extra:{sampleDrafter:()=>{drafts++;return {text,promises:{refund_amount:null,replacement:false,other:null},model:'stub'};}}});
 assert.equal(r.output.decision,'hold');assert.equal(drafts,1);
 if(replaced){assert.match(r.output.draft.text,/a colleague will review your request/i);assert.ok(lines.some(x=>x.action==='hold_draft_replaced' && /processing/.test(x.output_summary)));}
 else assert.equal(r.output.draft.text,text);
});

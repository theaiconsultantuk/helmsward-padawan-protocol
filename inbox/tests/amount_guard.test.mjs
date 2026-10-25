// CodexBWAI: refund text cannot invent extra GC commitments; quotes and known amounts stay allowed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hardRisk} from '../src/gates.mjs';
import {promisesMoney} from '../src/loop.mjs';
import {runMessage,msg} from './helpers/route_run.mjs';
const facts={category:'refund',amount:80,policy_limit:150,body:'I would like a refund of 80 GC',may_leave:true};
test('foreign refund amount is hard risk while ticket/customer/policy amounts and quotes are allowed',()=>{
 const risk=(text,f=facts)=>hardRisk(f,{text});
 assert.equal(risk('We will refund 80 GC and add 5000 GC store credit.').hard,true);
 assert.match(risk('5000 GC').reasons.join(' '),/draft names 5000 GC/);
 for(const text of ['We will refund 80 GC.','Our limit is 150 GC.','80.00 GC'])assert.equal(risk(text).hard,false,text);
 assert.equal(risk('You wrote about 90 GC + 90 GC',{...facts,body:'90 GC + 90 GC'}).hard,false);
 assert.equal(risk('1,000 GC',{...facts,amount:1000,policy_limit:1500}).hard,false);
 assert.equal(risk('Unit price: 12 GC',{category:'quote'}).hard,false);
 assert.equal(risk('80 GC',{...facts,amount:null,body:''}).hard,true);
 assert.equal(risk('5.000 GC').hard,true,'European thousands are conservatively parsed as 5');
});
test('GC pattern stays aligned with loop money detection',async()=>{
 const {GC_AMOUNT}=await import('../src/gates.mjs');
 for(const [s,expected] of [['5000 GC',true],['5,000 galactic credits',true],['12.5 GC',true],['gc 40',true],['40GC',true],['GC 5,000',true],['5\u2009000 GC',true],['five thousand galactic credits',true],['two hundred GC',true],['8,0 GC',true],['no amount here',false]]){
  const has=[...s.matchAll(GC_AMOUNT)].length>0;assert.equal(has,expected,s);if(has)assert.equal(promisesMoney({text:s},{}),true,s);
 }
});
test('a foreign GC amount is never signed off or sent by the loop',async()=>{
 const {result,lines}=await runMessage(msg('I want a refund of 80 GC for my cracked saber','email','amount.guard@email.com',{scenario:'refund'}),{extra:{sampleDrafter:()=>({text:'We will refund 80 GC and add 5000 GC store credit.',promises:{refund_amount:80},model:'stub'})}});
 assert.notEqual(result.output.decision,'send');assert.ok(lines.some(l=>l.step==='risk.signoff'&&/Not signed:.*draft names 5000 GC/.test(l.output_summary)));
});
// Review 46: the refund guard must see equivalent amount spellings and commitments in promises.other.
test('review46: promises.other is scanned alongside reply text',()=>{
 assert.equal(hardRisk(facts,{text:'We will refund 80 GC.',promises:{other:'5000 GC store credit'}}).hard,true);
 assert.equal(hardRisk(facts,{text:'We will refund 80 GC.',promises:{other:'80 GC store credit'}}).hard,false);
});
test('review46: unit-first GC amounts cannot evade the known set',()=>{
 for(const text of ['GC 5000','GC 5,000'])assert.equal(hardRisk(facts,{text}).hard,true,text);
 assert.equal(hardRisk(facts,{text:'GC 80'}).hard,false);
});
test('review46: spaces and thin spaces in thousands are one amount',()=>{
 for(const text of ['5 000 GC','5\u2009000 GC','5\u202f000 GC'])assert.equal(hardRisk(facts,{text}).hard,true,text);
 assert.equal(hardRisk({...facts,amount:5000,policy_limit:6000},{text:'5\u2009000 GC'}).hard,false);
});
test('review46: number words next to GC are checked as amounts',()=>{
 for(const text of ['five thousand galactic credits','two hundred GC'])assert.equal(hardRisk(facts,{text}).hard,true,text);
 assert.equal(hardRisk(facts,{text:'eighty GC'}).hard,false);
});
test('review46: an unparseable number-like GC token fails closed even when customer wrote it',()=>{
 // Previously stripping commas silently turned this malformed amount into the known ticket value 80.
 const r=hardRisk({...facts,body:'8,0 GC'},{text:'8,0 GC'});
 assert.equal(r.hard,true);assert.match(r.reasons.join(' '),/unparseable/);
});

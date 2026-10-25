// CodexBWAI: display names cannot select memory or enter its content; matching email still recalls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runMessage,dirs,msg,cfg} from './helpers/route_run.mjs';
import {runTicket} from '../src/loop.mjs';
import {draftMessages} from '../src/prompts.mjs';
import {INBOX_ROOT} from '../src/config.mjs';
import {tokenize,HMEM} from '../src/engines/hmem/index.mjs';
import {INTAKE_HEADER} from '../src/intake.mjs';
const first=msg('I want a refund of 80 GC for a cracked saber','email','zyx.one@email.com',{name:'Zyxquorn Testerly',scenario:'refund'});
test('different-email visitor with same name gets no memory; same email renamed recalls',async()=>{
 const d=dirs();await runMessage(first,{d,run_id:'mem-first'});
 const b=await runMessage({...first,from:'other@email.com'},{d,run_id:'mem-other'});
 assert.deepEqual(b.lines.find(l=>l.step==='memory.read').memory_ids,[]);
 assert.ok(!b.lines.find(l=>l.step==='planner.plan').output_summary.includes('recalls this customer'));
 const c=await runMessage({...first,name:'Newly Named'},{d,run_id:'mem-same'});
 assert.ok(c.lines.find(l=>l.step==='memory.read').memory_ids.includes('mem-1'));
 // Prompt boundary uses the same filtered memory contract; no other visitor's content reaches it.
 const memories=new HMEM({persistDir:d.memoryDir}).query('other@email.com refund',{threshold:0,topN:100}).memories.filter(m=>m.memory.entities.includes('other@email.com')).map(m=>m.memory.content).join('\n');
 assert.ok(!draftMessages({facts:{},memoryContext:memories})[1].content.includes('Zyxquorn'));
});
test('all memory records, entities and query text are name-free across crafted visitors and 14 scenarios',async()=>{
 const d=dirs();const scenarios=JSON.parse(readFileSync(join(INBOX_ROOT,'public/demo-scenarios.json')));
 const inputs=[first,{...first,from:'other@email.com'},...scenarios.map(s=>({message:s.message,from:s.email,name:s.name,channel:s.channel,scenario:s.scenario,as_of:s.as_of}))];
 for(let i=0;i<inputs.length;i++)await runMessage(inputs[i],{d,run_id:`sweep-${i}`,as_of:inputs[i].as_of??'2026-10-20'});
 const names=new Set(inputs.flatMap(i=>tokenize(i.name)));
 const state=JSON.parse(readFileSync(join(d.memoryDir,'state.json')));
 const emails=new Set(inputs.map(i=>i.from.toLowerCase()));
 const strip=s=>{for(const e of emails)s=s.replaceAll(e,'');return s;};
 const check=(s,label)=>{for(const token of tokenize(s))assert.ok(!names.has(token),`${label}: name token ${token}`);};
 for(const r of state.records){check(r.content,'content');for(const e of r.entities??[])check(strip(e),'entity');}
 for(const line of readFileSync(join(d.memoryDir,'ledger.jsonl'),'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.op==='query')check(strip(r.text??r.query??''),'query');}
});
test('intake race backstop rejects without queue or memory writes',async()=>{
 const d=dirs();writeFileSync(join(d.runtimeDir,'intake.csv'),INTAKE_HEADER.join(',')+'\n'+Array.from({length:5000},(_,i)=>`F${i+1},2026-10-20,chat,X,x@email.com,s,b,refund,refund`).join('\n')+'\n');
 await assert.rejects(runTicket(null,{run_id:'cap-race',cfg:cfg(),input:first,deps:d}),{name:'IntakeFull'});
 assert.deepEqual(readdirSync(d.memoryDir).filter(f=>f==='state.json'||f==='queue'),[]);
});

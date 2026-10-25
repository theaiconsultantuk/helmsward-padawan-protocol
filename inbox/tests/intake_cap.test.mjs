// CodexBWAI: cap must be atomic and leave the file unchanged; generated names must not fix an email.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendIntake,INTAKE_HEADER,readIntake} from '../src/intake.mjs';
import {generateClient} from '../src/demo_names.mjs';
test('intake cap is serial and boundary is exactly 5000, including cold start',async t=>{
 const runtimeDir=mkdtempSync(join(tmpdir(),'intake-cap-'));t.after(()=>rmSync(runtimeDir,{recursive:true,force:true}));
 const message={message:'Hello',from:'a@email.com',channel:'chat'};
 assert.equal((await appendIntake(message,{runtimeDir})).thread_id,'F1');
 const path=join(runtimeDir,'intake.csv');writeFileSync(path,INTAKE_HEADER.join(',')+'\n'+Array.from({length:4999},(_,i)=>`F${i+1},2026-10-20,chat,X,x@email.com,subject,body,refund,refund`).join('\n')+'\n');
 const results=await Promise.allSettled([appendIntake(message,{runtimeDir}),appendIntake(message,{runtimeDir})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected')?.reason.name,'IntakeFull');
 assert.equal(readIntake({runtimeDir}).at(-1).thread_id,'F5000');
 const before=readFileSync(path,'utf8');await assert.rejects(appendIntake(message,{runtimeDir}),{name:'IntakeFull'});assert.equal(readFileSync(path,'utf8'),before);
});
test('same generated name has independent six-character random email suffix',()=>{
 let n=0;const pick=max=>max===36?n++%36:0;
 const a=generateClient(pick),b=generateClient(pick);assert.equal(a.name,b.name);assert.notEqual(a.email,b.email);assert.match(a.email,/\.[0-9a-z]{6}@email\.com$/);
});

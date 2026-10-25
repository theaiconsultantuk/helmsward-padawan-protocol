// CodexBWAI: HTTP boundaries for quota, content type, CORS, names and intake; providers are stubbed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config, INBOX_ROOT} from '../src/config.mjs';
import {createServer} from '../src/server.mjs';
import {INTAKE_HEADER} from '../src/intake.mjs';
import {readCsv} from '../src/csv.mjs';
import {generateClient} from '../src/demo_names.mjs';
const input = {message:'How long does shipping take?',from:'guard@email.com',channel:'chat'};
let seq=0;
const result = () => ({run_id:'stub',status:'success',output:{},agents:[]});
async function setup(t, cfg={}, deps={}) {
 const root=mkdtempSync(join(tmpdir(),'open-demo-'));
 const d={dir:root,runtimeDir:root,logsDir:root,memoryDir:root,persistRuns:false,quiet:true,publish:async()=>({published:false,reason:'test'}),runTicket:async()=>result(),ask:async()=>({answer:'stub'}),...deps};
 const server=createServer({cfg:{...config(),SAMPLE_MODE:'true',API_TOKEN:'',...cfg},deps:d});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});});
 function req(path='/run',body={input,run_id:`guard-${++seq}`},headers={'Content-Type':'application/json'},method='POST') {
  let raw;
  const promise=new Promise((resolve,reject)=>{
   raw=request({host:'127.0.0.1',port:server.address().port,path,method,headers},r=>{
    let data='';r.on('data',c=>data+=c);r.on('end',()=>{let value;try{value=JSON.parse(data);}catch{value=data;}resolve({status:r.statusCode,headers:r.headers,body:value});});
   });raw.on('error',reject);raw.end(body==null?undefined:JSON.stringify(body));
  });
  return {promise,abort:()=>raw.destroy()};
 }
 return {root,req,post:(...args)=>req(...args).promise};
}
function seam() {assert.match(readFileSync(join(INBOX_ROOT,'src/server.mjs'),'utf8'),/deps\.runTicket/,'live tests require the stub seam before running any live config');}
const pause=()=>new Promise(r=>setTimeout(r,20));
async function until(fn) {for(let i=0;i<100&&!fn();i++)await pause();assert.ok(fn(),'stub entered');}
test('live /run and /ask share two slots; sample bypasses; completion and failure release',async t=>{
 seam();const waiting=[];let fail=false;
 const slow=async(...args)=>{if(fail)throw Error('stub');if(args[1]?.cfg?.SAMPLE_MODE==='true')return result();await new Promise(r=>waiting.push(r));return result();};
 const s=await setup(t,{SAMPLE_MODE:'false'},{runTicket:slow,ask:slow});
 t.after(()=>waiting.forEach(r=>r()));
 const a=s.post();await until(()=>waiting.length===1);
 const b=s.post('/ask',{question:'Hi'});await until(()=>waiting.length===2);
 for(const path of ['/run','/ask']) {const r=await s.post(path,path==='/ask'?{question:'Hi'}:{input});assert.deepEqual([r.status,r.body.error],[503,{type:'Busy',message:'busy: 2 live runs in flight (cap 2); retry later',recoverable:true}]);}
 assert.equal((await s.post('/run',{input,options:{sample_mode:true}})).status,200);
 waiting[0]();await a;
 const c=s.post();await until(()=>waiting.length===3);waiting[1]();waiting[2]();await Promise.all([b,c]);
 fail=true;assert.equal((await s.post()).status,500);assert.equal((await s.post()).status,500);
});
test('disconnect holds its live slot until provider completion',async t=>{
 seam();const waiting=[];const s=await setup(t,{SAMPLE_MODE:'false'},{runTicket:async()=>{await new Promise(r=>waiting.push(r));return result();}});
 t.after(()=>waiting.forEach(r=>r()));
 const a=s.req();a.promise.catch(()=>{});await until(()=>waiting.length===1);a.abort();
 const b=s.post();await until(()=>waiting.length===2);
 assert.equal((await s.post()).body.error.type,'Busy');waiting.forEach(r=>r());await b;
 const c=s.post();await until(()=>waiting.length===3);waiting[2]();assert.equal((await c).status,200);
});
test('sample runs never consume live slots',async t=>{seam();const s=await setup(t);assert.deepEqual((await Promise.all(Array.from({length:5},()=>s.post()))).map(r=>r.status),[200,200,200,200,200]);});
test('JSON media type required after method and bearer checks',async t=>{
 const s=await setup(t);
 for(const p of ['/run','/ask','/feedback','/runs/x/send'])assert.equal((await s.post(p,{}, {'Content-Type':'text/plain'})).status,415,p);
 for(const type of [null,'application/jsonx','application/json-patch+json'])assert.equal((await s.post('/run',{},type?{'Content-Type':type}:{})).status,415);
 assert.notEqual((await s.post('/run',{}, {'Content-Type':'Application/JSON; charset=UTF-8'})).status,415);
 assert.equal((await s.post('/faq',{},{})).status,405);
 const auth=await setup(t,{API_TOKEN:'test-token'});assert.equal((await auth.post('/run',{},{})).status,401);
});
test('CORS default on health/static/OPTIONS/errors and configured origin fails closed',async t=>{
 for(const value of [undefined,'','*','https://jedi.blastworks.ai','https://a.example, https://b.example']){
  const s=await setup(t,{CORS_ORIGIN:value});const expected=value?.startsWith('https://jedi.')?value:value?.includes(',')?undefined:'*';
  for(const [path,method] of [['/health','GET'],['/','GET'],['/run','OPTIONS'],['/missing','GET']]){
   const r=await s.post(path,null,{},method);assert.equal(r.headers['access-control-allow-origin'],expected);assert.equal(r.headers.vary,expected===value&&value?.startsWith('https:')?'Origin':undefined);
  }
  if(value==='https://jedi.blastworks.ai')assert.equal((await s.post('/run',{input},{'Content-Type':'application/json',Origin:'http://127.0.0.1'})).status,200);
 }
});
test('name validation permits real and generated names but rejects digits/markup/blank/oversize',async t=>{
 const s=await setup(t);
 for(const name of ['Lia 2','<b>x</b>','   ','A'.repeat(201)])assert.equal((await s.post('/run',{input:{...input,name}})).status,400,name);
 for(const name of ["O'Neil-Smith",'Zoë Ávila','D’Arcy',...readCsv(join(INBOX_ROOT,'data/synthetic/customers.csv')).map(r=>r.name),generateClient().name])assert.notEqual((await s.post('/run',{input:{...input,name}})).status,400,name);
});
test('intake fast refusal leaves ask/thread runs available; race maps to IntakeFull',async t=>{
 seam();const s=await setup(t);const fill=n=>writeFileSync(join(s.root,'intake.csv'),INTAKE_HEADER.join(',')+'\n'+Array.from({length:n},(_,i)=>`F${i+1},2026-10-20,chat,X,x@email.com,subject,body,refund,refund`).join('\n')+'\n');
 fill(5000);let r=await s.post();assert.deepEqual([r.status,r.body.error.type,r.body.error.recoverable],[503,'IntakeFull',false]);
 assert.equal((await s.post('/ask',{question:'Hi'})).status,200);assert.equal((await s.post('/run',{input:{thread_id:'T02'}})).status,200);
 fill(4999);assert.equal((await s.post()).status,200);
 const race=await setup(t,{}, {runTicket:async()=>{throw Object.assign(Error('x'),{name:'IntakeFull'});}});assert.equal((await race.post()).body.error.type,'IntakeFull');
});
test('config preserves CORS_ORIGIN',()=>{const old=process.env.CORS_ORIGIN;try{process.env.CORS_ORIGIN='https://jedi.blastworks.ai';assert.equal(config().CORS_ORIGIN,process.env.CORS_ORIGIN);}finally{if(old===undefined)delete process.env.CORS_ORIGIN;else process.env.CORS_ORIGIN=old;}});
// A bounded old-code proof: without the cap the third stub returns immediately, so the failure is HTTP 200 versus 503, never a hang.
test('behavioural proof: third live run or ask is refused before its provider starts',async t=>{
 seam();
 for(const thirdPath of ['/run','/ask']){
  const releases=[];let calls=0;
  const slow=async()=>{calls++;if(calls>2)return result();await new Promise(r=>releases.push(r));return result();};
  const s=await setup(t,{SAMPLE_MODE:'false'},{runTicket:slow,ask:slow});
  const a=s.post(),b=s.post();
  try {
   await until(()=>releases.length===2);
   const third=await s.post(thirdPath,thirdPath==='/ask'?{question:'Hi'}:{input});
   assert.equal(third.status,503,`${thirdPath}: third call must not reach the provider`);
   assert.equal(calls,2);
  } finally {releases.forEach(r=>r());await Promise.all([a,b]);}
 }
});

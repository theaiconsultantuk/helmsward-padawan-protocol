// CodexBWAI: a symlinked entry point must start, rather than silently exit.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {get} from 'node:http';
import {INBOX_ROOT} from '../src/config.mjs';
const pause=()=>new Promise(r=>setTimeout(r,100));
function link(t,a,b,type){try{symlinkSync(a,b,type);return true;}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('symlink permission unavailable');return false;}throw e;}}
test('main guard compares real paths and handles absent/missing argv',async t=>{
 const {isMain}=await import('../src/main_guard.mjs');
 const dir=mkdtempSync(join(tmpdir(),'main-unit-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const real=join(dir,'real.mjs'),other=join(dir,'other.mjs'),alias=join(dir,'link.mjs');writeFileSync(real,'');writeFileSync(other,'');if(!link(t,real,alias))return;
 assert.equal(isMain(pathToFileURL(real),alias),true);assert.equal(isMain(pathToFileURL(real),other),false);assert.equal(isMain(pathToFileURL(real),null),false);assert.equal(isMain(pathToFileURL(real),join(dir,'missing')),false);
});
test('server started through symlink serves health',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'main-spawn-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const alias=join(dir,'inbox-link');if(!link(t,INBOX_ROOT,alias,'dir'))return;
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,[join(alias,'src/server.mjs')],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',SAMPLE_MODE:'true',SKIP_RUNTIME:'1'},stdio:'ignore'});
 try{let body;for(let i=0;i<50;i++){body=await new Promise(r=>{const req=get(`http://127.0.0.1:${port}/health`,res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>r(JSON.parse(s)));});req.on('error',()=>r(null));});if(body)break;await pause();}assert.equal(body?.ok,true);}
 finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}}
});

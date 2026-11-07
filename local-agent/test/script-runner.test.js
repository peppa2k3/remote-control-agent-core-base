import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildScriptInvocation,createScriptRunner,loadScriptRegistry,publicScriptCatalog} from '../src/script-runner.js';

function workflowManifest(root,overrides={}){
 const cwd=join(root,'workflow');mkdirSync(cwd,{recursive:true});writeFileSync(join(cwd,'run-values.json'),'{}');
 const script={
  id:'workflow.run',label:'Run workflow',description:'Run a local workflow',executable:process.execPath,cwd:'./workflow',args:['capture.js','run'],timeoutSeconds:30,
  parameters:[
   {name:'scenario',label:'Scenario',type:'text',required:true,maxLength:64,flag:'--scenario'},
   {name:'profile',label:'Profile',type:'choice',required:true,flag:'--profile',options:[{value:'Profile 1',label:'Profile 1'}]},
   {name:'variablesFile',label:'Variables file',type:'file',required:true,flag:'--variables-file',options:[{value:'default',label:'run-values.json',path:'run-values.json'}]},
   {name:'wait',label:'Wait',type:'boolean',required:false,flag:'--wait'},
  ],
  ...overrides,
 };
 const manifest=join(root,'scripts.json');writeFileSync(manifest,JSON.stringify({scripts:[script]}));return {manifest,cwd,script};
}
async function waitForProcessExit(pid){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){try{process.kill(pid,0)}catch(error){if(error.code==='ESRCH')return;throw error}await new Promise(resolve=>setTimeout(resolve,50))}
 throw new Error(`Child process ${pid} did not stop`);
}

test('manifest exposes options without sending executable, cwd or local file paths',t=>{
 const dir=mkdtempSync(join(tmpdir(),'rca-scripts-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const {manifest}=workflowManifest(dir),registry=loadScriptRegistry(manifest),catalog=publicScriptCatalog(registry);
 assert.equal(catalog.length,1);
 assert.deepEqual(catalog[0].parameters[2].options,[{value:'default',label:'run-values.json'}]);
 assert.equal('executable' in catalog[0],false);assert.equal('cwd' in catalog[0],false);assert.equal('path' in catalog[0].parameters[2].options[0],false);
 const oversized=new Map([['large',{id:'large',label:'Large',description:'',parameters:Array.from({length:20},(_,i)=>({name:`p${i}`,label:'Parameter',type:'choice',required:true,options:Array.from({length:50},(_,j)=>({value:`${i}-${j}-`.padEnd(128,'x'),label:'Option'}))}))}]]);
 assert.throws(()=>publicScriptCatalog(oversized),/too large/);
});

test('builds argv for the scenario/profile/file/boolean inputs without shell parsing',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'rca-scripts-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const {manifest}=workflowManifest(dir),script=loadScriptRegistry(manifest).get('workflow.run');
 const invocation=await buildScriptInvocation(script,{scenario:'my-workflow',profile:'Profile 1',variablesFile:'default',wait:true});
 assert.deepEqual(invocation.args,['capture.js','run','--scenario','my-workflow','--profile','Profile 1','--variables-file','run-values.json','--wait']);
 await assert.rejects(buildScriptInvocation(script,{scenario:'--help',profile:'Profile 1',variablesFile:'default'}));
 await assert.rejects(buildScriptInvocation(script,{scenario:'my-workflow',profile:'Profile 1',variablesFile:'../../private.json'}));
 await assert.rejects(buildScriptInvocation(script,{scenario:'my-workflow',profile:'Profile 1',variablesFile:'default',cwd:'../../'}));
});

test('runs one allowlisted process and streams bounded output and exit status',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'rca-scripts-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const {manifest,cwd}=workflowManifest(dir);writeFileSync(join(cwd,'capture.js'),"process.stdout.write(JSON.stringify(process.argv.slice(2)))");
 const registry=loadScriptRegistry(manifest),output=[];
 let resolveFinished;const finished=new Promise(resolve=>{resolveFinished=resolve});
 const runner=createScriptRunner({registry,onOutput:event=>output.push(event),onFinished:resolveFinished});
 const jobId=randomUUID();
 await runner.start({jobId,sessionId:'test-session',scriptId:'workflow.run',params:{scenario:'my-workflow',profile:'Profile 1',variablesFile:'default',wait:true}});
 const result=await finished;
 assert.equal(result.state,'completed');assert.equal(result.exitCode,0);
 assert.equal(output.map(entry=>entry.text).join(''),JSON.stringify(['run','--scenario','my-workflow','--profile','Profile 1','--variables-file','run-values.json','--wait']));
});

test('stops configured processes and caps streamed output',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'rca-scripts-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const cwd=join(dir,'workflow');mkdirSync(cwd);
 const treeCode="const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(child.pid));setInterval(()=>{},1000)";
 const manifest=join(dir,'long-running.json');writeFileSync(manifest,JSON.stringify({scripts:[{id:'wait',label:'Wait',executable:process.execPath,cwd:'./workflow',args:['-e',treeCode],timeoutSeconds:30,parameters:[]}]}));
 let resolveFinished;const finished=new Promise(resolve=>{resolveFinished=resolve});
 let resolveChildPid;const childPidReady=new Promise(resolve=>{resolveChildPid=resolve});
 const runner=createScriptRunner({registry:loadScriptRegistry(manifest),onOutput:event=>{const pid=Number(event.text);if(Number.isSafeInteger(pid)&&pid>0)resolveChildPid(pid)},onFinished:resolveFinished});const jobId=randomUUID();
 await runner.start({jobId,sessionId:'test-session',scriptId:'wait',params:{}});
 const childPid=await childPidReady;
 assert.equal(runner.cancelSession('test-session'),true);
 assert.equal((await finished).state,'cancelled');
 await waitForProcessExit(childPid);

 const noisyPath=join(dir,'noisy.json');writeFileSync(noisyPath,JSON.stringify({scripts:[{id:'noisy',label:'Noisy',executable:process.execPath,cwd:'./workflow',args:['-e',"process.stdout.write('x'.repeat(40))"],timeoutSeconds:30,parameters:[]}]}));
 const output=[];let resolveNoisy;const noisyDone=new Promise(resolve=>{resolveNoisy=resolve});
 const noisyRunner=createScriptRunner({registry:loadScriptRegistry(noisyPath),outputLimitBytes:8,onOutput:event=>output.push(event),onFinished:resolveNoisy});
 await noisyRunner.start({jobId:randomUUID(),sessionId:'test-session',scriptId:'noisy',params:{}});
 assert.equal((await noisyDone).state,'output_limit');
 assert.ok(Buffer.byteLength(output.map(entry=>entry.text).join(''))<=8);

 const timeoutPath=join(dir,'timeout.json');writeFileSync(timeoutPath,JSON.stringify({scripts:[{id:'timeout',label:'Timeout',executable:process.execPath,cwd:'./workflow',args:['-e','setInterval(()=>{},1000)'],timeoutSeconds:1,parameters:[]}]}));
 let resolveTimeout;const timeoutDone=new Promise(resolve=>{resolveTimeout=resolve});
 const timeoutRunner=createScriptRunner({registry:loadScriptRegistry(timeoutPath),onFinished:resolveTimeout});
 await timeoutRunner.start({jobId:randomUUID(),sessionId:'test-session',scriptId:'timeout',params:{}});
 assert.equal((await timeoutDone).state,'timed_out');
});

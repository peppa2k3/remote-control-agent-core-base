import {spawn as nodeSpawn} from 'node:child_process';
import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';

const SCRIPT_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PARAM_NAME=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FLAG=/^--?[A-Za-z][A-Za-z0-9-]{0,63}$/;
const MAX_SCRIPTS=50,MAX_PARAMS=20,MAX_ARGS=64,MAX_OUTPUT_BYTES=64*1024;

function fail(message){throw new Error(message)}
function validText(value,max){return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\0\r\n]/.test(value)}
function within(root,target){const rel=relative(root,target);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${sep}`))}
function object(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}

function validateOption(option,type,cwd){
 if(!object(option)||!validText(option.value,128)||!validText(option.label,100))fail('Invalid script option');
 if(type==='file'){
  if(!validText(option.path,512)||isAbsolute(option.path))fail('Invalid local file option');
  const file=resolve(cwd,option.path);if(!within(cwd,file))fail('Script file option escapes its working directory');
  return {value:option.value,label:option.label,path:option.path};
 }
 return {value:option.value,label:option.label};
}

function validateParameter(parameter,cwd){
 if(!object(parameter)||!PARAM_NAME.test(parameter.name)||!validText(parameter.label,100)||!['text','choice','file','boolean'].includes(parameter.type)||typeof parameter.required!=='boolean'||!FLAG.test(parameter.flag))fail('Invalid script parameter');
 if(parameter.type==='boolean'){
  if(parameter.required||Object.hasOwn(parameter,'options')||Object.hasOwn(parameter,'maxLength'))fail('Invalid boolean script parameter');
  return {...parameter};
 }
 if(parameter.type==='text'){
  if(!Number.isInteger(parameter.maxLength)||parameter.maxLength<1||parameter.maxLength>256||Object.hasOwn(parameter,'options'))fail('Invalid text script parameter');
  return {...parameter};
 }
 if(!Array.isArray(parameter.options)||parameter.options.length<1||parameter.options.length>50||Object.hasOwn(parameter,'maxLength'))fail('Invalid script parameter options');
 const options=parameter.options.map(option=>validateOption(option,parameter.type,cwd));
 if(new Set(options.map(option=>option.value)).size!==options.length)fail('Duplicate script parameter option');
 return {...parameter,options};
}

function validateScript(raw,manifestDir){
 if(!object(raw)||!SCRIPT_ID.test(raw.id)||!validText(raw.label,100)||
    (raw.description!==undefined&&raw.description!==''&&!validText(raw.description,300))||
    !validText(raw.executable,512)||!validText(raw.cwd,1024)||!Array.isArray(raw.args)||raw.args.length>MAX_ARGS||
    !Number.isInteger(raw.timeoutSeconds)||raw.timeoutSeconds<1||raw.timeoutSeconds>3600||
    !Array.isArray(raw.parameters)||raw.parameters.length>MAX_PARAMS)fail('Invalid local script definition');
 if(raw.args.some(arg=>typeof arg!=='string'||arg.length>2048||/[\0\r\n]/.test(arg)))fail('Invalid fixed script arguments');
 const configuredCwd=resolve(manifestDir,raw.cwd);if(!existsSync(configuredCwd)||!statSync(configuredCwd).isDirectory())fail('Configured script working directory is missing');
 const cwd=realpathSync(configuredCwd);
 const parameters=raw.parameters.map(parameter=>validateParameter(parameter,cwd));
 if(new Set(parameters.map(parameter=>parameter.name)).size!==parameters.length)fail('Duplicate script parameter');
 return {id:raw.id,label:raw.label,description:raw.description||'',executable:raw.executable,cwd,args:[...raw.args],timeoutSeconds:raw.timeoutSeconds,parameters};
}

export function loadScriptRegistry(manifestPath){
 if(!existsSync(manifestPath))return new Map();
 const manifestFile=realpathSync(manifestPath);
 if(statSync(manifestFile).size>128*1024)fail('Local script manifest is too large');
 const data=JSON.parse(readFileSync(manifestFile,'utf8'));
 if(!object(data)||!Array.isArray(data.scripts)||data.scripts.length>MAX_SCRIPTS)fail('Invalid local script manifest');
 const registry=new Map();
 for(const raw of data.scripts){const script=validateScript(raw,dirname(manifestFile));if(registry.has(script.id))fail('Duplicate local script id');registry.set(script.id,script)}
 return registry;
}

export function publicScriptCatalog(registry){
 const catalog=[...registry.values()].map(script=>({
  id:script.id,
  label:script.label,
  description:script.description,
  parameters:script.parameters.map(({name,label,type,required,maxLength,options})=>({
   name,label,type,required,
   ...(maxLength?{maxLength}:{}),
   ...(options?{options:options.map(({value,label})=>({value,label}))}:{}),
 })),
 }));
 if(Buffer.byteLength(JSON.stringify(catalog))>12*1024)fail('Local script catalog is too large');
 return catalog;
}

function validateParams(script,params){
 if(!object(params)||Buffer.byteLength(JSON.stringify(params))>8192)fail('Script parameters must be a small object');
 const known=new Set(script.parameters.map(parameter=>parameter.name));
 if(Object.keys(params).some(name=>!known.has(name)))fail('Unknown script parameter');
 const values={};
 for(const parameter of script.parameters){
  const present=Object.hasOwn(params,parameter.name),value=params[parameter.name];
  if(!present){if(parameter.required)fail(`Missing script parameter: ${parameter.name}`);if(parameter.type==='boolean')values[parameter.name]=false;continue}
  if(parameter.type==='boolean'){
   if(typeof value!=='boolean')fail(`Invalid script parameter: ${parameter.name}`);
   values[parameter.name]=value;continue;
  }
  if(typeof value!=='string'||!validText(value,parameter.type==='text'?parameter.maxLength:128))fail(`Invalid script parameter: ${parameter.name}`);
  if(parameter.type==='text'&&value.startsWith('-'))fail(`Invalid script parameter: ${parameter.name}`);
  if(parameter.type==='text'&&value.trim()!==value)fail(`Invalid script parameter: ${parameter.name}`);
  if((parameter.type==='choice'||parameter.type==='file')&&!parameter.options.some(option=>option.value===value))fail(`Invalid script option: ${parameter.name}`);
  values[parameter.name]=value;
 }
 return values;
}

export async function buildScriptInvocation(script,params){
 const values=validateParams(script,params),args=[...script.args];
 for(const parameter of script.parameters){
  if(!Object.hasOwn(values,parameter.name))continue;
  const value=values[parameter.name];
  if(parameter.type==='boolean'){if(value)args.push(parameter.flag);continue}
  args.push(parameter.flag);
  if(parameter.type==='file'){
   const option=parameter.options.find(item=>item.value===value),file=resolve(script.cwd,option.path);
   if(!within(script.cwd,file))fail(`Invalid local file option: ${parameter.name}`);
   let realFile;try{realFile=realpathSync(file)}catch{fail(`Configured file option is missing: ${parameter.name}`)}
   if(!within(script.cwd,realFile)||!statSync(realFile).isFile())fail(`Invalid configured file option: ${parameter.name}`);
   args.push(relative(script.cwd,realFile));
  }else args.push(value);
 }
 return {executable:script.executable,args,cwd:script.cwd,timeoutSeconds:script.timeoutSeconds};
}

function childEnvironment(parentEnv){
 const allowed=new Set(['path','systemroot','windir','pathext','comspec','home','userprofile','appdata','localappdata','programdata','temp','tmp','tmpdir','lang','lc_all','lc_ctype']);
 const result={};
 for(const [key,value]of Object.entries(parentEnv))if(allowed.has(key.toLowerCase()))result[key]=value;
 return result;
}

export function createScriptRunner({registry,spawnProcess=nodeSpawn,platform=process.platform,parentEnv=process.env,outputLimitBytes=MAX_OUTPUT_BYTES,onStarted=()=>{},onOutput=()=>{},onFinished=()=>{},killGraceMs=1500}={}){
 const jobs=new Map();
 const emit=fn=>{try{fn()}catch{}}
 function emitText(job,stream,text){
  let chunk='',bytes=0;
  for(const character of text){const size=Buffer.byteLength(character);if(bytes+size>4096){emit(()=>onOutput({jobId:job.id,sessionId:job.sessionId,stream,text:chunk}));chunk='';bytes=0}chunk+=character;bytes+=size}
  if(chunk)emit(()=>onOutput({jobId:job.id,sessionId:job.sessionId,stream,text:chunk}));
 }
 function complete(job,code,signal,error){
  if(job.completed)return;job.completed=true;clearTimeout(job.timeout);clearTimeout(job.killTimer);
  for(const decoder of Object.values(job.decoders)){const tail=decoder.end();if(tail)emitText(job,decoder.stream,tail)}
  jobs.delete(job.id);
  const state=job.stopReason==='timed_out'?'timed_out':job.stopReason==='output_limit'?'output_limit':job.stopReason?'cancelled':((error||code!==0)?'failed':'completed');
  emit(()=>onFinished({jobId:job.id,sessionId:job.sessionId,state,exitCode:Number.isInteger(code)?code:null,signal:typeof signal==='string'?signal:null,durationMs:Math.max(0,Date.now()-job.startedAt),...(job.stopReason?{reason:job.stopReason}:{}),...(error?{error:'Unable to start configured local script'}:{})}));
  job.resolveDone?.();
 }
 function stop(job,reason){
  if(job.completed||job.stopReason)return false;
  job.stopReason=reason;
  try{
   if(platform==='win32'){
    const killer=spawnProcess('taskkill.exe',['/PID',String(job.child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore',env:childEnvironment(parentEnv)});
    killer.on('error',()=>job.child.kill());
    job.killTimer=setTimeout(()=>{if(!job.completed)try{job.child.kill()}catch{}},killGraceMs);
   }else process.kill(-job.child.pid,'SIGTERM');
  }catch{try{job.child.kill()}catch{}}
  if(platform!=='win32')job.killTimer=setTimeout(()=>{if(!job.completed)try{process.kill(-job.child.pid,'SIGKILL')}catch{try{job.child.kill('SIGKILL')}catch{}}},killGraceMs);
  job.killTimer?.unref?.();
  return true;
 }
 async function start({jobId,sessionId,scriptId,params}){
  if(jobs.size)fail('A script is already running on this device');
  if(typeof jobId!=='string'||jobId.length>80||typeof sessionId!=='string'||sessionId.length>80)fail('Invalid script job identity');
  const script=registry.get(scriptId);if(!script)fail('Unknown local script id');
  const invocation=await buildScriptInvocation(script,params);
  const child=spawnProcess(invocation.executable,invocation.args,{cwd:invocation.cwd,shell:false,windowsHide:true,detached:platform!=='win32',stdio:['ignore','pipe','pipe'],env:childEnvironment(parentEnv)});
  let resolveDone;const donePromise=new Promise(resolveDonePromise=>{resolveDone=resolveDonePromise});
  const job={id:jobId,sessionId,child,startedAt:Date.now(),stopReason:null,completed:false,outputBytes:0,decoders:{stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')},timeout:null,killTimer:null,donePromise,resolveDone};
  job.decoders.stdout.stream='stdout';job.decoders.stderr.stream='stderr';jobs.set(jobId,job);
  for(const stream of ['stdout','stderr'])child[stream].on('data',chunk=>{
   if(job.completed||job.stopReason)return;
   const remaining=outputLimitBytes-job.outputBytes;
   if(remaining<=0){stop(job,'output_limit');return}
   const part=chunk.subarray(0,remaining);job.outputBytes+=part.length;const text=job.decoders[stream].write(part);
   if(text)emitText(job,stream,text);
   if(part.length<chunk.length||job.outputBytes>=outputLimitBytes)stop(job,'output_limit');
  });
  child.once('spawn',()=>{
   job.timeout=setTimeout(()=>stop(job,'timed_out'),invocation.timeoutSeconds*1000);job.timeout.unref?.();
   emit(()=>onStarted({jobId,sessionId,scriptId,label:script.label,startedAt:job.startedAt}));
  });
  child.once('error',error=>complete(job,null,null,error));
  child.once('close',(code,signal)=>complete(job,code,signal,null));
  return new Promise((resolveJob,rejectJob)=>{
   child.once('spawn',()=>resolveJob({jobId,state:'running'}));
   child.once('error',()=>rejectJob(new Error('Unable to start configured local script')));
  });
 }
 function cancel(jobId,reason='cancelled'){
  const job=jobs.get(jobId);if(!job)return false;
  return stop(job,reason);
 }
 function cancelSession(sessionId,reason='lease.revoked'){
  let cancelled=false;for(const job of jobs.values())if(job.sessionId===sessionId)cancelled=stop(job,reason)||cancelled;return cancelled;
 }
 function cancelAll(reason='agent.disconnected'){
  const running=[...jobs.values()];for(const job of running)stop(job,reason);return Promise.all(running.map(job=>job.donePromise));
 }
 return {start,cancel,cancelSession,cancelAll,get activeJobs(){return [...jobs.values()].map(job=>({jobId:job.id,sessionId:job.sessionId}))}};
}

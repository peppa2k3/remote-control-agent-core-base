import {readFileSync,statSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {spawn,execFileSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readWorkflowSettings,validateWorkflowSettings} from './workflow.js';
import {createWorkflowV2Client} from './workflow-v2.js';

const directory=fileURLToPath(new URL('../',import.meta.url));
const engineDirectory=resolve(directory,'workflow-engine');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const failure=code=>Object.assign(new Error(code),{code});
const engineKeys=['LOCAL_AGENT_DATA_DIR','LOCAL_AGENT_SCENARIOS_DIR','LOCAL_AGENT_POLICY_FILE','CHROME_PATH','CHROME_PROFILE','CHROME_USER_DATA_DIR','MONGODB_URI','MONGODB_DATABASE','MONGODB_DNS_SERVERS'];
export function filteredEngineEnv(values,settings,source=process.env){
  const env={};
  for(const key of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','COMSPEC','PATHEXT'])if(source[key])env[key]=source[key];
  for(const key of engineKeys)if(values[key]!==undefined)env[key]=values[key];
  return {...env,LOCAL_AGENT_ENV_DISABLED:'1',LOCAL_AGENT_MODE:'integrated',LOCAL_AGENT_API_TOKEN:settings.token,LOCAL_AGENT_PORT:new URL(settings.baseUrl).port||'80'};
}
export function assertPrivateEnv(file){
  if(process.platform!=='win32'){
    if(statSync(file).mode&0o077)throw failure('ENV_PERMISSIONS');
    return;
  }
  // SID comparison avoids localized account names. Output never contains the file or ACL.
  const script="$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:WORKFLOW_SUPERVISOR_ENV_PATH; $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach($r in $a.Access){if($r.AccessControlType -eq 'Allow'){ $sid=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($sid -notin @($me,'S-1-5-18','S-1-5-32-544') -and ([int]$r.FileSystemRights -band 851975)){exit 2}}}";
  try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:'ignore',env:{SystemRoot:process.env.SystemRoot,WORKFLOW_SUPERVISOR_ENV_PATH:file}});}catch{throw failure('ENV_PERMISSIONS');}
}
export function readSupervisorConfig(){
  let local={};try{local=parseEnv(readFileSync(join(directory,'.env'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw failure('CONFIG');}
  const env={...local,...process.env};
  return {mode:env.WORKFLOW_SUPERVISOR_MODE||'attach',envFile:resolve(directory,env.WORKFLOW_AGENT_ENV_FILE||'../.env')};
}
function occupied(baseUrl){return new Promise(resolve=>{const u=new URL(baseUrl),s=createConnection({host:'127.0.0.1',port:Number(u.port||80)});let done=false;const end=value=>{if(done)return;done=true;s.destroy();resolve(value);};s.once('connect',()=>end(true));s.once('error',()=>end(false));s.setTimeout(500,()=>end(true));});}

export function createWorkflowSupervisor({settings=readWorkflowSettings(),config=readSupervisorConfig(),client=createWorkflowV2Client({settings:()=>settings}),startupMs=15000,shutdownMs=18000,pollMs=3000,maxRestarts=3,backoffMs=1000,lockDirectory=join(process.env.LOCALAPPDATA||process.env.HOME||directory,'RemoteControlAgent','workflow-locks'),spawnImpl=spawn}={}){
  settings=Object.freeze({...settings});config=Object.freeze({...config});
  let state={state:'configured',reasonCode:'CONFIGURED',checkedAt:Date.now()},health=null,child=null,lock=null,closing=false,started=false,loop=null,restarts=0,proof=null,ownerId=null,stoppedProof=false;
  const listeners=new Set();
  const snapshot=()=>({...state,mode:config.mode,owned:!!child,restarts});
  function report(value,h=null){health=h;state={...value,checkedAt:Date.now()};for(const fn of listeners)fn(snapshot());}
  async function probe(timeout=2000){
    const h=await client.health({signal:AbortSignal.timeout(Math.max(1,Math.ceil(timeout)))});
    if(!/^0\.[234]\.\d+$/.test(h.engineVersion||'')||!Array.isArray(h.operations)||['profiles','scenarios','describe','runs','status','run','stop'].some(op=>!h.operations.includes(op))||!['ready','unconfigured','degraded','stopping'].includes(h.health?.state))throw failure('INCOMPATIBLE');
    if(config.mode==='managed'&&(!proof||h.lifecycleVersion!==1||proof.engineInstanceId!==h.engineInstanceId))throw failure('OWNERSHIP_UNVERIFIED');
    if(!closing)report(h.health,h);return h;
  }
  async function stopChild(){
    const owned=child;if(!owned)return true;
    stoppedProof=false;
    if(owned.connected)try{owned.send({type:'workflow:shutdown',supervisorId:ownerId});}catch{}
    const deadline=performance.now()+shutdownMs;
    while(owned.exitCode===null&&owned.signalCode===null&&performance.now()<deadline)await pause(25);
    const clean=stoppedProof&&owned.exitCode===0;
    if(owned.exitCode===null&&owned.signalCode===null){owned.kill();const end=performance.now()+2000;while(owned.exitCode===null&&owned.signalCode===null&&performance.now()<end)await pause(25);}
    if(owned.exitCode===null&&owned.signalCode===null)throw failure('STOP_TIMEOUT');
    if(child===owned)child=null;
    return clean;
  }
  async function run(){
    try{
      validateWorkflowSettings(settings);
      if(!['attach','managed'].includes(config.mode))throw failure('CONFIG');
      let env,values={};
      if(config.envFile){
        assertPrivateEnv(config.envFile);values=parseEnv(readFileSync(config.envFile,'utf8'));
        if(values.LOCAL_AGENT_API_TOKEN!==settings.token)throw failure('CONFIG');
      }
      if(config.mode==='managed'){
        if(!config.envFile)throw failure('CONFIG');
        env=filteredEngineEnv(values,settings);
        mkdirSync(lockDirectory,{recursive:true});
        const name=createHash('sha256').update(new URL(settings.baseUrl).origin).digest('hex');
        lock=new DatabaseSync(join(lockDirectory,name+'.sqlite'));
        try{lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');}catch{throw failure('CONTROLLER_BUSY');}
      }
      while(!closing){
        if(config.mode==='managed'){
          if(await occupied(settings.baseUrl))throw failure('PORT_IN_USE');
          if(closing)break;
          proof=null;const supervisorId=randomUUID();ownerId=supervisorId;
          child=spawnImpl(process.execPath,[join(engineDirectory,'index.js'),'--daemon'],{cwd:engineDirectory,env:{...env,LOCAL_AGENT_SUPERVISOR_ID:supervisorId},shell:false,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
          child.on('error',()=>{});
          const owned=child;
          child.on('message',m=>{if(child!==owned||ownerId!==supervisorId||m?.supervisorId!==supervisorId)return;if(m.type==='workflow:ready')proof=m;if(m.type==='workflow:stopped')stoppedProof=m.quiescent===true;});
        }
        report({state:'starting',reasonCode:'STARTING'});
        const deadline=performance.now()+startupMs;let ready=false,last='UNAVAILABLE';
        while(!closing&&performance.now()<deadline){
          try{await probe(Math.min(2000,deadline-performance.now()));ready=true;break;}catch(e){last=['INCOMPATIBLE','OWNERSHIP_UNVERIFIED'].includes(e.code)?e.code:e.status===401||e.status===403?'AUTH_FAILED':'UNAVAILABLE';}
          if(config.mode==='managed'&&(child.exitCode!==null||child.signalCode!==null))break;
          await pause(Math.min(100,pollMs));
        }
        if(closing)break;
        if(ready){
          let unhealthySince=null;
          while(!closing){
            await pause(pollMs);if(closing)break;
            if(config.mode==='managed'&&(child.exitCode!==null||child.signalCode!==null)){last='ENGINE_EXITED';break;}
            try{await probe();unhealthySince=null;}catch(e){unhealthySince??=performance.now();last=e.code==='INCOMPATIBLE'?'INCOMPATIBLE':e.status===401||e.status===403?'AUTH_FAILED':'UNAVAILABLE';report({state:'degraded',reasonCode:last});if(config.mode==='managed'&&performance.now()-unhealthySince>=startupMs)break;}
          }
        }
        if(closing)break;
        report({state:'failed',reasonCode:ready?last:last==='UNAVAILABLE'?'START_TIMEOUT':last});
        if(config.mode==='attach'){await pause(pollMs);continue;}
        await stopChild();
        if(restarts>=maxRestarts){report({state:'failed',reasonCode:'RESTART_LIMIT'});break;}
        restarts++;await pause(Math.min(backoffMs*2**(restarts-1),10000));
      }
    }catch(e){report({state:'failed',reasonCode:['ENV_PERMISSIONS','CONTROLLER_BUSY','PORT_IN_USE','CONFIG','DISABLED','STOP_TIMEOUT'].includes(e.code)?e.code:'CONFIG'});}
  }
  return {snapshot,getHealth:()=>health,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},start(){if(!started){started=true;loop=run();}return loop;},async close(){if(closing)return;closing=true;report({state:'stopping',reasonCode:'STOPPING'});let clean=false;try{clean=await stopChild();}catch{}await loop;if(!child)try{lock?.close();}catch{}report({state:clean?'unconfigured':'degraded',reasonCode:clean?'STOPPED':'STOP_TIMEOUT'});return clean;}};
}

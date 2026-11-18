const {randomUUID}=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const path=require('node:path');
const {fail,exact}=require('../../workflow/remote-policy');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const webStep=s=>!['wait','downloadVideo','openFolder'].includes(s.action);
function assertInteractiveSession(){
  if(process.platform!=='win32')return;
  try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop';if((Get-Process -Id ([int]$env:WF_ENGINE_PID)).SessionId -eq 0){exit 2}"],{windowsHide:true,stdio:'ignore',env:{SystemRoot:process.env.SystemRoot,WF_ENGINE_PID:String(process.pid)}});}catch{fail('INTERACTIVE_SESSION_REQUIRED',409);}
}

function createProfileBridge({profiles,workflows,chromePath,userDataDir,port,allowed,guiBusy=()=>false,interactive=assertInteractiveSession,launch=spawn,now=()=>performance.now(),deadlineMs=30000,ttlMs=10000}){
  const clients=new Map(),opens=new Map();
  function known(profile){if(!/^(Default|Profile \d+)$/.test(profile||'')||!profiles().some(p=>p.directory===profile)||!allowed().some(p=>p.id===profile))fail('POLICY_DENIED');}
  function bind(body){
    if(!exact(body,['profile','clientId','workerId','readinessVersion','settlementVersion'])||!uuid(body.clientId)||!uuid(body.workerId)||body.readinessVersion!==1||body.settlementVersion!==1)fail('EXTENSION_UPGRADE_REQUIRED',409);
    known(body.profile);const old=clients.get(body.profile);
    if(old&&(old.clientId!==body.clientId||old.workerId!==body.workerId)&&(now()-(old.seen??old.boundAt)<ttlMs||workflows.profileBusy(body.profile)))fail('PROFILE_BUSY',409);
    if(old?.clientId===body.clientId&&old.workerId===body.workerId){return {connectionId:old.connectionId};}
    const connectionId=randomUUID();clients.set(body.profile,{clientId:body.clientId,workerId:body.workerId,connectionId,boundAt:now(),seen:null});return {connectionId};
  }
  function heartbeat(body,receipt=false){
    if(!receipt)known(body.profile);const c=clients.get(body.profile);
    if(!c||c.clientId!==body.clientId||c.workerId!==body.workerId||c.connectionId!==body.connectionId)fail('EXTENSION_BIND_REQUIRED',409);
    if(!receipt)c.seen=now();return c;
  }
  function status(profile){
    known(profile);const c=clients.get(profile),o=opens.get(profile),fresh=c&&c.seen!==null&&now()-c.seen<ttlMs;
    if(workflows.profileBusy(profile))return {state:'busy',reasonCode:'PROFILE_BUSY'};
    if(fresh)return {state:'ready',reasonCode:'EXTENSION_READY'};
    if(o?.error)return {state:'failed',reasonCode:o.error};
    if(o&&now()<o.deadline)return {state:'starting',reasonCode:'WAITING_EXTENSION'};
    return {state:'missing-extension',reasonCode:o?'EXTENSION_DEADLINE':'EXTENSION_MISSING'};
  }
  function requireReady(profile,clientId){
    known(profile);const c=clients.get(profile);
    if(!c||c.seen===null||now()-c.seen>=ttlMs||clientId&&clientId!==c.clientId)fail('EXTENSION_NOT_READY',409);
    return c.clientId;
  }
  async function open(profile,check=()=>{}){
    known(profile);if(!allowed().find(p=>p.id===profile)?.allowOpen)fail('POLICY_DENIED');
    check();const s=status(profile);if(s.state==='ready'||s.state==='starting')return {profile,...s};
    if(workflows.browserBusy()||guiBusy())fail('PROFILE_BUSY',409);
    if(!path.isAbsolute(chromePath)||!path.isAbsolute(userDataDir))fail('CHROME_CONFIG',503);
    interactive();check();
    // No extension install flags, startup URL, path or environment comes from HTTP.
    const env={};for(const k of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','APPDATA'])if(process.env[k])env[k]=process.env[k];
    const o={deadline:now()+deadlineMs};opens.set(profile,o);
    try{await new Promise((resolve,reject)=>{
      const child=launch(chromePath,[`--user-data-dir=${userDataDir}`,`--profile-directory=${profile}`,`http://127.0.0.1:${port}`],{cwd:path.dirname(chromePath),shell:false,windowsHide:true,detached:true,stdio:'ignore',env});
      child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
    });check();}catch(e){o.error=e.code==='LEASE_REQUIRED'?'LEASE_REQUIRED':'CHROME_LAUNCH_FAILED';fail(o.error,409);}
    return {profile,...status(profile)};
  }
  return {bind,heartbeat,status,requireReady,open,webStep,client:profile=>clients.get(profile)?.clientId};
}
module.exports={createProfileBridge,webStep,assertInteractiveSession};

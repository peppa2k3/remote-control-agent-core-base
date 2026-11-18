import {randomUUID} from 'node:crypto';
import {readWorkflowSettings,validateWorkflowSettings} from './workflow.js';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status,code});};
const fields={profiles:[],scenarios:[],describe:['scenario'],runs:['profile'],status:['runId'],run:['scenario','profile','variables','timeoutMs'],stop:['runId'],openProfile:['profile']};
export function createWorkflowV2Client({settings=readWorkflowSettings,fetchImpl=fetch}={}){
  async function http(route,method='GET',body,headers={},signal){
    const config=validateWorkflowSettings(settings());
    try{
      const response=await fetchImpl(config.baseUrl+'/api/v2'+route,{method,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${config.token}`,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
      let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>500000)fail('RESPONSE_TOO_LARGE',502);chunks.push(chunk);}
      const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!response.ok)fail(typeof result.error==='string'&&/^[A-Z_]{1,64}$/.test(result.error)?result.error:'WORKFLOW_REJECTED',response.status);
      return result;
    }catch(error){if(error.status)throw error;fail('UNAVAILABLE',503);}
  }
  return {http,async health({signal}={}){const h=await http('/health','GET',undefined,{},signal);if(h.protocolVersion!==2||h.mode!=='integrated'||!uuid(h.engineInstanceId))fail('INCOMPATIBLE');return h;}};
}

export function bindWorkflowV2Socket({socket,getSession,client=createWorkflowV2Client(),supervisor,journal=null,deviceId=null,syncIntervalMs=2000}){
  let pairedId=deviceId;
  const executing=new Set();
  const agentInstanceId=randomUUID(),pending=new Set();let engine=null,grant=null,timer=null,control=Promise.resolve(),closed=false,epoch=0;
  const alive=id=>!closed&&socket.connected&&getSession()?.sessionId===id&&Date.now()<getSession().expires;
  function abort(){epoch++;clearTimeout(timer);for(const controller of pending)controller.abort();}
  function queue(fn){const task=control.then(fn);control=task.catch(()=>{});return task;}
  async function publish(){
    try{const next=supervisor?supervisor.getHealth():await client.health();if(!next)throw Error('UNAVAILABLE');if(engine?.engineInstanceId!==next.engineInstanceId||next.health?.state!=='ready')lost();engine=next;if(!closed&&socket.connected)socket.emit('workflow:v2:capabilities',{protocolVersion:2,agentInstanceId,engineInstanceId:engine.engineInstanceId,engineVersion:engine.engineVersion,mode:'integrated',operations:Object.keys(fields).filter(op=>engine.operations.includes(op)),policyRevision:engine.policyRevision,...(journal&&engine.jobsVersion===1?{jobsVersion:1}:{}),health:{...engine.health,...(supervisor?{state:supervisor.snapshot().state,reasonCode:supervisor.snapshot().reasonCode}:{} )},...(supervisor?{supervisor:{mode:supervisor.snapshot().mode,owned:supervisor.snapshot().owned,restarts:supervisor.snapshot().restarts}}:{})});}
    catch{if(engine)lost();engine=null;if(!closed&&socket.connected)socket.emit('workflow:v2:capabilities',{protocolVersion:2,agentInstanceId,engineInstanceId:null,engineVersion:'unknown',mode:'integrated',operations:[],policyRevision:null,health:{state:supervisor?.snapshot().state||'unconfigured',reasonCode:supervisor?.snapshot().reasonCode||'UNAVAILABLE',checkedAt:Date.now()},...(supervisor?{supervisor:{mode:supervisor.snapshot().mode,owned:supervisor.snapshot().owned,restarts:supervisor.snapshot().restarts}}:{})});}
  }
  async function revoke(p){const h=await client.health();engine=h;return client.http(`/grants/${p.grantId}/revoke`,'POST',{engineInstanceId:h.engineInstanceId,fence:p.fence,reason:p.reason||'offline'});}
  const onGrant=(p,ack)=>{
    const captured=epoch;
    queue(async()=>{
      if(supervisor&&supervisor.snapshot().state!=='ready'||captured!==epoch||!alive(p?.sessionId)||p?.protocolVersion!==2||p.agentInstanceId!==agentInstanceId||!uuid(p.grantId)||p.engineInstanceId!==engine?.engineInstanceId||p.expiresAt>getSession().expires||p.issuedAt>Date.now()+2000||Date.now()-p.issuedAt>10000)fail('LEASE_REQUIRED',403);
      if(grant&&(grant.grantId!==p.grantId||grant.fence!==p.fence))fail('BUSY');
      if(pairedId&&pairedId!==p.deviceId)fail('DEVICE_MISMATCH');pairedId=p.deviceId;
      grant=p;const expiresAt=Math.min(p.expiresAt-2000,getSession().expires);if(expiresAt<=Date.now())fail('LEASE_REQUIRED',403);
      const result=await client.http(`/grants/${p.grantId}`,'PUT',{...p,issuedAt:Date.now(),expiresAt});
      if(captured!==epoch||!alive(p.sessionId)){await revoke(p);fail('LEASE_REQUIRED',403);}
      clearTimeout(timer);timer=setTimeout(()=>{abort();const old=grant;grant=null;if(old)void queue(()=>revoke({...old,reason:'expired'})).catch(()=>{});},Math.max(1,expiresAt-Date.now()));timer.unref?.();ack?.({ok:true,...result});
    }).catch(error=>ack?.({ok:false,status:error.status||503,code:error.code||'UNAVAILABLE'}));
  };
  const onRevoke=(p,ack)=>{
    if(!p||!uuid(p.grantId)||!Number.isSafeInteger(p.fence))return ack?.({ok:false});
    abort();if(grant?.grantId===p.grantId)grant=null;
    queue(()=>revoke(p)).then(result=>ack?.({ok:true,...result})).catch(()=>ack?.({ok:false,code:'UNAVAILABLE'}));
  };
  let syncing=false,cursor='',backoff=0,retryAt=0;
  async function sync(){
    if(!journal||syncing||closed||Date.now()<retryAt)return;syncing=true;
    try{
      const h=await client.health();if(h.jobsVersion!==1)return;
      const page=await client.http('/jobs'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
      if(page.version!==1||page.engineInstanceId!==h.engineInstanceId||!Array.isArray(page.jobs)||page.jobs.length>20)throw Error('INVALID_SYNC');
      for(const r of page.jobs)journal.update(r);cursor=page.cursor||'';
      for(const j of journal.unconfirmed(pairedId))if(!executing.has(j.jobId)){
        try{const found=await client.http('/jobs/'+j.jobId);journal.update(found.job);}catch(e){if(e.status!==404)throw e;
          const body={deviceId:j.deviceId,userId:j.userId,requestId:j.requestId,operation:j.operation,fingerprint:j.fingerprint,grantId:j.grantId,fence:j.fence,originEngineInstanceId:j.originEngineInstanceId,runId:null};
          const stopped=await client.http('/jobs/'+j.jobId+'/cancel','POST',body);journal.update(stopped.job);
        }
      }
      if(socket.connected){for(const p of journal.pending(pairedId)){
        const ack=await socket.timeout(5000).emitWithAck('workflow:v2:report',{protocolVersion:2,agentInstanceId,engineInstanceId:h.engineInstanceId,observedAt:Date.now(),report:p.report});
        if(ack?.ok&&ack.jobId===p.jobId&&ack.seq===p.seq){await client.http('/jobs/'+p.jobId+'/ack','POST',{seq:p.engineSeq});journal.ack(p.jobId,p.seq);}
      }}backoff=0;retryAt=0;journal.prune();
    }catch(e){if(e.code==='INVALID_CURSOR')cursor='';backoff=Math.min(backoff?backoff*2:1000,30000);retryAt=Date.now()+backoff;}finally{syncing=false;}
  }
  const syncTimer=journal?setInterval(()=>void sync(),syncIntervalMs):null;syncTimer?.unref?.();
  const onCancel=async(p,ack)=>{try{if(!journal||!uuid(p?.jobId)||p.body?.deviceId!==pairedId)throw Error('STALE_CANCEL');journal.cancelIntent(p.jobId,p.body);const old=journal.get(p.jobId);if(old.deviceId!==p.body?.deviceId||old.grantId!==p.body.grantId||old.fence!==p.body.fence)throw Error('STALE_CANCEL');const r=await client.http('/jobs/'+p.jobId+'/cancel','POST',p.body);journal.update(r.job);ack?.({ok:true});void sync();}catch{ack?.({ok:false,code:'UNAVAILABLE'});}};
  socket.on('workflow:v2:cancel-job',onCancel);
  const onRequest=async(p,ack)=>{
    if(typeof ack!=='function')return;let controller;
    try{
      if(supervisor&&supervisor.snapshot().state!=='ready'||!p||p.protocolVersion!==2||p.agentInstanceId!==agentInstanceId||p.engineInstanceId!==engine?.engineInstanceId||p.grantId!==grant?.grantId||p.fence!==grant?.fence||!alive(p.sessionId)||p.sessionId!==grant.sessionId||Date.now()>=p.deadline)fail('LEASE_REQUIRED',403);
      if(!engine.operations.includes(p.operation))fail('INCOMPATIBLE');const allowed=fields[p.operation];if(!allowed||!p.params||typeof p.params!=='object'||Array.isArray(p.params)||Object.keys(p.params).some(k=>!allowed.includes(k))||Buffer.byteLength(JSON.stringify(p.params))>12000)fail('INVALID_REQUEST',400);
      if(pending.size>=4)fail('BUSY',429);controller=new AbortController();pending.add(controller);const captured=epoch;
      const headers={'X-Workflow-Grant':p.grantId,'X-Workflow-Fence':String(p.fence),'X-Workflow-Engine-Instance':p.engineInstanceId};
      let route,method='GET',body;
      if(['profiles','scenarios','runs'].includes(p.operation))route='/'+p.operation+(p.operation==='runs'&&p.params.profile?'?profile='+encodeURIComponent(p.params.profile):'');
      else if(p.operation==='describe'){if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(p.params.scenario))fail('INVALID_REQUEST',400);route='/scenarios/'+p.params.scenario;}
      else if(p.operation==='openProfile'){if(!/^(Default|Profile \d+)$/.test(p.params.profile||''))fail('INVALID_REQUEST',400);route='/profiles/open';method='POST';body={profile:p.params.profile};}
      else if(p.operation==='run'){route='/runs';method='POST';body={...p.params,jobId:p.jobId};headers['Idempotency-Key']=p.requestId;}
      else {if(!uuid(p.params.runId))fail('INVALID_REQUEST',400);route='/runs/'+p.params.runId+(p.operation==='stop'?'/stop':'');if(p.operation==='stop'){method='POST';body={jobId:p.jobId};headers['Idempotency-Key']=p.requestId;}}
      let data;
      if(journal&&engine.jobsVersion===1&&['run','stop','openProfile'].includes(p.operation)){
        executing.add(p.jobId);const entry=journal.accept(p,grant);
        const result=entry.old?await client.http('/jobs/'+p.jobId):await client.http('/jobs','POST',{jobId:p.jobId,requestId:p.requestId,operation:p.operation,params:p.params},headers,controller.signal);
        journal.update(result.job);data=result.data||result.job;
      }else data=await client.http(route,method,body,headers,controller.signal);
      void sync();
      if(captured!==epoch||!alive(p.sessionId)||controller.signal.aborted)fail('LEASE_REQUIRED',403);
      ack({ok:true,requestId:p.requestId,data});
    }catch(error){ack({ok:false,requestId:p?.requestId,status:error.status||503,code:error.code||'UNAVAILABLE'});}finally{executing.delete(p?.jobId);if(controller)pending.delete(controller);}
  };
  function lost(){abort();const old=grant;grant=null;if(old)void queue(()=>revoke({...old,reason:'offline'})).catch(()=>{});}
  const revoked=p=>{if(grant?.sessionId===p?.sessionId)lost();};
  const active=p=>{if(grant&&grant.sessionId!==p?.sessionId)lost();};
  socket.on('connect',publish);socket.on('connect',sync);socket.on('workflow:v2:grant',onGrant);socket.on('workflow:v2:revoke',onRevoke);socket.on('workflow:v2:dispatch',onRequest);socket.on('disconnect',lost);socket.on('session:revoked',revoked);socket.on('session:active',active);
  const unsubscribe=supervisor?.subscribe(()=>{if(supervisor.snapshot().state!=='ready')lost();void publish();});
  return {publish,sync,agentInstanceId,async close(){clearInterval(syncTimer);socket.off('connect',sync);socket.off('workflow:v2:cancel-job',onCancel);unsubscribe?.();closed=true;lost();await control;socket.off('connect',publish);socket.off('workflow:v2:grant',onGrant);socket.off('workflow:v2:revoke',onRevoke);socket.off('workflow:v2:dispatch',onRequest);socket.off('disconnect',lost);socket.off('session:revoked',revoked);socket.off('session:active',active);}};
}

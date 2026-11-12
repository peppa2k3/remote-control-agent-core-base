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

export function bindWorkflowV2Socket({socket,getSession,client=createWorkflowV2Client(),supervisor}){
  const agentInstanceId=randomUUID(),pending=new Set();let engine=null,grant=null,timer=null,control=Promise.resolve(),closed=false,epoch=0;
  const alive=id=>!closed&&socket.connected&&getSession()?.sessionId===id&&Date.now()<getSession().expires;
  function abort(){epoch++;clearTimeout(timer);for(const controller of pending)controller.abort();}
  function queue(fn){const task=control.then(fn);control=task.catch(()=>{});return task;}
  async function publish(){
    try{const next=supervisor?supervisor.getHealth():await client.health();if(!next)throw Error('UNAVAILABLE');if(engine?.engineInstanceId!==next.engineInstanceId||next.health?.state!=='ready')lost();engine=next;if(!closed&&socket.connected)socket.emit('workflow:v2:capabilities',{protocolVersion:2,agentInstanceId,engineInstanceId:engine.engineInstanceId,engineVersion:engine.engineVersion,mode:'integrated',operations:Object.keys(fields).filter(op=>engine.operations.includes(op)),policyRevision:engine.policyRevision,health:{...engine.health,...(supervisor?{state:supervisor.snapshot().state,reasonCode:supervisor.snapshot().reasonCode}:{} )},...(supervisor?{supervisor:{mode:supervisor.snapshot().mode,owned:supervisor.snapshot().owned,restarts:supervisor.snapshot().restarts}}:{})});}
    catch{if(engine)lost();engine=null;if(!closed&&socket.connected)socket.emit('workflow:v2:capabilities',{protocolVersion:2,agentInstanceId,engineInstanceId:null,engineVersion:'unknown',mode:'integrated',operations:[],policyRevision:null,health:{state:supervisor?.snapshot().state||'unconfigured',reasonCode:supervisor?.snapshot().reasonCode||'UNAVAILABLE',checkedAt:Date.now()},...(supervisor?{supervisor:{mode:supervisor.snapshot().mode,owned:supervisor.snapshot().owned,restarts:supervisor.snapshot().restarts}}:{})});}
  }
  async function revoke(p){const h=await client.health();engine=h;return client.http(`/grants/${p.grantId}/revoke`,'POST',{engineInstanceId:h.engineInstanceId,fence:p.fence,reason:p.reason||'offline'});}
  const onGrant=(p,ack)=>{
    const captured=epoch;
    queue(async()=>{
      if(supervisor&&supervisor.snapshot().state!=='ready'||captured!==epoch||!alive(p?.sessionId)||p?.protocolVersion!==2||p.agentInstanceId!==agentInstanceId||!uuid(p.grantId)||p.engineInstanceId!==engine?.engineInstanceId||p.expiresAt>getSession().expires||p.issuedAt>Date.now()+2000||Date.now()-p.issuedAt>10000)fail('LEASE_REQUIRED',403);
      if(grant&&(grant.grantId!==p.grantId||grant.fence!==p.fence))fail('BUSY');
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
      const data=await client.http(route,method,body,headers,controller.signal);
      if(captured!==epoch||!alive(p.sessionId)||controller.signal.aborted)fail('LEASE_REQUIRED',403);
      ack({ok:true,requestId:p.requestId,data});
    }catch(error){ack({ok:false,requestId:p?.requestId,status:error.status||503,code:error.code||'UNAVAILABLE'});}finally{if(controller)pending.delete(controller);}
  };
  function lost(){abort();const old=grant;grant=null;if(old)void queue(()=>revoke({...old,reason:'offline'})).catch(()=>{});}
  const revoked=p=>{if(grant?.sessionId===p?.sessionId)lost();};
  const active=p=>{if(grant&&grant.sessionId!==p?.sessionId)lost();};
  socket.on('connect',publish);socket.on('workflow:v2:grant',onGrant);socket.on('workflow:v2:revoke',onRevoke);socket.on('workflow:v2:dispatch',onRequest);socket.on('disconnect',lost);socket.on('session:revoked',revoked);socket.on('session:active',active);
  const unsubscribe=supervisor?.subscribe(()=>{if(supervisor.snapshot().state!=='ready')lost();void publish();});
  return {publish,agentInstanceId,async close(){unsubscribe?.();closed=true;lost();await control;socket.off('connect',publish);socket.off('workflow:v2:grant',onGrant);socket.off('workflow:v2:revoke',onRevoke);socket.off('workflow:v2:dispatch',onRequest);socket.off('disconnect',lost);socket.off('session:revoked',revoked);socket.off('session:active',active);}};
}

import {randomUUID,createHash} from 'node:crypto';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};
const fields={profiles:[],scenarios:[],describe:['scenario'],runs:['profile'],status:['runId'],run:['scenario','profile','variables','timeoutMs'],stop:['runId'],openProfile:['profile']};
export function createWorkflowGrantRelay({agents,db,authenticate,broadcast}){
  db.run('CREATE TABLE IF NOT EXISTS workflow_control(deviceId TEXT PRIMARY KEY REFERENCES devices(id),fence INTEGER NOT NULL,grantJson TEXT,barrier INTEGER NOT NULL DEFAULT 0)');
  const capabilities=new Map(),provisioning=new Map(),draining=new Set(),limits=new Map();
  let closed=false;
  const read=d=>{if(closed)return null;const r=db.one('SELECT * FROM workflow_control WHERE deviceId=?',d);return r?{...r,grant:r.grantJson?JSON.parse(r.grantJson):null}:null;};
  const blocked=d=>read(d)?.barrier===1;
  async function drain(d,reason='offline'){
    const row=read(d),agent=agents.get(d),cap=capabilities.get(d);
    if(!row?.barrier||!row.grant||!agent||!cap||draining.has(d))return;
    draining.add(d);
    try{
      const response=await agent.socket.timeout(12000).emitWithAck('workflow:v2:revoke',{protocolVersion:2,grantId:row.grant.grantId,fence:row.fence,reason});
      if(closed)return;
      const current=read(d);
      if(agents.get(d)===agent&&current?.grant?.grantId===row.grant.grantId&&response?.ok===true&&response.grantId===row.grant.grantId&&response.fence===row.fence&&response.state==='revoked'&&response.quiescent===true){db.run('UPDATE workflow_control SET grantJson=NULL,barrier=0 WHERE deviceId=? AND fence=?',d,row.fence);db.audit(null,d,'workflow.quiescent');broadcast();}
    }catch{}finally{draining.delete(d);}
  }
  function revoke(d,reason='offline'){
    const row=read(d);if(!row?.grant)return;
    const grant={...row.grant,revoked:true};db.run('UPDATE workflow_control SET grantJson=?,barrier=1 WHERE deviceId=?',JSON.stringify(grant),d);
    void drain(d,reason);
  }
  function authorized(socket,userId,deviceId,sessionId,expected){
    if(closed)fail('UNAVAILABLE',503);
    if(!socket.connected||authenticate(socket.request)!==userId)fail('UNAUTHORIZED',401);
    if(db.role(deviceId,userId)==='viewer')fail('LEASE_REQUIRED',403);
    const lease=db.lease(deviceId),agent=agents.get(deviceId);
    if(!agent||agent!==expected&&expected||Date.now()-agent.seen>=25000)fail('OFFLINE');
    if(!lease||lease.state!=='active'||lease.id!==sessionId||lease.browserId!==socket.id||lease.userId!==userId)fail('LEASE_REQUIRED',403);
    return {lease,agent};
  }
  async function issue(d,lease,agent){
    if(provisioning.has(d))return provisioning.get(d);
    const task=(async()=>{
      const cap=capabilities.get(d);if(!uuid(cap?.engineInstanceId)||cap.health?.state!=='ready'||Date.now()-cap.receivedAt>15000)fail('UNAVAILABLE',503);
      let row=read(d),grant=row?.grant;
      if(grant&&(grant.revoked||grant.sessionId!==lease.id||grant.agentInstanceId!==cap.agentInstanceId||grant.engineInstanceId!==cap.engineInstanceId)){revoke(d);fail('BUSY');}
      if(!grant){
        const fence=(row?.fence||0)+1;if(!Number.isSafeInteger(fence))fail('FENCE_EXHAUSTED');
        grant={protocolVersion:2,grantId:randomUUID(),sessionId:lease.id,deviceId:d,userId:lease.userId,browserId:lease.browserId,agentInstanceId:cap.agentInstanceId,engineInstanceId:cap.engineInstanceId,fence,seq:0,issuedAt:Date.now(),expiresAt:lease.expires};
      }
      const {revoked,...wire}=grant;
      wire.seq++;wire.issuedAt=Date.now();wire.expiresAt=lease.expires;
      db.run('INSERT INTO workflow_control(deviceId,fence,grantJson,barrier) VALUES(?,?,?,1) ON CONFLICT(deviceId) DO UPDATE SET fence=excluded.fence,grantJson=excluded.grantJson,barrier=1',d,wire.fence,JSON.stringify(wire));
      const response=await agent.socket.timeout(12000).emitWithAck('workflow:v2:grant',wire);
      if(closed)fail('UNAVAILABLE',503);
      const current=read(d),live=db.lease(d);
      if(!live||live.id!==lease.id||agents.get(d)!==agent||current?.grant?.revoked||current?.grant?.grantId!==wire.grantId){revoke(d);fail('LEASE_REQUIRED',403);}
      if(response?.ok!==true||response.grantId!==wire.grantId||response.fence!==wire.fence||response.seq!==wire.seq||response.state!=='active'){revoke(d);fail('GRANT_REJECTED');}
      return wire;
    })();
    provisioning.set(d,task);try{return await task;}catch(error){revoke(d);throw error;}finally{provisioning.delete(d);}
  }
  async function request(socket,userId,p,ack){
    let limit=limits.get(socket.id);if(!limit||Date.now()-limit.at>10000){limit={at:Date.now(),count:0,pending:0};limits.set(socket.id,limit);}let reserved=false;
    try{
      if(++limit.count>40||limit.pending>=4)fail('RATE_LIMIT',429);
      if(!object(p)||Object.keys(p).some(k=>!['deviceId','sessionId','operation','params','requestId'].includes(k)))fail('INVALID_REQUEST',400);
      const {deviceId:d,sessionId,operation,params={},requestId}=p;
      if(!uuid(d)||!uuid(sessionId)||!Object.hasOwn(fields,operation)||!object(params)||Object.keys(params).some(k=>!fields[operation].includes(k))||Buffer.byteLength(JSON.stringify(params))>12000)fail('INVALID_REQUEST',400);
      if(requestId!==undefined&&(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)))fail('INVALID_REQUEST',400);
      if(operation==='run'&&!requestId)fail('INVALID_REQUEST',400);
      const {lease,agent}=authorized(socket,userId,d,sessionId);
      limit.pending++;reserved=true;
      const grant=await issue(d,lease,agent);authorized(socket,userId,d,sessionId,agent);
      if(read(d)?.grant?.revoked)fail('LEASE_REQUIRED',403);
      const controlId=requestId||randomUUID(),bytes=createHash('sha256').update(JSON.stringify([d,userId,operation,controlId])).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex'),jobId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      const response=await agent.socket.timeout(12000).emitWithAck('workflow:v2:dispatch',{protocolVersion:2,agentInstanceId:grant.agentInstanceId,engineInstanceId:grant.engineInstanceId,grantId:grant.grantId,fence:grant.fence,sessionId,operation,params,requestId:controlId,jobId,deadline:Math.min(lease.expires,Date.now()+12000)});
      authorized(socket,userId,d,sessionId,agent);
      if(read(d)?.grant?.revoked)fail('LEASE_REQUIRED',403);
      if(!object(response)||response.requestId!==controlId||typeof response.ok!=='boolean'||Buffer.byteLength(JSON.stringify(response))>512000)fail('INVALID_RESPONSE',502);
      if(!response.ok)fail(typeof response.code==='string'&&/^[A-Z_]{1,64}$/.test(response.code)?response.code:'WORKFLOW_REJECTED',Number.isInteger(response.status)&&response.status>=400&&response.status<=599?response.status:502);
      if(['run','stop'].includes(operation))db.audit(userId,d,'workflow.'+operation);
      ack({ok:true,requestId,data:response.data});
    }catch(error){const code=error.status?error.message:'UNAVAILABLE';const messages={POLICY_DENIED:'Kịch bản, profile hoặc biến chưa được cho phép tại máy local',EXTENSION_UPGRADE_REQUIRED:'Cập nhật extension lên 4.3.0 và tải lại trang Chrome trước khi chạy',BUSY:'Tác vụ trước chưa xác nhận dừng xong',UNAVAILABLE:'Không nhận được phản hồi; kiểm tra lịch sử trước khi chạy lại'};ack({ok:false,status:error.status||504,code,error:messages[code]||code});}finally{if(reserved)limit.pending--;}
  }
  function bindAgent(socket,d){
    socket.on('workflow:v2:capabilities',(p,ack)=>{
      if(agents.get(d)?.socket!==socket)return;
      try{
        if(!object(p)||Object.keys(p).some(k=>!['protocolVersion','agentInstanceId','engineInstanceId','engineVersion','mode','operations','policyRevision','health','supervisor'].includes(k))||p.protocolVersion!==2||!uuid(p.agentInstanceId)||p.engineInstanceId!==null&&!uuid(p.engineInstanceId)||p.mode!=='integrated'||!Array.isArray(p.operations)||p.operations.length>8||p.operations.some(v=>!Object.hasOwn(fields,v))||!object(p.health)||!['configured','starting','ready','unconfigured','failed','degraded','stopping'].includes(p.health.state))fail('INVALID_CAPABILITIES',400);
        const codes=['CONFIGURED','STARTING','READY','POLICY_DENIED','UNKNOWN_OUTCOME','STOPPING','STOPPED','STOP_TIMEOUT','UNAVAILABLE','AUTH_FAILED','INCOMPATIBLE','OWNERSHIP_UNVERIFIED','ENGINE_EXITED','START_TIMEOUT','RESTART_LIMIT','ENV_PERMISSIONS','CONTROLLER_BUSY','PORT_IN_USE','CONFIG','DISABLED'];
        const previous=capabilities.get(d),receivedAt=Date.now();
        const safe={protocolVersion:2,agentInstanceId:p.agentInstanceId,engineInstanceId:p.engineInstanceId,mode:'integrated',engineVersion:/^\d+\.\d+\.\d+$/.test(p.engineVersion||'')?p.engineVersion:'unknown',operations:[...p.operations],policyRevision:Number.isSafeInteger(p.policyRevision)&&p.policyRevision>0?p.policyRevision:null,receivedAt,health:{state:p.health.state,reasonCode:codes.includes(p.health.reasonCode)?p.health.reasonCode:'UNAVAILABLE',checkedAt:receivedAt},supervisor:p.supervisor&&['attach','managed'].includes(p.supervisor.mode)?{mode:p.supervisor.mode,owned:p.supervisor.owned===true,restarts:Number.isSafeInteger(p.supervisor.restarts)&&p.supervisor.restarts>=0&&p.supervisor.restarts<=3?p.supervisor.restarts:0}:null};
        capabilities.set(d,safe);ack?.({ok:true});const row=read(d);if(row?.grant&&(safe.health.state!=='ready'||previous?.agentInstanceId!==safe.agentInstanceId||previous?.engineInstanceId!==safe.engineInstanceId||previous?.policyRevision!==safe.policyRevision))revoke(d);broadcast();
      }catch(error){ack?.({ok:false,error:error.message});}
    });
    socket.on('disconnect',()=>{if(agents.get(d)?.socket===socket||!agents.has(d)){capabilities.delete(d);revoke(d);}});
  }
  function tick(){if(closed)return;for(const [d,cap] of capabilities)if(Date.now()-cap.receivedAt>15000&&read(d)?.grant&&!read(d).grant.revoked)revoke(d);for(const row of db.all('SELECT deviceId FROM workflow_control WHERE barrier=1')){const g=read(row.deviceId)?.grant,l=db.lease(row.deviceId);if(g&&(g.revoked||!l||l.id!==g.sessionId))revoke(row.deviceId);}}
  return {bindAgent,request,blocked,revoke,tick,close(){if(closed)return;for(const row of db.all('SELECT deviceId FROM workflow_control WHERE barrier=1'))revoke(row.deviceId,'shutdown');closed=true;},handles:d=>capabilities.has(d),health(d){const c=capabilities.get(d);if(!c)return null;return {...c.health,...(Date.now()-c.receivedAt>15000?{state:'degraded',reasonCode:'STALE'}:{}),engineVersion:c.engineVersion,engineInstanceId:c.engineInstanceId,supervisor:c.supervisor,operations:c.operations};},supported:d=>uuid(capabilities.get(d)?.engineInstanceId)&&capabilities.get(d)?.health?.state==='ready'&&Date.now()-capabilities.get(d).receivedAt<=15000,bindBrowser(socket,u){socket.on('workflow:v2:request',(p,ack)=>{if(typeof ack==='function')void request(socket,u,p,ack);});socket.on('disconnect',()=>limits.delete(socket.id));},renew(lease){if(read(lease.deviceId)?.grant&&!read(lease.deviceId).grant.revoked){const agent=agents.get(lease.deviceId);if(agent)void issue(lease.deviceId,lease,agent).catch(()=>revoke(lease.deviceId));}}};
}

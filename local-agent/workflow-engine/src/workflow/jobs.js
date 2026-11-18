const {randomUUID,createHash}=require('node:crypto');
const {fail,exact,object}=require('./remote-policy');
const canonical=v=>JSON.stringify(v,(_,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const fingerprint=(operation,params)=>createHash('sha256').update(canonical({operation,params})).digest('hex');
const terminal=s=>['succeeded','failed','cancelled','expired','rejected'].includes(s);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const fields={run:['scenario','profile','variables','timeoutMs'],stop:['runId'],openProfile:['profile']};
function createEngineJobs({state,save,instance,perform,lookup,now=Date.now}){
  state.jobs??={};
  for(const j of Object.values(state.jobs))if(!terminal(j.state)||!j.quiescent){if(!terminal(j.state))j.state='unknown';j.quiescent=false;j.reasonCode='ENGINE_RESTART';j.seq++;j.updatedAt=now();}
  save();
  function update(j,value){
    if(terminal(j.state)&&j.quiescent)return;
    const next={state:value.state,runId:j.runId,progress:{index:Math.min(10000,value.index||0),total:Math.min(10000,value.total||0),action:null},quiescent:value.quiescent===true,reasonCode:value.state==='unknown'?'UNKNOWN_OUTCOME':value.state==='failed'?'RUN_FAILED':'UPDATED'};
    if(terminal(j.state))next.state=j.state;
    if(j.cancelled&&next.state==='running')next.state='stopping';
    if(canonical(next)!==canonical({state:j.state,runId:j.runId,progress:j.progress,quiescent:j.quiescent,reasonCode:j.reasonCode})){Object.assign(j,next,{seq:j.seq+1,updatedAt:now()});save();}
  }
  function report(j){return {jobId:j.jobId,grantId:j.grantId,fence:j.fence,originEngineInstanceId:j.originEngineInstanceId,seq:j.seq,state:j.state,runId:j.runId,progress:j.progress,quiescent:j.quiescent,reasonCode:j.reasonCode};}
  function tick(){for(const j of Object.values(state.jobs))if((!terminal(j.state)||!j.quiescent)&&j.operation!=='openProfile'){
    const run=lookup(j.runId);if(!run)continue;
    if(j.operation==='stop')update(j,{...run,state:run.quiescent?'succeeded':'stopping'});else update(j,run);
  }}
  async function execute(body,g){
    if(!exact(body,['jobId','requestId','operation','params'])||!uuid(body.jobId)||typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.requestId)||!Object.hasOwn(fields,body.operation)||!exact(body.params,fields[body.operation])||Buffer.byteLength(JSON.stringify(body))>14000)fail('INVALID_REQUEST',400);
    const hash=fingerprint(body.operation,body.params),existing=Object.values(state.jobs).find(j=>j.deviceId===g.deviceId&&j.userId===g.userId&&j.requestId===body.requestId);
    if(existing){if(existing.fingerprint!==hash||existing.jobId!==body.jobId)fail('IDEMPOTENCY_CONFLICT',409);return {job:report(existing),data:existing.operation==='run'?lookup(existing.runId)||report(existing):report(existing)};}
    if(Object.values(state.runs).some(r=>r.requestId===body.requestId&&r.userId===g.userId))fail('IDEMPOTENCY_CONFLICT',409);
    if(state.jobs[body.jobId])fail('IDEMPOTENCY_CONFLICT',409);
    if(Object.keys(state.jobs).length>=2000)fail('RETENTION_REQUIRED',409);
    const at=now(),j={jobId:body.jobId,requestId:body.requestId,operation:body.operation,fingerprint:hash,deviceId:g.deviceId,userId:g.userId,grantId:g.grantId,fence:g.fence,originEngineInstanceId:instance,runId:body.operation==='run'?randomUUID():body.operation==='stop'?body.params.runId:null,state:'dispatched',quiescent:false,progress:{index:0,total:0,action:null},reasonCode:'ACCEPTED',seq:1,ack:0,createdAt:at,updatedAt:at};
    if(j.runId!==null&&!uuid(j.runId))fail('INVALID_REQUEST',400);
    state.jobs[j.jobId]=j;save(); // Correlation and intent reach disk before any execute call.
    try{
      const data=await perform(body.operation,body.params,j,g);
      if(j.operation==='openProfile')update(j,{state:j.cancelled?'cancelled':'succeeded',quiescent:true});else tick();
      return {job:report(j),data};
    }catch(e){const r=lookup(j.runId);if(r)update(j,r);else {const safe=['POLICY_DENIED','INVALID_REQUEST','NOT_FOUND','EXTENSION_NOT_READY','PROFILE_BUSY','CHROME_CONFIG','INTERACTIVE_SESSION_REQUIRED','IDEMPOTENCY_CONFLICT','RETENTION_REQUIRED'].includes(e.code);update(j,{state:safe?'rejected':'unknown',quiescent:safe});}throw e;}
  }
  function cancel(id,body){
    if(!uuid(id)||!exact(body,['deviceId','userId','requestId','operation','fingerprint','grantId','fence','originEngineInstanceId','runId'])||body.deviceId!==state.deviceId||!uuid(body.grantId)||!uuid(body.originEngineInstanceId)||!Number.isSafeInteger(body.fence)||body.fence<1||!['run','stop','openProfile'].includes(body.operation)||!/^[a-f0-9]{64}$/.test(body.fingerprint||''))fail('INVALID_REQUEST',400);
    let j=state.jobs[id];
    if(j&&(j.deviceId!==body.deviceId||j.grantId!==body.grantId||j.fence!==body.fence||j.fingerprint!==body.fingerprint))fail('STALE_FENCE',409);
    if(!j){if(Object.keys(state.jobs).length>=2000)fail('RETENTION_REQUIRED',409);j=state.jobs[id]={...body,jobId:id,state:'cancelled',quiescent:true,cancelled:true,seq:1,ack:0,progress:{index:0,total:0,action:null},reasonCode:'CANCELLED_BEFORE_DELIVERY',createdAt:now(),updatedAt:now()};save();return report(j);}
    if(!terminal(j.state)){j.cancelled=true;j.state='stopping';j.seq++;save();if(j.runId)void Promise.resolve(perform('cancel',{runId:j.runId},j,null)).catch(()=>{});tick();}
    return report(j);
  }
  function prune(){for(const [id,j]of Object.entries(state.jobs))if(terminal(j.state)&&j.quiescent&&j.ack>=j.seq){
    if(now()-j.updatedAt>90*86400000){delete state.jobs[id];if(j.operation==='run')delete state.runs[j.runId];}
    else if(now()-j.updatedAt>30*86400000)j.compacted=true;
  }for(const [id,g]of Object.entries(state.grants))if(g.state==='revoked'&&!Object.values(state.runs).some(r=>r.grantId===id)&&!Object.values(state.jobs).some(j=>j.grantId===id)&&(g.expiresAt||g.issuedAt)&&now()-(g.expiresAt||g.issuedAt)>90*86400000)delete state.grants[id];save();}
  return {execute,cancel,tick,prune,report,get:id=>state.jobs[id],page(after=''){
    if(after&&!uuid(after))fail('INVALID_CURSOR',400);const keys=Object.keys(state.jobs).filter(id=>!state.jobs[id].compacted||state.jobs[id].ack<state.jobs[id].seq||!state.jobs[id].quiescent).sort();if(after&&!state.jobs[after])fail('INVALID_CURSOR',400);const start=after?keys.filter(id=>id<=after).length:0,ids=keys.slice(start,start+20);return {version:1,engineInstanceId:instance,checkedAt:now(),jobs:ids.map(id=>report(state.jobs[id])),cursor:start+20<keys.length?ids.at(-1):null};
  },ack(id,seq){const j=state.jobs[id];if(!j||!Number.isSafeInteger(seq)||seq<1||seq>j.seq)fail('INVALID_ACK',400);j.ack=Math.max(j.ack,seq);save();}};
}
module.exports={createEngineJobs,fingerprint};

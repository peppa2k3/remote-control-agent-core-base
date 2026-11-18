const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {atomicJson}=require('../../shared/remote-protocol');
const {createRemotePolicy,fail,exact,object}=require('../workflow/remote-policy');
const {parseStrictJson}=require('./strict-json');
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const key=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const operations=['profiles','scenarios','describe','runs','status','run','stop','openProfile'];

function createIntegratedApi({profileBridge,workflows,scenarios,profiles,scenariosDir,dataDir,policyFile,authorized,readBody,isStopping=()=>false,now=Date.now,monotonic=()=>performance.now()}){
  const instance=randomUUID(),file=path.join(dataDir,'workflow-grants.json');
  const policy=createRemotePolicy({file:policyFile,scenariosDir,scenarios});
  const state=fs.existsSync(file)?parseStrictJson(fs.readFileSync(file,'utf8')):{version:1,fence:0,deviceId:null,grants:{},runs:{}};
  if(state.version!==1||!Number.isSafeInteger(state.fence)||!object(state.grants)||!object(state.runs))fail('CONFIG',503);
  // Never infer quiescence from process death: external Chrome/children may survive.
  for(const grant of Object.values(state.grants))grant.state='revoked';
  for(const run of Object.values(state.runs))if(!run.quiescent)run.unknown=true;
  const deadlines=new Map();
  const save=()=>atomicJson(file,state);
  save();
  const remoteRun=id=>state.runs[id];
  function project(record){
    const run=workflows.getRun(record.runId);
    return {runId:record.runId,scenario:record.scenario,profile:record.profile,state:record.unknown||workflows.uncertain(record.runId)?'unknown':record.outcome||(!record.quiescent&&run?.state!=='running'?'stopping':run?.state||'unknown'),index:run?.index||0,total:run?.total||0,startedAt:run?.startedAt||null,endedAt:run?.endedAt||null,quiescent:record.quiescent,paused:run?.paused===true};
  }
  function snapshot(grant){return {grantId:grant.grantId,fence:grant.fence,seq:grant.seq,state:grant.state,expiresAt:grant.expiresAt,quiescent:Object.values(state.runs).filter(r=>r.grantId===grant.grantId).every(r=>r.quiescent)};}
  function revoke(grant){if(!grant)return;if(grant.state!=='revoked'){grant.state='revoked';deadlines.delete(grant.grantId);save();}for(const r of Object.values(state.runs))if(r.grantId===grant.grantId&&!r.quiescent)workflows.stopRun(r.runId);}
  function tick(){
    let stamp=null;try{stamp=policy.stamp();}catch{}
    for(const grant of Object.values(state.grants))if(grant.state==='active'){
      let sourceValid=true;try{for(const r of Object.values(state.runs))if(r.grantId===grant.grantId&&!r.quiescent)policy.scenario(r.scenario,r.profile);}catch{sourceValid=false;}
      if(!sourceValid||!deadlines.has(grant.grantId)||monotonic()>=deadlines.get(grant.grantId)||now()>=grant.expiresAt||stamp!==grant.policyStamp)revoke(grant);
    }
    let changed=false;
    for(const r of Object.values(state.runs))if(!r.quiescent&&workflows.getRun(r.runId)?.state!=='running'&&workflows.quiescent(r.runId)){r.quiescent=true;changed=true;}
    if(changed)save();
  }
  function active(id,fence){tick();const grant=state.grants[id];if(!grant||grant.state!=='active'||grant.fence!==fence||grant.fence!==state.fence||grant.engineInstanceId!==instance)fail('LEASE_REQUIRED');return grant;}
  function authorize(runId,step){const r=remoteRun(runId);if(!r)return;active(r.grantId,r.fence);policy.scenario(r.scenario,r.profile);if(step){policy.checkStep(step);if(profileBridge?.webStep(step))profileBridge.requireReady(r.profile,profileBridge.client(r.profile));}}
  function grantHeaders(req){if(req.headers['x-workflow-engine-instance']!==instance)fail('STALE_INSTANCE',409);const fence=Number(req.headers['x-workflow-fence']);if(!Number.isSafeInteger(fence))fail('STALE_FENCE',409);return active(req.headers['x-workflow-grant'],fence);}
  function put(id,body){
    if(!exact(body,['protocolVersion','grantId','sessionId','deviceId','userId','browserId','agentInstanceId','engineInstanceId','fence','seq','issuedAt','expiresAt'])||body.protocolVersion!==2||body.grantId!==id||![id,body.sessionId,body.deviceId,body.userId,body.agentInstanceId].every(uuid)||typeof body.browserId!=='string'||!body.browserId||body.browserId.length>128||body.engineInstanceId!==instance)fail('INVALID_GRANT',400);
    if(!Number.isSafeInteger(body.fence)||body.fence<1||!Number.isSafeInteger(body.seq)||body.seq<1||!Number.isSafeInteger(body.issuedAt)||!Number.isSafeInteger(body.expiresAt)||body.issuedAt>now()+2000||body.expiresAt<=now()||body.expiresAt>body.issuedAt+45000)fail('INVALID_GRANT',400);
    tick();const stamp=policy.stamp();
    if(state.deviceId&&state.deviceId!==body.deviceId)fail('DEVICE_MISMATCH',409);
    const previous=state.grants[id];
    if(previous){
      if(previous.state!=='active'||previous.fence!==state.fence||previous.engineInstanceId!==instance)fail('STALE_FENCE',409);
      for(const field of ['sessionId','deviceId','userId','browserId','agentInstanceId','engineInstanceId','fence'])if(previous[field]!==body[field])fail('INVALID_GRANT',409);
      if(body.seq<=previous.seq){if(body.seq===previous.seq&&body.expiresAt===previous.expiresAt)return snapshot(previous);fail('STALE_FENCE',409);}
      if(body.expiresAt<previous.expiresAt)fail('STALE_FENCE',409);
    }else{
      if(Object.keys(state.grants).length>=2000)fail('RETENTION_REQUIRED',409);
      if(body.fence<=state.fence)fail('STALE_FENCE',409);
      for(const grant of Object.values(state.grants))revoke(grant);
      tick();if(Object.values(state.runs).some(r=>!r.quiescent))fail('BUSY',409);
      state.fence=body.fence;state.deviceId=body.deviceId;
    }
    state.grants[id]={...body,state:'active',policyStamp:stamp};
    deadlines.set(id,monotonic()+Math.min(45000,body.expiresAt-now()));save();return snapshot(state.grants[id]);
  }
  function visible(r,g){return r&&state.grants[r.grantId]?.deviceId===g.deviceId&&policy.catalog().includes(r.scenario)&&policy.load().profiles.some(p=>p.id===r.profile);}
  async function handle(req,url,json){
    if(!authorized(req))fail('UNAUTHORIZED',401);if(req.headers.origin)fail('ORIGIN_DENIED');
    if(req.method==='POST'||req.method==='PUT')if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))fail('CONTENT_TYPE',415);
    tick();const route=url.pathname.slice('/api/v2'.length);
    if(req.method==='GET'&&route==='/health'){
      let revision=null,ready=false;try{revision=policy.load().revision;ready=true;}catch{}
      return json(200,{protocolVersion:2,lifecycleVersion:1,engineVersion:require('../../package.json').version,engineInstanceId:instance,mode:'integrated',operations,policyRevision:revision,legacyRemoteConfigPresent:fs.existsSync(path.join(dataDir,'remote.json')),health:{state:isStopping()?'stopping':Object.values(state.runs).some(r=>r.unknown)?'degraded':ready?'ready':'unconfigured',reasonCode:isStopping()?'STOPPING':Object.values(state.runs).some(r=>r.unknown)?'UNKNOWN_OUTCOME':ready?'READY':'POLICY_DENIED',checkedAt:now()}});
    }
    const gm=/^\/grants\/([a-f0-9-]{36})(\/revoke)?$/.exec(route);
    if(gm&&uuid(gm[1])){
      if(req.method==='PUT'&&!gm[2])return json(200,put(gm[1],await readBody(req)));
      let grant=state.grants[gm[1]];
      if(req.method==='POST'&&gm[2]){const body=await readBody(req);if(!exact(body,['engineInstanceId','fence','reason'])||body.engineInstanceId!==instance||!Number.isSafeInteger(body.fence)||body.fence<1||grant&&body.fence!==grant.fence||!['release','logout','expired','offline','takeover','policy_changed','shutdown'].includes(body.reason))fail('INVALID_GRANT',400);
        if(!grant){if(body.fence>state.fence){for(const old of Object.values(state.grants))revoke(old);state.fence=body.fence;}grant=state.grants[gm[1]]={grantId:gm[1],fence:body.fence,seq:0,expiresAt:0,state:'revoked'};save();}
        revoke(grant);tick();return json(200,snapshot(grant));}
      if(!grant)fail('NOT_FOUND',404);
      if(req.method==='GET'&&!gm[2])return json(200,snapshot(grant));
      fail('METHOD_NOT_ALLOWED',405);
    }
    const g=grantHeaders(req);
    if(req.method==='GET'&&route==='/profiles')return json(200,{profiles:profiles().filter(p=>policy.load().profiles.some(v=>v.id===p.directory)).map(p=>({directory:p.directory,name:p.directory,allowOpen:policy.load().profiles.find(v=>v.id===p.directory).allowOpen,extensionConnected:profileBridge?profileBridge.status(p.directory).state==='ready':workflows.status(p.directory).extensionConnected,readiness:profileBridge?.status(p.directory)||null}))});
    if(req.method==='POST'&&route==='/profiles/open'){
      const body=await readBody(req);if(!exact(body,['profile'])||typeof body.profile!=='string')fail('INVALID_REQUEST',400);
      if(!profileBridge)fail('INCOMPATIBLE',409);
      return json(200,await profileBridge.open(body.profile,()=>active(g.grantId,g.fence)));
    }
    if(req.method==='GET'&&route==='/scenarios')return json(200,{names:policy.catalog()});
    const describe=/^\/scenarios\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(route);
    if(req.method==='GET'&&describe){const s=policy.scenario(describe[1]);return json(200,{name:describe[1],steps:s.source.steps.length,variables:Object.fromEntries(s.rule.publicDefaults.filter(k=>Object.hasOwn(s.source.variables||{},k)).map(k=>{const v=s.source.variables[k];policy.prepare(describe[1],s.rule.profiles[0],{[k]:v});return [k,v];}))});}
    if(req.method==='GET'&&route==='/runs')return json(200,{runs:Object.values(state.runs).filter(r=>visible(r,g)&&(!url.searchParams.get('profile')||r.profile===url.searchParams.get('profile'))).slice(-50).reverse().map(project)});
    if(req.method==='POST'&&route==='/runs'){
      const body=await readBody(req),requestId=req.headers['idempotency-key'];
      if(!exact(body,['jobId','scenario','profile','variables','timeoutMs'])||!uuid(body.jobId)||!key(requestId)||typeof body.scenario!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(body.scenario)||typeof body.profile!=='string'||!/^(Default|Profile \d+)$/.test(body.profile)||body.timeoutMs!==undefined&&(!Number.isSafeInteger(body.timeoutMs)||body.timeoutMs<1||body.timeoutMs>86400000))fail('INVALID_REQUEST',400);
      if(Buffer.byteLength(JSON.stringify(body))>13000)fail('TOO_LARGE',413);
      const prepared=policy.prepare(body.scenario,body.profile,body.variables===undefined?{}:body.variables);
      if(profileBridge&&prepared.prepared.steps.some(profileBridge.webStep))profileBridge.requireReady(body.profile);
      const fingerprint=createHash('sha256').update(JSON.stringify(body,(_,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
      const existing=Object.values(state.runs).find(r=>r.requestId===requestId&&r.userId===g.userId);
      if(existing){if(existing.fingerprint!==fingerprint||existing.grantId!==g.grantId)fail('IDEMPOTENCY_CONFLICT',409);return json(200,project(existing));}
      if(Object.keys(state.runs).length>=2000)fail('RETENTION_REQUIRED',409);
      if(Object.values(state.runs).some(r=>!r.quiescent&&r.profile===body.profile))fail('BUSY',409);
      if(Object.values(state.runs).some(r=>r.jobId===body.jobId))fail('IDEMPOTENCY_CONFLICT',409);
      const runId=randomUUID(),r={runId,jobId:body.jobId,requestId,fingerprint,grantId:g.grantId,fence:g.fence,userId:g.userId,scenario:body.scenario,profile:body.profile,quiescent:false};
      state.runs[runId]=r;save();
      try{workflows.start(body.profile,prepared.prepared,'',body.scenario,{},body.timeoutMs,runId);}catch(error){r.quiescent=workflows.getRun(runId)?workflows.quiescent(runId):true;r.outcome=r.quiescent?'rejected':'unknown';save();fail(error.message.startsWith('Reload extension 4.3.0')?'EXTENSION_UPGRADE_REQUIRED':'RUN_REJECTED',409);}
      return json(202,project(r));
    }
    const rm=/^\/runs\/([a-f0-9-]{36})(\/stop)?$/.exec(route);
    if(rm&&uuid(rm[1])){const r=state.runs[rm[1]];if(!visible(r,g))fail('NOT_FOUND',404);if(req.method==='GET'&&!rm[2])return json(200,project(r));if(req.method==='POST'&&rm[2]){const body=await readBody(req);if(!exact(body,['jobId'])||!uuid(body.jobId)||!key(req.headers['idempotency-key']))fail('INVALID_REQUEST',400);workflows.stopRun(r.runId);tick();return json(r.quiescent?200:202,project(r));}}
    fail('NOT_FOUND',404);
  }
  return {handle,authorize,tick,instance,profilePolicy:()=>policy.load().profiles,quiescent:()=>Object.values(state.runs).every(r=>r.quiescent),close(){for(const g of Object.values(state.grants))revoke(g);tick();}};
}
module.exports={createIntegratedApi};

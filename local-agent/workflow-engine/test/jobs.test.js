const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const {randomUUID,createHash}=require('node:crypto');
const {createEngineJobs,fingerprint}=require('../src/workflow/jobs');
const {temporary,removeTemporary,startEngine}=require('./helpers/engine');

test('engine journal never repeats side effects after missing receipt/crash and retains cancel-before-delivery tombstones',async()=>{
  const deviceId=randomUUID(),grantId=randomUUID(),instance=randomUUID(),state={deviceId,grants:{},runs:{},jobs:{}},g={deviceId,userId:randomUUID(),grantId,fence:1};let effects=0,saved,clock=1000;
  const options={state,instance,now:()=>clock,save:()=>{saved=JSON.stringify(state);},lookup:()=>null,perform:async()=>{effects++;assert(saved.includes('dispatched'));throw Error('lost receipt after side effect');}};
  let jobs=createEngineJobs(options);const command={jobId:randomUUID(),requestId:'crash',operation:'openProfile',params:{profile:'Default'}};
  await assert.rejects(jobs.execute(command,g));assert.equal(effects,1);await jobs.execute(command,g);assert.equal(effects,1);
  const cancel={deviceId,userId:g.userId,requestId:'cancel-first',operation:'run',fingerprint:fingerprint('run',{profile:'Default',scenario:'wait'}),grantId,fence:1,originEngineInstanceId:instance,runId:null},id=randomUUID();
  jobs.cancel(id,cancel);assert.equal((await jobs.execute({jobId:id,requestId:'cancel-first',operation:'run',params:{scenario:'wait',profile:'Default'}},g)).job.state,'cancelled');assert.equal(effects,1);
  assert.throws(()=>jobs.ack(id,99),/INVALID_ACK/);jobs.ack(id,1);clock+=31*86400000;jobs.prune();assert(jobs.get(id));clock+=60*86400000;jobs.prune();assert.equal(jobs.get(id),undefined);
  state.jobs[command.jobId].state='dispatched';state.jobs[command.jobId].quiescent=false;jobs=createEngineJobs({...options,instance:randomUUID()});assert.equal(jobs.get(command.jobId).state,'unknown');await jobs.execute(command,{...g,grantId:randomUUID()});assert.equal(effects,1);
});

test('real HTTP durable job ↔ run correlation survives a killed engine; duplicate body/key is not rebound',async t=>{
  const directory=temporary('engine-jobs-');let engine;
  const configure=({data,scenarios})=>{fs.writeFileSync(path.join(data,'workflow-policy.json'),JSON.stringify({schemaVersion:1,revision:1,profiles:[{id:'Default',allowOpen:false}],scenarios:[{id:'wait',sha256:createHash('sha256').update(fs.readFileSync(path.join(scenarios,'wait.json'))).digest('hex'),profiles:['Default'],variables:{delay:{type:'integer',minimum:1,maximum:30000}},publicDefaults:[]}]}));return {LOCAL_AGENT_MODE:'integrated'};};
  engine=await startEngine({directory,configure});t.after(async()=>{await engine.close();removeTemporary(directory);});
  async function http(route,method='GET',body,headers={}){const r=await fetch(engine.base+'/api/v2'+route,{method,headers:{Authorization:'Bearer '+engine.token,'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
  const h=(await http('/health')).data,grant={protocolVersion:2,grantId:randomUUID(),sessionId:randomUUID(),deviceId:randomUUID(),userId:randomUUID(),browserId:'fixture',agentInstanceId:randomUUID(),engineInstanceId:h.engineInstanceId,fence:1,seq:1,issuedAt:Date.now(),expiresAt:Date.now()+30000};
  assert.equal((await http('/grants/'+grant.grantId,'PUT',grant)).status,200);
  const headers={'X-Workflow-Grant':grant.grantId,'X-Workflow-Fence':'1','X-Workflow-Engine-Instance':h.engineInstanceId},command={jobId:randomUUID(),requestId:'http-lost-ack',operation:'run',params:{scenario:'wait',profile:'Default',variables:{delay:20000}}};
  const first=await http('/jobs','POST',command,headers);assert.equal(first.status,200,JSON.stringify(first.data));assert(first.data.job.runId);assert.equal(first.data.data.runId,first.data.job.runId);
  const duplicate=await http('/jobs','POST',command,headers);assert.equal(duplicate.data.job.runId,first.data.job.runId);
  assert.equal((await http('/jobs','POST',{...command,params:{...command.params,variables:{delay:10}}},headers)).status,409);
  const token=engine.token;
  // This case models abrupt process loss, so do not run the engine's SIGTERM drain.
  const stopped=once(engine.child,'close');assert.equal(engine.child.kill('SIGKILL'),true);await stopped;
  engine=await startEngine({directory,token,configure});
  const lookup=await http('/jobs/'+command.jobId);assert.equal(lookup.status,200);assert.equal(lookup.data.job.runId,first.data.job.runId);assert.equal(lookup.data.job.state,'unknown');assert.equal(lookup.data.job.quiescent,false);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(engine.data,'workflow-grants.json'))).runs).length,1);assert(fs.existsSync(path.join(engine.data,'workflow-grants.json.v1-backup.json')));
});

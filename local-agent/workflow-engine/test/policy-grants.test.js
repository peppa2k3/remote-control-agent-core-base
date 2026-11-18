const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createWorkflows}=require('../src/workflow/workflows');
const {createScenarioStore}=require('../src/workflow/scenario-store');
const {createIntegratedApi}=require('../src/http/integrated-api');
const {createRemotePolicy}=require('../src/workflow/remote-policy');
const {parseStrictJson}=require('../src/http/strict-json');
const {temporary,removeTemporary,startEngine}=require('./helpers/engine');

function policyFor(scenarios,names=['wait']){
  return {schemaVersion:1,revision:1,profiles:[{id:'Default',allowOpen:false}],urlOrigins:['https://example.test'],fileRoots:[],scenarios:names.map(id=>({id,sha256:createHash('sha256').update(fs.readFileSync(path.join(scenarios,id+'.json'))).digest('hex'),profiles:['Default'],variables:{delay:{type:'integer',minimum:1,maximum:10000},privateChoice:{type:'string',maxLength:50,enum:['PRIVATE_SCHEMA_ENUM_MUST_NOT_LEAK']}},publicDefaults:['delay']}))};
}
test('policy is deny by default, pins source, validates types and blocks alias URL/path overrides',t=>{
  const directory=temporary('workflow-policy-');t.after(()=>removeTemporary(directory));
  const file=path.join(directory,'policy.json'),scenarios=createScenarioStore(directory),policy=createRemotePolicy({file,scenariosDir:directory,scenarios});
  assert.throws(()=>policy.load(),/POLICY_DENIED/);
  const scenario={variables:{delay:20,destination:'https://example.test/',alias:'{{destination}}',private:'hidden-default'},steps:[{action:'openUrl',url:'{{alias}}'},{action:'wait',ms:'{{delay}}'}]};
  fs.writeFileSync(path.join(directory,'wait.json'),JSON.stringify(scenario));const approved=policyFor(directory);
  approved.scenarios[0].variables.destination={type:'string',maxLength:200};fs.writeFileSync(file,JSON.stringify(approved));
  assert(policy.prepare('wait','Default',{delay:30}));
  assert.throws(()=>policy.prepare('wait','Default',{delay:'30'}),/POLICY_DENIED/);
  assert.throws(()=>policy.prepare('wait','Default',{delay:10001}),/POLICY_DENIED/);
  assert.throws(()=>policy.prepare('wait','Default',{download_title:'override'}),/POLICY_DENIED/);
  assert.throws(()=>policy.prepare('wait','Default',{destination:'https://example.test/other'}),/POLICY_DENIED/);
  assert.throws(()=>policy.prepare('wait','Profile 1',{}),/POLICY_DENIED/);
  assert.throws(()=>policy.prepare('wait','Default',JSON.parse('{"__proto__":"bad"}')),/POLICY_DENIED/);
  fs.appendFileSync(path.join(directory,'wait.json'),' ');assert.deepEqual(policy.catalog(),[]);
  for(const invalid of ['{"a":1,"a":2}','{"a":{"constructor":1}}','{"x":1e999}'])assert.throws(()=>parseStrictJson(invalid));
  assert.deepEqual(parseStrictJson('{"text":"brace } and \\\" quote","v":[1,true]}'),{text:'brace } and " quote',v:[1,true]});
  const allowed=path.join(directory,'allowed'),outside=path.join(directory,'outside');fs.mkdirSync(allowed);fs.mkdirSync(outside);fs.writeFileSync(path.join(allowed,'safe.txt'),'fixture');fs.writeFileSync(path.join(outside,'private.txt'),'dummy private fixture');
  approved.fileRoots=[allowed];approved.revision++;fs.writeFileSync(file,JSON.stringify(approved));
  policy.checkStep({action:'upload',filePath:path.join(allowed,'safe.txt')});
  fs.symlinkSync(outside,path.join(allowed,'escape'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>policy.checkStep({action:'upload',filePath:path.join(allowed,'escape/private.txt')}),/POLICY_DENIED/);
});

test('integrated HTTP blocks v1/native dashboard bypass; watchdog stops remote wait and leaves local run alone',async t=>{
  const directory=temporary('workflow-grants-http-');
  const engine=await startEngine({directory,configure({data,scenarios}){const policy=policyFor(scenarios);fs.writeFileSync(path.join(data,'workflow-policy.json'),JSON.stringify(policy));return {LOCAL_AGENT_MODE:'integrated'};}});
  t.after(async()=>{await engine.close();removeTemporary(directory);});
  async function call(route,{method='GET',body,headers={},status=200,raw}={}){const response=await fetch(engine.base+route,{method,headers:{Authorization:'Bearer '+engine.token,'Content-Type':'application/json',...headers},body:raw??(body===undefined?undefined:JSON.stringify(body))});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
  await call('/api/v1/scenarios',{status:403});await call('/api/run',{method:'POST',body:{name:'wait',profile:'Default'},status:401});
  await call('/api/v2/health',{headers:{Authorization:'Bearer invalid'},status:401});
  const health=await call('/api/v2/health');assert.equal(health.mode,'integrated');assert.equal(health.legacyRemoteConfigPresent,true);
  const grant={protocolVersion:2,grantId:randomUUID(),sessionId:randomUUID(),deviceId:randomUUID(),userId:randomUUID(),browserId:'fixture-browser',agentInstanceId:randomUUID(),engineInstanceId:health.engineInstanceId,fence:1,seq:1,issuedAt:Date.now(),expiresAt:Date.now()+1200};
  await call('/api/v2/grants/'+grant.grantId,{method:'PUT',body:grant});
  const headers={'X-Workflow-Grant':grant.grantId,'X-Workflow-Fence':'1','X-Workflow-Engine-Instance':health.engineInstanceId};
  assert.deepEqual(await call('/api/v2/scenarios',{headers}),{names:['wait']});
  assert.deepEqual((await call('/api/v2/scenarios/wait',{headers})).variables,{delay:20});
  const description=await call('/api/v2/scenarios/wait',{headers});assert.deepEqual(description.variableSchema,{delay:{type:'integer',minimum:1,maximum:10000},privateChoice:{type:'string',maxLength:50}});assert(!JSON.stringify(description).includes('PRIVATE_SCHEMA_ENUM_MUST_NOT_LEAK'));assert.deepEqual(description.profiles,['Default']);assert(!JSON.stringify(description).includes('sha256'));
  const run=await call('/api/v2/runs',{method:'POST',headers:{...headers,'Idempotency-Key':'watchdog'},body:{jobId:randomUUID(),profile:'Default',scenario:'wait',variables:{delay:10000}},status:202});
  // Local dashboard is an explicit trusted local-admin path, with a different run ID.
  const html=await(await fetch(engine.base)).text(),session=/name="local-agent-session" content="([a-f0-9]+)"/.exec(html)[1];
  await call('/api/stop',{method:'POST',headers:{'x-local-agent-session':session},body:{profile:'Default'}});
  const local=await call('/api/run',{method:'POST',headers:{'x-local-agent-session':session},body:{profile:'Default',name:'wait',variables:{delay:10000}}});
  assert.notEqual(local.runId,run.runId);
  await new Promise(r=>setTimeout(r,1400));
  await call('/api/v2/scenarios',{headers,status:403});
  const stopped=await call('/api/v2/grants/'+grant.grantId);assert.equal(stopped.state,'revoked');assert.equal(stopped.quiescent,true);
  const localState=await call('/api/history/'+local.runId,{headers:{'x-local-agent-session':session}});assert.equal(localState.state,'running');
  await call('/api/v2/grants/'+grant.grantId,{method:'PUT',body:{...grant,seq:2,issuedAt:Date.now(),expiresAt:Date.now()+5000},status:409});
  await call('/api/v2/grants/'+randomUUID(),{method:'PUT',raw:'{"protocolVersion":2,"protocolVersion":2}',status:400});
});

test('revoke waits for browser completion, rejects late advancement, fences replay/restart and records revoke-before-grant',async t=>{
  const directory=temporary('workflow-grant-unit-');t.after(()=>removeTemporary(directory));
  const scenarios=createScenarioStore(directory);fs.writeFileSync(path.join(directory,'wait.json'),JSON.stringify({variables:{delay:20},steps:[{action:'openUrl',url:'https://example.test/'},{action:'click',selector:'#next'}]}));
  const policyFile=path.join(directory,'policy.json');fs.writeFileSync(policyFile,JSON.stringify(policyFor(directory)));
  let api;const workflows=createWorkflows({scenarios,defaultProfile:'Default',profiles:()=>[{directory:'Default'}],strictSettlement:true,authorize:(id,step)=>api?.authorize(id,step)});const session=workflows.connect({profile:'Default',clientId:'extension-fixture',settlementVersion:1});
  const options={workflows,scenarios,profiles:()=>[{directory:'Default'}],scenariosDir:directory,dataDir:directory,policyFile,authorized:()=>true,readBody:async req=>req.body};
  api=createIntegratedApi(options);
  const grant={protocolVersion:2,grantId:randomUUID(),sessionId:randomUUID(),deviceId:randomUUID(),userId:randomUUID(),browserId:'fixture',agentInstanceId:randomUUID(),engineInstanceId:api.instance,fence:1,seq:1,issuedAt:Date.now(),expiresAt:Date.now()+10000};
  async function request(route,method='GET',body,headers={}){let result;await api.handle({method,body,headers:{'content-type':'application/json',...headers}},new URL('http://127.0.0.1/api/v2'+route),(status,data)=>result={status,data});return result.data;}
  await request('/grants/'+grant.grantId,'PUT',grant);
  const headers={'x-workflow-grant':grant.grantId,'x-workflow-fence':'1','x-workflow-engine-instance':api.instance,'idempotency-key':'browser-run'};
  const run=await request('/runs','POST',{jobId:randomUUID(),scenario:'wait',profile:'Default'},headers);
  const issued=workflows.next(session);assert(issued.step);
  const revoke=()=>request('/grants/'+grant.grantId+'/revoke','POST',{engineInstanceId:api.instance,fence:1,reason:'takeover'});
  assert.equal((await revoke()).quiescent,false);
  const next={...grant,grantId:randomUUID(),fence:2};await assert.rejects(request('/grants/'+next.grantId,'PUT',next),/BUSY/);
  workflows.result(session,{runId:issued.runId,id:issued.step.id,clientId:'wrong-client',ok:true,settled:true});assert.equal((await revoke()).quiescent,false);
  workflows.result(session,{runId:issued.runId,id:issued.step.id,clientId:'extension-fixture',ok:false,settled:false});assert.equal((await revoke()).quiescent,false);
  workflows.result(session,{runId:issued.runId,id:issued.step.id,clientId:'extension-fixture',ok:true,settled:true});assert.equal((await revoke()).quiescent,true);
  assert.equal(workflows.getRun(run.runId).index,0,'late ACK must not dispatch click');
  await request('/grants/'+next.grantId,'PUT',next);
  await assert.rejects(request('/grants/'+grant.grantId,'PUT',{...grant,seq:99}),/STALE_FENCE/);
  const tombstone=randomUUID();await request('/grants/'+tombstone+'/revoke','POST',{engineInstanceId:api.instance,fence:3,reason:'offline'});
  await assert.rejects(request('/grants/'+tombstone,'PUT',{...grant,grantId:tombstone,fence:3}),/STALE_FENCE/);
  api=createIntegratedApi(options);await assert.rejects(request('/grants/'+next.grantId,'PUT',next),/INVALID_GRANT/);
});

test('local work retains quiescence until cancelled child work settles; rollback clock cannot extend grants',async t=>{
  const directory=temporary('workflow-quiescence-');t.after(()=>removeTemporary(directory));
  const scenarios=createScenarioStore(directory);let finish;
  const workflows=createWorkflows({scenarios,defaultProfile:'Default',profiles:()=>[{directory:'Default'}],downloadVideo:()=>new Promise(resolve=>{finish=resolve;})});
  const run=workflows.start('Default',{steps:[{action:'downloadVideo',url:'https://example.test/video',directory}]});
  workflows.stopRun(run.runId);assert.equal(workflows.quiescent(run.runId),false);
  finish({verified:true,filePath:path.join(directory,'fake.mp4')});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(workflows.quiescent(run.runId),true);assert.equal(workflows.getRun(run.runId).state,'cancelled');
  fs.writeFileSync(path.join(directory,'wait.json'),JSON.stringify({variables:{delay:20},steps:[{action:'wait',ms:'{{delay}}'}]}));
  const policyFile=path.join(directory,'policy.json');fs.writeFileSync(policyFile,JSON.stringify(policyFor(directory)));
  let wall=10000,mono=0;const api=createIntegratedApi({workflows,scenarios,profiles:()=>[{directory:'Default'}],scenariosDir:directory,dataDir:directory,policyFile,authorized:()=>true,readBody:async r=>r.body,now:()=>wall,monotonic:()=>mono});
  const g={protocolVersion:2,grantId:randomUUID(),sessionId:randomUUID(),deviceId:randomUUID(),userId:randomUUID(),browserId:'fixture',agentInstanceId:randomUUID(),engineInstanceId:api.instance,fence:1,seq:1,issuedAt:wall,expiresAt:wall+1000};
  await api.handle({method:'PUT',headers:{'content-type':'application/json'},body:g},new URL('http://localhost/api/v2/grants/'+g.grantId),()=>{});
  wall=10500;mono=500;
  await api.handle({method:'PUT',headers:{'content-type':'application/json'},body:{...g,seq:2,issuedAt:wall,expiresAt:12000}},new URL('http://localhost/api/v2/grants/'+g.grantId),()=>{});
  wall=11001;mono=1001;api.tick();let result;
  await api.handle({method:'GET',headers:{}},new URL('http://localhost/api/v2/grants/'+g.grantId),(_,v)=>result=v);assert.equal(result.state,'active','renew survives the original deadline');
  wall=1;mono=2001;api.tick();
  await api.handle({method:'GET',headers:{}},new URL('http://localhost/api/v2/grants/'+g.grantId),(_,v)=>result=v);assert.equal(result.state,'revoked');
});

test('video process cancellation waits for confirmed exit and subprocesses do not inherit engine secrets',async()=>{
  const {run}=require('../src/integrations/video/video-download');
  await assert.rejects(run(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:AbortSignal.timeout(200)}),error=>error.cleanupConfirmed===true&&/cancelled/.test(error.message));
  await assert.rejects(run(process.execPath,['-e','process.exit(7)']),error=>error.cleanupConfirmed===false,'unexpected parent failure cannot prove descendant cleanup');
  const entry=path.resolve(__dirname,'../src/integrations/video/video-download.js');
  const script=`require(process.argv[1]).run(process.execPath,['-e',"console.log(Boolean(process.env.LOCAL_AGENT_API_TOKEN || process.env.MONGODB_URI || process.env.DEVICE_CREDENTIAL))"]).then(v=>{if(v!=='false')process.exitCode=1;});`;
  const env={};for(const [k,v]of Object.entries(process.env))if(/^(SystemRoot|WINDIR|PATH|TEMP|TMP|COMSPEC|PATHEXT)$/i.test(k))env[k]=v;
  Object.assign(env,{LOCAL_AGENT_API_TOKEN:'dummy-fixture-token',MONGODB_URI:'dummy-fixture-uri',DEVICE_CREDENTIAL:'dummy-fixture-credential'});
  const result=require('node:child_process').spawnSync(process.execPath,['-e',script,entry],{env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);
});

test('integrated browser runs reject an old extension and never advance on an unconfirmed receipt',()=>{
  const workflows=createWorkflows({scenarios:{prepare:x=>x,prepareStep:x=>x},defaultProfile:'Default',profiles:()=>[{directory:'Default'}],strictSettlement:true});
  const session=workflows.connect({profile:'Default',clientId:'fixture'}),scenario={steps:[{action:'openUrl',url:'https://example.test/'},{action:'click',selector:'#next'}]};
  assert.throws(()=>workflows.start('Default',scenario),/Reload extension 4.3.0/);
  workflows.connect({profile:'Default',clientId:'fixture',settlementVersion:1});const run=workflows.start('Default',scenario),step=workflows.next(session);
  workflows.result(session,{clientId:'fixture',runId:step.runId,id:step.step.id,ok:true,settled:false});
  assert.equal(workflows.getRun(run.runId).state,'failed');assert.equal(workflows.quiescent(run.runId),false);assert.equal(workflows.uncertain(run.runId),true);assert.equal(workflows.next(session).step,null);
});

test('Windows cancellation closes the owned child and grandchild before reporting confirmed cleanup',{skip:process.platform!=='win32'},async()=>{
  const directory=temporary('workflow-process-tree-'),file=path.join(directory,'child.pid');
  const controller=new AbortController();let pid;
  const script="const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});require('node:fs').writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000);";
  const pending=require('../src/integrations/video/video-download').run(process.execPath,['-e',script,file],{signal:controller.signal}).then(()=>null,error=>error);
  try{
    for(let n=0;n<100&&!fs.existsSync(file);n++)await new Promise(resolve=>setTimeout(resolve,30));assert(fs.existsSync(file));pid=Number(fs.readFileSync(file,'utf8'));assert(Number.isSafeInteger(pid)&&pid>0);
    controller.abort();const error=await pending;assert.equal(error.cleanupConfirmed,true);
    assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
  }finally{controller.abort();await pending;if(pid)try{process.kill(pid);}catch{}removeTemporary(directory);}
});

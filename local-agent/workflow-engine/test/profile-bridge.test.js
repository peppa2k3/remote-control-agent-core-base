const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {temporary,removeTemporary,startEngine}=require('./helpers/engine');
const {createWorkflows}=require('../src/workflow/workflows');
const {createScenarioStore}=require('../src/workflow/scenario-store');
const {createProfileBridge}=require('../src/integrations/chrome/profile-bridge');

test('profile bridge fixed argv/env, local allowOpen, no duplicate launch, deadlines and verified client heartbeats',async()=>{
  let clock=0,busy=false,modal=false;const launches=[];
  const bridge=createProfileBridge({interactive:()=>{},profiles:()=>['Default','Profile 1','Profile 2'].map(directory=>({directory})),allowed:()=>[{id:'Default',allowOpen:true},{id:'Profile 1',allowOpen:false}],chromePath:path.resolve('fixture Program Files','Chrome.exe'),userDataDir:path.resolve('fixture Unicode Đường dẫn'),port:34819,now:()=>clock,deadlineMs:100,ttlMs:50,guiBusy:()=>modal,workflows:{profileBusy:()=>busy,browserBusy:()=>busy},launch:(...args)=>{launches.push(args);const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}});
  for(const profile of ['../Default','--flag','https://example.test','Profile 2'])await assert.rejects(bridge.open(profile),{code:'POLICY_DENIED'});
  await assert.rejects(bridge.open('Profile 1'),{code:'POLICY_DENIED'});
  modal=true;await assert.rejects(bridge.open('Default'),{code:'PROFILE_BUSY'});modal=false;
  const [one,two]=await Promise.all([bridge.open('Default'),bridge.open('Default')]);assert.equal(one.state,'starting');assert.equal(two.state,'starting');assert.equal(launches.length,1);
  assert.deepEqual(launches[0][1],[`--user-data-dir=${path.resolve('fixture Unicode Đường dẫn')}`,'--profile-directory=Default','http://127.0.0.1:34819']);assert.equal(launches[0][2].cwd,path.dirname(launches[0][0]));assert.equal(launches[0][2].shell,false);assert.equal(launches[0][2].env.LOCAL_AGENT_API_TOKEN,undefined);assert.equal(launches[0][2].env.NODE_OPTIONS,undefined);
  clock=101;assert.equal(bridge.status('Default').reasonCode,'EXTENSION_DEADLINE');assert.throws(()=>bridge.requireReady('Default'),{code:'EXTENSION_NOT_READY'});
  const identity={profile:'Default',clientId:randomUUID(),workerId:randomUUID(),readinessVersion:1,settlementVersion:1};
  assert.throws(()=>bridge.bind({...identity,path:'arbitrary'}),{code:'EXTENSION_UPGRADE_REQUIRED'});
  const binding=bridge.bind(identity);assert.notEqual(bridge.status('Default').state,'ready','bind alone is not a heartbeat');bridge.heartbeat({...identity,...binding});assert.equal(bridge.status('Default').state,'ready');assert.equal(bridge.status('Profile 1').state,'missing-extension');assert.equal(bridge.bind(identity).connectionId,binding.connectionId);
  assert.throws(()=>bridge.heartbeat({...identity,...binding,clientId:randomUUID()}),{code:'EXTENSION_BIND_REQUIRED'});assert.throws(()=>bridge.bind({...identity,workerId:randomUUID()}),{code:'PROFILE_BUSY'});
  clock+=51;assert.equal(bridge.status('Default').state,'missing-extension');busy=true;assert.throws(()=>bridge.bind({...identity,workerId:randomUUID()}),{code:'PROFILE_BUSY'});busy=false;
  const replacement=bridge.bind({...identity,workerId:randomUUID()});assert.notEqual(replacement.connectionId,binding.connectionId);assert.throws(()=>bridge.heartbeat({...identity,...binding}),{code:'EXTENSION_BIND_REQUIRED'});
});

test('open revalidates grant after spawn and never kills the launched browser',async()=>{
  let checks=0;const child=new EventEmitter();child.unref=()=>{};child.kill=()=>assert.fail('Chrome must not be killed');
  const bridge=createProfileBridge({interactive:()=>{},profiles:()=>[{directory:'Default'}],allowed:()=>[{id:'Default',allowOpen:true}],workflows:{profileBusy:()=>false,browserBusy:()=>false},chromePath:path.resolve('chrome.exe'),userDataDir:path.resolve('user data'),port:34719,launch:()=>{queueMicrotask(()=>child.emit('spawn'));return child;}});
  await assert.rejects(bridge.open('Default',()=>{if(++checks===3)throw Object.assign(Error('expired'),{code:'LEASE_REQUIRED'});}),{code:'LEASE_REQUIRED'});
});

test('a matching cleanup receipt remains admissible after policy removal without renewing readiness',()=>{
  let permitted=true,clock=0;
  const bridge=createProfileBridge({profiles:()=>[{directory:'Default'}],allowed:()=>permitted?[{id:'Default',allowOpen:true}]:[],workflows:{profileBusy:()=>false},now:()=>clock});
  const identity={profile:'Default',clientId:randomUUID(),workerId:randomUUID(),readinessVersion:1,settlementVersion:1},binding=bridge.bind(identity);
  bridge.heartbeat({...identity,...binding});permitted=false;clock=20000;
  assert.throws(()=>bridge.heartbeat({...identity,...binding}),{code:'POLICY_DENIED'});
  assert.doesNotThrow(()=>bridge.heartbeat({...identity,...binding},true));
  assert.throws(()=>bridge.heartbeat({...identity,...binding,clientId:randomUUID()},true),{code:'EXTENSION_BIND_REQUIRED'});
  permitted=true;assert.notEqual(bridge.status('Default').state,'ready');
});

test('real integrated API requires grant + allowOpen and separates sanitized extension discovery/binding',async t=>{
  const directory=temporary('profile-api-');const engine=await startEngine({directory,configure({data,scenarios}){fs.writeFileSync(path.join(data,'workflow-policy.json'),JSON.stringify({schemaVersion:1,revision:1,profiles:[{id:'Default',allowOpen:false}],urlOrigins:[],scenarios:[{id:'wait',sha256:createHash('sha256').update(fs.readFileSync(path.join(scenarios,'wait.json'))).digest('hex'),profiles:['Default'],variables:{},publicDefaults:[]}]}));return {LOCAL_AGENT_MODE:'integrated'};}});
  t.after(async()=>{await engine.close();removeTemporary(directory);});
  const origin='chrome-extension://'+'a'.repeat(32);
  async function call(route,body,headers={},status=200){const r=await fetch(engine.base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
  await call('/extension/profiles',{}, {Origin:'https://arbitrary.test'},403);
  assert.deepEqual(await call('/extension/profiles',{}, {Origin:origin}),{profiles:[{directory:'Default',name:'Default'}]});
  const identity={profile:'Default',clientId:randomUUID(),workerId:randomUUID(),readinessVersion:1,settlementVersion:1};
  await call('/extension/bind',{...identity,profile:'../Default'},{Origin:origin},403);
  const binding=await call('/extension/bind',identity,{Origin:origin});
  await call('/state',{...identity,...binding,clientId:randomUUID()},{Origin:origin},409);
  const auth={Authorization:'Bearer '+engine.token},h=await call('/api/v2/health',null,auth);
  await call('/api/v2/profiles/open',{profile:'Default'},auth,409);
  const grantId=randomUUID(),g={protocolVersion:2,grantId,sessionId:randomUUID(),deviceId:randomUUID(),userId:randomUUID(),browserId:'fixture',agentInstanceId:randomUUID(),engineInstanceId:h.engineInstanceId,fence:1,seq:1,issuedAt:Date.now(),expiresAt:Date.now()+30000};
  const result=await fetch(engine.base+'/api/v2/grants/'+grantId,{method:'PUT',headers:{...auth,'content-type':'application/json'},body:JSON.stringify(g)});assert.equal(result.status,200);
  const headers={...auth,'X-Workflow-Grant':grantId,'X-Workflow-Fence':'1','X-Workflow-Engine-Instance':h.engineInstanceId};
  for(const key of ['path','flags','url','chromePath','userDataDir'])await call('/api/v2/profiles/open',{profile:'Default',[key]:'arbitrary'},headers,400);
  await call('/api/v2/profiles/open',{profile:'Default'},headers,403);
  await call('/api/v2/profiles/open',{profile:'../Default'},headers,403);
});

test('integrated foreground lock spans profiles and cancellation until the matching late ACK settles',async t=>{
  const dir=temporary('profile-foreground-');t.after(()=>removeTemporary(dir));let modal=false;
  const workflows=createWorkflows({scenarios:createScenarioStore(dir),defaultProfile:'Default',profiles:()=>[{directory:'Default'},{directory:'Profile 1'}],strictSettlement:true,guiBusy:()=>modal});
  const one=workflows.connect({profile:'Default',clientId:'one',settlementVersion:1});workflows.connect({profile:'Profile 1',clientId:'two',settlementVersion:1});
  const scenario={steps:[{action:'openUrl',url:'https://example.test/'}]};workflows.start('Default',scenario);const step=workflows.next(one);
  assert.throws(()=>workflows.start('Profile 1',scenario),/PROFILE_BUSY/);workflows.stop('Default');assert.equal(workflows.browserBusy(),true);
  assert.throws(()=>workflows.start('Profile 1',scenario),/PROFILE_BUSY/);
  workflows.result(one,{runId:step.runId,id:step.step.id,clientId:'one',ok:false,settled:true});assert.equal(workflows.browserBusy(),false);
  modal=true;assert.throws(()=>workflows.start('Profile 1',scenario),/PROFILE_BUSY/);modal=false;
  one.picker.active=true;assert.throws(()=>workflows.start('Profile 1',scenario),/PROFILE_BUSY/);one.picker.active=false;
  workflows.start('Profile 1',{steps:[{action:'wait',ms:1}]});workflows.stop('Profile 1');await new Promise(r=>setTimeout(r,10));
});

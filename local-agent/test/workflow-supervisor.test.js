import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {createWorkflowSupervisor,assertPrivateEnv,filteredEngineEnv} from '../src/workflow-supervisor.js';
import {createWorkflowV2Client} from '../src/workflow-v2.js';
import fixture from '../workflow-engine/test/helpers/engine.js';
const {temporary,removeTemporary,startEngine}=fixture;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await pause(25);}assert.fail('Supervisor fixture deadline');}
function secure(file,publicRead=false){
  if(process.platform!=='win32'){chmodSync(file,publicRead?0o644:0o600);return;}
  if(publicRead){execFileSync('icacls.exe',[file,'/grant','*S-1-1-0:R'],{windowsHide:true,stdio:'ignore'});return;}
  const script="$ErrorActionPreference='Stop';$p=$env:WF_ACL_FILE;$s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$a=[System.Security.AccessControl.FileSecurity]::new();$a.SetAccessRuleProtection($true,$false);$r=[System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($s),'FullControl','Allow');$a.AddAccessRule($r);if($env:WF_PUBLIC -eq '1'){$a.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow'))};Set-Acl -LiteralPath $p -AclObject $a";
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:'ignore',env:{SystemRoot:process.env.SystemRoot,WF_ACL_FILE:file,WF_PUBLIC:publicRead?'1':'0'}});
}
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function setup(t,overrides={}){
  const dir=temporary('workflow-supervisor-'),data=join(dir,'data'),scenarios=join(dir,'scenarios');mkdirSync(data);mkdirSync(scenarios);
  writeFileSync(join(dir,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Fixture'}}}}));
  const source=JSON.stringify({steps:[{action:'wait',ms:20}]});writeFileSync(join(scenarios,'wait.json'),source);
  writeFileSync(join(data,'workflow-policy.json'),JSON.stringify({schemaVersion:1,revision:1,profiles:[{id:'Default',allowOpen:false}],urlOrigins:[],scenarios:[{id:'wait',sha256:createHash('sha256').update(source).digest('hex'),profiles:['Default'],variables:{},publicDefaults:[]}]}));
  const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),port=await freePort(),envFile=join(dir,'engine.env');
  writeFileSync(envFile,`LOCAL_AGENT_API_TOKEN=${token}\nLOCAL_AGENT_DATA_DIR=${JSON.stringify(data)}\nLOCAL_AGENT_SCENARIOS_DIR=${JSON.stringify(scenarios)}\nCHROME_USER_DATA_DIR=${JSON.stringify(dir)}\nCHROME_PROFILE=Default\nMONGODB_URI=\nSERVER_URL=never-child-backend\nDEVICE_CREDENTIAL=never-child-secret\nNODE_OPTIONS=--invalid-fixture\n`.replaceAll('\\\\','/'));
  secure(envFile);
  const settings={enabled:true,baseUrl:`http://127.0.0.1:${port}`,token},children=[],spawns=[];
  const options={settings,config:{mode:'managed',envFile},lockDirectory:join(dir,'locks'),pollMs:50,backoffMs:25,startupMs:3000,shutdownMs:15000,spawnImpl:(...args)=>{spawns.push(args);const child=spawn(...args);children.push(child);return child;},...overrides};
  const supervisor=createWorkflowSupervisor(options);
  t.after(async()=>{await supervisor.close();for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill();await pause(100);removeTemporary(dir);});
  return {supervisor,settings,options,dir,data,envFile,children,spawns};
}

test('managed cold start, filtered env/fixed argv, exclusive controller, crash new instance, clean owned shutdown',async t=>{
  const f=await setup(t);void f.supervisor.start();await until(()=>f.supervisor.snapshot().state==='ready');
  const first=f.supervisor.getHealth().engineInstanceId;
  assert.equal(f.supervisor.getHealth().lifecycleVersion,1);assert.equal(f.spawns[0][0],process.execPath);
  const [,,opts]=f.spawns[0];assert.equal(opts.shell,false);assert.equal(opts.env.DEVICE_CREDENTIAL,undefined);assert.equal(opts.env.SERVER_URL,undefined);assert.equal(opts.env.NODE_OPTIONS,undefined);assert.equal(opts.env.LOCAL_AGENT_ENV_DISABLED,'1');
  assert(!JSON.stringify(f.spawns[0][1]).includes(f.settings.token));assert(!JSON.stringify(f.supervisor.snapshot()).includes(f.settings.token));
  let duplicateSpawns=0;const duplicate=createWorkflowSupervisor({...f.options,settings:{...f.settings,baseUrl:f.settings.baseUrl+'/'},spawnImpl:()=>{duplicateSpawns++;throw Error('unexpected');}});
  await duplicate.start();assert.equal(duplicate.snapshot().reasonCode,'CONTROLLER_BUSY');assert.equal(duplicateSpawns,0);await duplicate.close();
  const contender=spawn(f.spawns[0][0],f.spawns[0][1],{...opts,env:{...opts.env,LOCAL_AGENT_PORT:String(await freePort()),LOCAL_AGENT_SUPERVISOR_ID:''},stdio:['ignore','ignore','ignore']});
  await once(contender,'close');assert.notEqual(contender.exitCode,0,'different-port engine cannot mutate the same locked data');
  assert.equal(f.children[0].exitCode,null);
  f.children[0].kill();await until(()=>f.supervisor.snapshot().state==='ready'&&f.supervisor.getHealth()?.engineInstanceId!==first);
  assert.equal(f.children.length,2);assert.equal(f.supervisor.snapshot().restarts,1);
  assert.equal(await f.supervisor.close(),true);assert.equal(f.children[1].exitCode,0);
});

test('attach verifies auth, leaves existing engine alive, occupied managed port is never killed',async t=>{
  const dir=temporary('workflow-attach-');const engine=await startEngine({directory:dir,configure:()=>({LOCAL_AGENT_MODE:'integrated'})});
  t.after(async()=>{await engine.close();removeTemporary(dir);});
  const settings={enabled:true,baseUrl:engine.base,token:engine.token};
  const attached=createWorkflowSupervisor({settings,config:{mode:'attach'},pollMs:30,startupMs:300});
  t.after(()=>attached.close());
  void attached.start();await until(()=>attached.getHealth());await attached.close();assert.equal(engine.child.exitCode,null);assert.equal((await fetch(engine.base)).status,200);
  const wrong=createWorkflowSupervisor({settings:{...settings,token:'wrong-token-value-12345678901234567890'},config:{mode:'attach'},pollMs:25,startupMs:200});
  t.after(()=>wrong.close());void wrong.start();await until(()=>wrong.snapshot().reasonCode==='AUTH_FAILED');assert.equal(wrong.getHealth(),null);
  const f=await setup(t);const occupied=createWorkflowSupervisor({...f.options,settings:{...settings,token:f.settings.token},spawnImpl:()=>{assert.fail('Occupied port must not spawn');}});
  await occupied.start();assert.equal(occupied.snapshot().reasonCode,'PORT_IN_USE');await occupied.close();assert.equal(engine.child.exitCode,null);
});

test('wrong version is not ready; private token file ACL and deny public read verified on host',async t=>{
  const f=await setup(t);assertPrivateEnv(f.envFile);secure(f.envFile,true);assert.throws(()=>assertPrivateEnv(f.envFile),{code:'ENV_PERMISSIONS'});
  await f.supervisor.start();assert.equal(f.supervisor.snapshot().reasonCode,'ENV_PERMISSIONS');assert.equal(f.children.length,0);
  const bad=createWorkflowSupervisor({settings:f.settings,config:{mode:'attach'},pollMs:20,startupMs:100,client:{health:async()=>({engineVersion:'9.0.0',mode:'integrated',engineInstanceId:randomUUID()})}});
  t.after(()=>bad.close());void bad.start();await until(()=>bad.snapshot().reasonCode==='INCOMPATIBLE');assert.equal(bad.getHealth(),null);
});

test('startup deadline, restart cap, and owned shutdown timeout use bounded cleanup',async t=>{
  // A real owned child which never starts HTTP and deliberately ignores IPC shutdown.
  const f=await setup(t,{startupMs:150,shutdownMs:75,maxRestarts:1,spawnImpl:()=>spawn(process.execPath,['-e',"process.on('message',()=>{});setInterval(()=>{},1000)"],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:filteredEngineEnv({}, {token:'a'.repeat(32),baseUrl:'http://127.0.0.1:34719'})})});
  await f.supervisor.start();assert.equal(f.supervisor.snapshot().reasonCode,'RESTART_LIMIT');assert.equal(f.supervisor.snapshot().restarts,1);
  const timeout=await setup(t,{startupMs:1000,shutdownMs:75,spawnImpl:()=>spawn(process.execPath,['-e',"process.on('message',()=>{});setInterval(()=>{},1000)"],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:filteredEngineEnv({}, {token:'a'.repeat(32),baseUrl:'http://127.0.0.1:34719'})})});
  void timeout.supervisor.start();await until(()=>timeout.supervisor.snapshot().owned);assert.equal(await timeout.supervisor.close(),false);assert.equal(timeout.supervisor.snapshot().reasonCode,'STOP_TIMEOUT');
});

test('HTTP health authentication does not accept a port-only service or wrong protocol',async t=>{
  const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({protocolVersion:1,mode:'integrated',engineVersion:'0.2.0',engineInstanceId:randomUUID()}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const client=createWorkflowV2Client({settings:()=>({enabled:true,baseUrl:`http://127.0.0.1:${server.address().port}`,token:'a'.repeat(32)})});
  await assert.rejects(client.health(),{code:'INCOMPATIBLE'});
});

test('managed crash with an accepted run preserves unknown outcome and never replays it',async t=>{
  const f=await setup(t),scenario=join(f.dir,'scenarios','wait.json'),policyFile=join(f.data,'workflow-policy.json');
  const source=JSON.stringify({steps:[{action:'wait',ms:20000}]});writeFileSync(scenario,source);const policy=JSON.parse(readFileSync(policyFile));policy.scenarios[0].sha256=createHash('sha256').update(source).digest('hex');writeFileSync(policyFile,JSON.stringify(policy));
  void f.supervisor.start();await until(()=>f.supervisor.snapshot().state==='ready');
  const client=createWorkflowV2Client({settings:()=>f.settings}),instance=f.supervisor.getHealth().engineInstanceId,grantId=randomUUID();
  await client.http('/grants/'+grantId,'PUT',{protocolVersion:2,grantId,sessionId:randomUUID(),deviceId:randomUUID(),userId:randomUUID(),browserId:'fixture-browser',agentInstanceId:randomUUID(),engineInstanceId:instance,fence:1,seq:1,issuedAt:Date.now(),expiresAt:Date.now()+30000});
  const run=await client.http('/runs','POST',{scenario:'wait',profile:'Default',variables:{},jobId:randomUUID()},{'X-Workflow-Grant':grantId,'X-Workflow-Fence':'1','X-Workflow-Engine-Instance':instance,'Idempotency-Key':'crash-fixture'});
  // SIGTERM is a graceful drain on POSIX; a crash must not run shutdown hooks.
  // Windows terminates for either signal, which previously hid this CI mismatch.
  assert.equal(run.state,'running');assert.equal(f.children[0].kill('SIGKILL'),true);
  await until(()=>f.children.length===2&&f.supervisor.getHealth()?.engineInstanceId!==instance&&f.supervisor.snapshot().reasonCode==='UNKNOWN_OUTCOME');
  const records=JSON.parse(readFileSync(join(f.data,'workflow-grants.json')));assert.deepEqual(Object.keys(records.runs),[run.runId]);assert.equal(records.runs[run.runId].unknown,true);assert.equal(records.grants[grantId].state,'revoked');
  assert.equal(await f.supervisor.close(),false,'unknown external settlement is never reported as clean');
});

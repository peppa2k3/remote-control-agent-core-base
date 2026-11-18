import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import https from 'node:https';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {io} from 'socket.io-client';
import {createApp} from '../../src/server.js';
import fixture from '../../../local-agent/workflow-engine/test/helpers/engine.js';
const {temporary,removeTemporary,startEngine}=fixture;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+40000;while(Date.now()<end){if(await check())return;await pause(100)}assert.fail('Isolated workflow stack deadline')}
const emit=(s,name,body)=>s.timeout(15000).emitWithAck(name,body);

test('isolated real stack: console pairing, local nonce ACK, attach runner restart, MV3 actions, durable history, contention and stop',{timeout:180000},async t=>{
  const dir=temporary('workflow-stack-');let core,engine,context,site,runner,ownerSocket,foreign;
  let runnerLogs='';const runnerExits=[];
  async function stopRunner(){if(!runner||runner.exitCode!==null||runner.signalCode!==null)return;const owned=runner,stopped=once(owned,'close');owned.kill('SIGTERM');const timer=setTimeout(()=>owned.kill('SIGKILL'),20000);try{await stopped}finally{clearTimeout(timer)}}
  t.after(async()=>{ownerSocket?.disconnect();foreign?.disconnect();await stopRunner();await context?.close();await engine?.close();if(site)await new Promise(r=>site.close(r));await core?.close();removeTemporary(dir)});
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'fixture-key.pem'),'-out',path.join(dir,'fixture-cert.pem'),'-days','1','-subj','/CN=fixture.test'],{stdio:'ignore',windowsHide:true});
  site=https.createServer({key:fs.readFileSync(path.join(dir,'fixture-key.pem')),cert:fs.readFileSync(path.join(dir,'fixture-cert.pem'))},(req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><input id="name"><button id="done" onclick="document.body.dataset.done=document.querySelector(\'#name\').value">Done</button><button id="late" onclick="document.body.dataset.late=\'BAD\'">Must not click</button>')});
  await new Promise(r=>site.listen(0,'127.0.0.1',r));const origin=`https://fixture.test:${site.address().port}`;
  const chrome=path.join(dir,'Chrome fixture Đường dẫn');fs.mkdirSync(chrome);fs.writeFileSync(path.join(chrome,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Fixture'}}}}));
  engine=await startEngine({directory:dir,configure({data,scenarios}){
    const sources={web:[{action:'openUrl',url:origin,settleMs:0},{action:'type',selector:'#name',text:'stack fixture',clear:true,settleMs:0},{action:'click',selector:'#done',settleMs:0}],stop:[{action:'openUrl',url:origin,settleMs:0},{action:'waitFor',selector:'#never-exists',timeoutMs:30000},{action:'click',selector:'#late',settleMs:0}]};
    for(const [id,steps]of Object.entries(sources))fs.writeFileSync(path.join(scenarios,id+'.json'),JSON.stringify({steps}));
    fs.writeFileSync(path.join(data,'workflow-policy.json'),JSON.stringify({schemaVersion:1,revision:1,profiles:[{id:'Default',allowOpen:true}],urlOrigins:[origin],scenarios:Object.keys(sources).map(id=>({id,sha256:createHash('sha256').update(fs.readFileSync(path.join(scenarios,id+'.json'))).digest('hex'),profiles:['Default'],variables:{},publicDefaults:[]}))}));
    return {LOCAL_AGENT_MODE:'integrated',CHROME_USER_DATA_DIR:chrome};
  }});
  const envFile=path.join(dir,'fixture-engine.env');fs.writeFileSync(envFile,`LOCAL_AGENT_API_TOKEN=${engine.token}\n`,{mode:0o600});
  if(process.platform==='win32'){
    const acl="$ErrorActionPreference='Stop';$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$a=[System.Security.AccessControl.FileSecurity]::new();$a.SetAccessRuleProtection($true,$false);$a.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($me,'FullControl','Allow'));Set-Acl -LiteralPath $env:WF_FIXTURE_ENV -AclObject $a";
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',acl],{stdio:'ignore',windowsHide:true,env:{SystemRoot:process.env.SystemRoot,WF_FIXTURE_ENV:envFile}});
    const addresses=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -LocalPort $env:WF_FIXTURE_PORT -State Listen -ErrorAction Stop | Select-Object -ExpandProperty LocalAddress) | ConvertTo-Json -Compress"],{encoding:'utf8',timeout:15000,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,WF_FIXTURE_PORT:new URL(engine.base).port}}));
    assert([addresses].flat().length>0&&[addresses].flat().every(ip=>ip==='127.0.0.1'),'actual engine listener must be loopback only');
  }
  core=createApp({dbPath:path.join(dir,'core.sqlite'),origin:'http://localhost:5173'});await new Promise(r=>core.http.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${core.http.address().port}`;
  const password='stack-fixture-password',owner=core.db.addUser('stack@fixture.test',password,'Fixture Owner');
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({email:'stack@fixture.test',password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const paired=await fetch(base+'/api/pairing',{method:'POST',headers:{Cookie:cookie,Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({name:'Isolated runner'})});assert.equal(paired.status,201);const code=(await paired.json()).code;
  const local=path.join(dir,'runner');fs.mkdirSync(path.join(local,'src'),{recursive:true});fs.writeFileSync(path.join(local,'package.json'),JSON.stringify({type:'module'}));
  for(const name of ['index.js','status.js','terminal.js','workflow.js','workflow-v2.js','workflow-supervisor.js','workflow-journal.js'])fs.copyFileSync(fileURLToPath(new URL('../../../local-agent/src/'+name,import.meta.url)),path.join(local,'src',name));
  fs.symlinkSync(fileURLToPath(new URL('../../../node_modules',import.meta.url)),path.join(local,'node_modules'),process.platform==='win32'?'junction':'dir');
  const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(SystemRoot|WINDIR|PATH|PATHEXT|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  function launch(pair=false){
    runner=spawn(process.execPath,[path.join(local,'src/index.js')],{cwd:local,windowsHide:true,env:{...safeEnv,SERVER_URL:base,CREDENTIALS_PATH:path.join(local,'data','credentials.json'),...(pair?{PAIR_CODE:code}:{}),AUTO_APPROVE_SESSIONS:'true',STATUS_INTERVAL_SECONDS:'5',WORKFLOW_AGENT_ENABLED:'true',WORKFLOW_AGENT_PROTOCOL:'2',WORKFLOW_AGENT_URL:engine.base,WORKFLOW_AGENT_ENV_FILE:envFile,WORKFLOW_SUPERVISOR_MODE:'attach'},stdio:['pipe','pipe','pipe']});
    runner.stdout.on('data',b=>runnerLogs+=b);runner.stderr.on('data',b=>runnerLogs+=b);runner.on('close',n=>runnerExits.push(n));if(pair)runner.stdin.write('YES\n');
  }
  ownerSocket=io(base,{autoConnect:false,transports:['websocket'],extraHeaders:{Cookie:cookie,Origin:'http://localhost:5173'}});let rows=[];ownerSocket.on('devices:snapshot',r=>rows=r);const connected=once(ownerSocket,'connect');ownerSocket.connect();await connected;
  launch(true);await until(()=>rows.some(d=>d.workflowSupported&&d.workflowHealth?.jobsVersion===1));const device=rows[0];assert.equal(device.role,'owner');
  assert.equal((await fetch(base+'/api/agents/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})})).status,401,'pair code is one use');
  let sessionId;
  async function lease(){const response=await emit(ownerSocket,'session:request',{deviceId:device.id});assert.equal(response.state,'pending',JSON.stringify(response));await until(()=>rows.find(d=>d.id===device.id)?.session?.state==='active');sessionId=core.db.lease(device.id).id;assert.equal(core.db.lease(device.id).browserId,ownerSocket.id)}
  async function operation(operation,params={},requestId=randomUUID()){const r=await emit(ownerSocket,'workflow:request',{deviceId:device.id,sessionId,operation,params,requestId});assert.equal(r.ok,true,JSON.stringify(r));return r.data}
  async function history(){const r=await fetch(`${base}/api/devices/${device.id}/workflow/jobs`,{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json()}
  await lease();
  context=await chromium.launchPersistentContext(chrome,{channel:'chromium',headless:true,ignoreHTTPSErrors:true,args:[`--disable-extensions-except=${fileURLToPath(new URL('../../../local-agent/chrome-reels-extension',import.meta.url))}`,`--load-extension=${fileURLToPath(new URL('../../../local-agent/chrome-reels-extension',import.meta.url))}`,'--host-resolver-rules=MAP fixture.test 127.0.0.1','--no-proxy-server','--ignore-certificate-errors']});
  const receipts=[];context.on('request',req=>{if(new URL(req.url()).pathname==='/result'){const r=JSON.parse(req.postData());receipts.push({ok:r.ok,settled:r.settled})}});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),options=await context.newPage();await options.goto(`chrome-extension://${worker.url().split('/')[2]}/options.html`);
  await options.locator('#port').fill(new URL(engine.base).port);await options.locator('#discover').click();await options.locator('#profile option[value=Default]').waitFor({state:'attached'});await options.locator('#profile').selectOption('Default');await options.locator('#save').click();
  await until(async()=>(await operation('profiles')).profiles[0].readiness.state==='ready');
  assert.equal((await operation('openProfile',{profile:'Default'})).state,'ready');
  const stableKey=randomUUID(),run=await operation('run',{profile:'Default',scenario:'web',variables:{}},stableKey);assert.equal(run.state,'running');
  await until(async()=>(await operation('status',{runId:run.runId})).state==='succeeded');
  const target=context.pages().find(p=>p.url().startsWith(origin));assert(target);assert.equal(await target.locator('body').getAttribute('data-done'),'stack fixture');
  assert(receipts.filter(r=>r.ok&&r.settled).length>=3,'each real browser action has a settled receipt');
  await until(async()=>(await history()).jobs.some(j=>j.jobId===run.jobId&&j.state==='succeeded'&&j.quiescent));const count=receipts.length;
  await stopRunner();assert.equal(engine.child.exitCode,null,'attach shutdown must leave engine alive');await until(()=>!core.db.lease(device.id)&&rows.find(d=>d.id===device.id)?.runnerStatus==='offline');
  launch();await until(()=>rows.find(d=>d.id===device.id)?.workflowSupported&&core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.id)?.barrier===0);await lease();
  const duplicate=await operation('run',{profile:'Default',scenario:'web',variables:{}},stableKey);assert.equal(duplicate.jobId,run.jobId);await pause(300);assert.equal(receipts.length,count,'restart/retry must not repeat browser actions');
  const waiting=await operation('run',{profile:'Default',scenario:'stop',variables:{}});await until(()=>worker.evaluate('activeJob?.stepId===1'));
  const busy=await emit(ownerSocket,'workflow:request',{deviceId:device.id,sessionId,operation:'run',params:{profile:'Default',scenario:'web',variables:{}},requestId:randomUUID()});assert.equal(busy.ok,false);assert.equal(busy.code,'BUSY');
  foreign=io(base,{autoConnect:false,transports:['websocket'],extraHeaders:{Cookie:cookie,Origin:'http://localhost:5173'}});const foreignReady=once(foreign,'connect');foreign.connect();await foreignReady;
  assert.equal((await emit(foreign,'workflow:request',{deviceId:device.id,sessionId,operation:'stop',params:{runId:waiting.runId},requestId:randomUUID()})).ok,false);
  await operation('stop',{runId:waiting.runId});
  // While the real browser settles, health can be degraded and grant-scoped
  // status is correctly unavailable. Reconcile via readonly VPS receipts.
  await until(async()=>(await history()).jobs.some(j=>j.jobId===waiting.jobId&&j.state==='cancelled'&&j.quiescent));
  assert(receipts.some(r=>!r.ok&&r.settled),'stop settles the actual pending content action');
  assert(!await target.locator('body').getAttribute('data-late'),'no next browser action after cancel');
  const released=await emit(ownerSocket,'session:release',{deviceId:device.id});assert.equal(released.ok,true);await until(()=>!core.db.lease(device.id));assert(!options.isClosed(),'release does not kill external Chrome');
  const headers={Authorization:'Bearer '+engine.token};for(const route of ['/api/v1/health','/api/run','/api/v1/runs'])assert.notEqual((await fetch(engine.base+route,{headers})).status,200,'legacy control cannot bypass integrated grant');
  const metadata=JSON.stringify(await history()),credential=JSON.parse(fs.readFileSync(path.join(local,'data','credentials.json'),'utf8')).credential;
  for(const secret of [engine.token,credential,code,dir]){assert(!runnerLogs.includes(secret),'runner logs contain no fixture secret/path');assert(!metadata.includes(secret),'VPS history contains no fixture secret/path')}
  assert(!metadata.includes('stack fixture'),'typed content is not synced to VPS metadata');assert.equal(runnerExits.length,1);
});

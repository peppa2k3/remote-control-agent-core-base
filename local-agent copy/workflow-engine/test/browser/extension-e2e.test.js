const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const https=require('node:https');
const {execFileSync}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
const {chromium}=require('playwright');
const {temporary,removeTemporary,startEngine}=require('../helpers/engine');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+40000;while(Date.now()<end){if(await check())return;await pause(100);}assert.fail('Extension E2E deadline');}

test('real unpacked MV3 extension: Options discovery/bind, heartbeat, CDP open/click/type ACK, stop and worker reconnect',async t=>{
  const dir=temporary('extension-e2e-');let engine,context,server;
  t.after(async()=>{await context?.close();await engine?.close();if(server)await new Promise(r=>server.close(r));removeTemporary(dir);});
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=fixture.test'],{stdio:'ignore',windowsHide:true});
  server=https.createServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert:fs.readFileSync(path.join(dir,'cert.pem'))},(req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><input id="name"><button id="done" onclick="document.body.dataset.done=document.querySelector(\'#name\').value">Done</button>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`https://fixture.test:${server.address().port}`;
  const userDataDir=path.join(dir,'Chrome fixture Unicode Đường dẫn');fs.mkdirSync(userDataDir);
  fs.writeFileSync(path.join(userDataDir,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Fixture'},'Profile 1':{name:'Other'}}}}));
  engine=await startEngine({directory:dir,configure({data,scenarios}){
    for(const [id,steps]of Object.entries({web:[{action:'openUrl',url:origin,settleMs:0},{action:'type',selector:'#name',text:'fixture text',clear:true,settleMs:0},{action:'click',selector:'#done',settleMs:0}],stop:[{action:'openUrl',url:origin,settleMs:0},{action:'waitFor',selector:'#never-exists',timeoutMs:15000}]}))fs.writeFileSync(path.join(scenarios,id+'.json'),JSON.stringify({steps}));
    fs.writeFileSync(path.join(data,'workflow-policy.json'),JSON.stringify({schemaVersion:1,revision:1,profiles:[{id:'Default',allowOpen:true},{id:'Profile 1',allowOpen:true}],urlOrigins:[origin],scenarios:['web','stop'].map(id=>({id,sha256:createHash('sha256').update(fs.readFileSync(path.join(scenarios,id+'.json'))).digest('hex'),profiles:['Default'],variables:{},publicDefaults:[]}))}));
    return {LOCAL_AGENT_MODE:'integrated',CHROME_USER_DATA_DIR:userDataDir};
  }});
  let h=await(await fetch(engine.base+'/api/v2/health',{headers:{Authorization:'Bearer '+engine.token}})).json();
  const grantId=randomUUID();let grant={protocolVersion:2,grantId,sessionId:randomUUID(),deviceId:randomUUID(),userId:randomUUID(),browserId:'e2e-fixture',agentInstanceId:randomUUID(),engineInstanceId:h.engineInstanceId,fence:1,seq:1,issuedAt:Date.now(),expiresAt:Date.now()+45000};
  async function api(route,body){const res=await fetch(engine.base+'/api/v2'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+engine.token,'content-type':'application/json','X-Workflow-Grant':grantId,'X-Workflow-Fence':'1','X-Workflow-Engine-Instance':h.engineInstanceId,'Idempotency-Key':randomUUID()},body:body?JSON.stringify(body):undefined});const value=await res.json();assert(res.ok,JSON.stringify(value));return value;}
  async function renew(){grant={...grant,seq:grant.seq+1,issuedAt:Date.now(),expiresAt:Date.now()+45000};const r=await fetch(engine.base+'/api/v2/grants/'+grantId,{method:'PUT',headers:{Authorization:'Bearer '+engine.token,'content-type':'application/json'},body:JSON.stringify(grant)});assert.equal(r.status,200);}
  await renew();
  const extensionPath=path.resolve(__dirname,'../../../chrome-reels-extension');
  context=await chromium.launchPersistentContext(userDataDir,{channel:'chromium',headless:true,ignoreHTTPSErrors:true,args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`,'--host-resolver-rules=MAP fixture.test 127.0.0.1','--no-proxy-server','--ignore-certificate-errors']});
  const receipts=[];context.on('request',r=>{if(new URL(r.url()).pathname==='/result'){const b=JSON.parse(r.postData());receipts.push({ok:b.ok,error:b.error,settled:b.settled});}});
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const extensionId=worker.url().split('/')[2];
  const options=await context.newPage();await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('#port').fill(new URL(engine.base).port);await options.locator('#discover').click();await options.locator('#profile option[value=Default]').waitFor({state:'attached'});await options.locator('#profile').selectOption('Default');await options.locator('#save').click();
  await until(async()=>(await api('/profiles')).profiles.find(p=>p.directory==='Default').readiness.state==='ready');
  assert.equal((await api('/profiles')).profiles.find(p=>p.directory==='Profile 1').readiness.state,'missing-extension');
  
  assert.equal((await api('/profiles/open',{profile:'Default'})).state,'ready');assert.equal((await api('/profiles/open',{profile:'Default'})).state,'ready');assert.deepEqual((await api('/runs')).runs,[]);
  const run=await api('/runs',{jobId:randomUUID(),scenario:'web',profile:'Default'});
  await until(async()=>{const value=await api('/runs/'+run.runId);if(value.state==='failed'||value.state==='unknown'){const html=await(await fetch(engine.base)).text(),token=/name="local-agent-session" content="([a-f0-9]+)"/.exec(html)[1];const detail=await(await fetch(engine.base+'/api/history/'+run.runId,{headers:{'X-Local-Agent-Session':token}})).json();assert.fail(JSON.stringify({value,detail,pages:await Promise.all(context.pages().map(async p=>({url:p.url(),text:(await p.locator('body').innerText().catch(()=>'' )).slice(0,200)})))}));}return value.state==='succeeded';});
  const target=context.pages().find(p=>p.url().startsWith(origin));assert(target);assert.equal(await target.locator('body').getAttribute('data-done'),'fixture text');
  await renew();const stopped=await api('/runs',{jobId:randomUUID(),scenario:'stop',profile:'Default'});
  await until(async()=>(await api('/runs/'+stopped.runId)).index===1&&await worker.evaluate('activeJob?.stepId===1'));
  await api('/runs/'+stopped.runId+'/stop',{jobId:randomUUID()});await until(async()=>(await api('/runs/'+stopped.runId)).quiescent);
  assert.equal((await api('/runs/'+stopped.runId)).state,'cancelled');assert(context.pages().some(p=>p.url().startsWith(origin)),'stop must not close Chrome');
  // Stop/restart the actual MV3 worker; its new identity cannot reuse a prior nonce.
  for(const page of context.pages())if(page.url().startsWith(origin))await page.close();
  await worker.evaluate(()=>chrome.alarms.clearAll());
  const cdp=await context.newCDPSession(options);const versions=[];cdp.on('ServiceWorker.workerVersionUpdated',e=>versions.push(...e.versions));await cdp.send('ServiceWorker.enable');
  await until(()=>versions.some(v=>v.scriptURL===worker.url()&&v.runningStatus==='running'));
  const version=versions.findLast(v=>v.scriptURL===worker.url()&&v.runningStatus==='running');await cdp.send('ServiceWorker.stopWorker',{versionId:version.versionId});
  await pause(10500);await renew();assert.equal((await api('/profiles')).profiles.find(p=>p.directory==='Default').readiness.state,'missing-extension');
  await options.reload();await options.locator('#save').click();await until(async()=>(await api('/profiles')).profiles.find(p=>p.directory==='Default').readiness.state==='ready');
  await cdp.detach();
  const manager=await context.newPage();await manager.goto('chrome://extensions/');
  const toggle=manager.locator('extensions-item').filter({hasText:'Local Workflow Agent Bridge'}).locator('#enableToggle');await toggle.click();
  await pause(10500);await renew();assert.equal((await api('/profiles')).profiles.find(p=>p.directory==='Default').readiness.state,'missing-extension');
  await toggle.click();await until(async()=>(await api('/profiles')).profiles.find(p=>p.directory==='Default').readiness.state==='ready');

  const revoke=await fetch(engine.base+'/api/v2/grants/'+grantId+'/revoke',{method:'POST',headers:{Authorization:'Bearer '+engine.token,'content-type':'application/json'},body:JSON.stringify({engineInstanceId:h.engineInstanceId,fence:1,reason:'release'})});assert.equal(revoke.status,200);assert.equal((await revoke.json()).quiescent,true);
  assert(context.pages().includes(manager)&&!manager.isClosed(),'lease revoke must keep Chrome alive');assert(receipts.some(r=>r.ok===false&&r.settled===true),'cancel an active action and confirm settlement');
});

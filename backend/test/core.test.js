import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';
const secret='long-test-password-123';
test('one-use pairing, authorization, pending handshake, exclusive leases and owner preemption',()=>{
 const db=new Store(':memory:');const owner=db.addUser('o@test',secret,'Owner'),op=db.addUser('p@test',secret,'Operator'),other=db.addUser('x@test',secret,'Other');
 const code=db.pair(owner,'Home PC'),d=db.enroll(code);assert.throws(()=>db.enroll(code));const expiredCode=db.pair(owner,'Expired');db.run('UPDATE pairs SET expires=0');assert.throws(()=>db.enroll(expiredCode));assert.ok(db.agent(d.credential));assert.equal(db.agent('invalid'),undefined);
 assert.throws(()=>db.request(d.deviceId,other,'b'),{status:403});
 db.run('INSERT INTO members VALUES(?,?,?)',d.deviceId,op,'viewer');assert.throws(()=>db.request(d.deviceId,op,'b'),{status:403});db.run("UPDATE members SET role='operator' WHERE userId=?",op);
 const l=db.request(d.deviceId,op,'tab1').lease;assert.equal(l.state,'pending');assert.throws(()=>db.renew(d.deviceId,op,'tab1',l.id));assert.throws(()=>db.ack(d.deviceId,l.id,'wrong',true));db.ack(d.deviceId,l.id,l.nonce,true);assert.throws(()=>db.ack(d.deviceId,l.id,l.nonce,true));assert.throws(()=>db.ack('different-device',l.id,l.nonce,true));
 assert.throws(()=>db.request(d.deviceId,owner,'tab2'),{status:409});assert.throws(()=>db.request(d.deviceId,op,'tab2',true),{status:403});
 const next=db.request(d.deviceId,owner,'tab2',true);assert.equal(next.old.id,l.id);assert.notEqual(next.lease.id,l.id);assert.throws(()=>db.renew(d.deviceId,op,'tab1',l.id));assert.throws(()=>db.ack(d.deviceId,l.id,l.nonce,true));
 db.ack(d.deviceId,next.lease.id,next.lease.nonce,false);assert.equal(db.lease(d.deviceId),null);
 const expiry=db.request(d.deviceId,owner,'tab').lease;db.run('UPDATE leases SET expires=0 WHERE id=?',expiry.id);assert.throws(()=>db.ack(d.deviceId,expiry.id,expiry.nonce,true));
 db.db.close();
});
function connected(s){return Promise.race([once(s,'connect'),once(s,'connect_error').then(([e])=>{throw e})])}
function emit(s,event,data){return new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(err,r)=>err?reject(err):resolve(r)))}
test('HTTP + realtime: pairing, membership privacy, handshake, takeover, disconnect and revoke',async t=>{
 const core=createApp({dbPath:':memory:',origin:'http://localhost:5173'});await new Promise(r=>core.http.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+core.http.address().port;const sockets=[];
 t.after(async()=>{for(const s of sockets)s.disconnect();await core.close()});
 const owner=core.db.addUser('owner@test',secret,'Owner'),op=core.db.addUser('op@test',secret,'Operator'),viewer=core.db.addUser('viewer@test',secret,'Viewer');core.db.addUser('outsider@test',secret,'Outsider');
 async function request(path,{cookie,body,method='POST',origin='http://localhost:5173'}={}){const r=await fetch(url+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const oc=(await request('/auth/login',{body:{email:'owner@test',password:secret}})).cookie,pc=(await request('/auth/login',{body:{email:'op@test',password:secret}})).cookie,vc=(await request('/auth/login',{body:{email:'viewer@test',password:secret}})).cookie,xc=(await request('/auth/login',{body:{email:'outsider@test',password:secret}})).cookie;
 assert.equal((await request('/pairing',{cookie:oc,body:{name:'Home'},origin:'http://evil.test'})).status,403);
 const code=(await request('/pairing',{cookie:oc,body:{name:'Home'}})).data.code;const d=(await request('/agents/enroll',{body:{code}})).data;assert.equal((await request('/agents/enroll',{body:{code}})).status,401);
 await request(`/devices/${d.deviceId}/members`,{cookie:oc,body:{email:'op@test',role:'operator'}});
 await request(`/devices/${d.deviceId}/members`,{cookie:oc,body:{email:'viewer@test',role:'viewer'}});
 assert.equal((await request('/devices',{cookie:xc,method:'GET'})).data.length,0);
 function sock(auth={},cookie){const s=io(url,{autoConnect:false,transports:['websocket'],auth,extraHeaders:cookie?{Cookie:cookie,Origin:'http://localhost:5173'}:{}});sockets.push(s);return s}
 const a=sock({kind:'agent',credential:d.credential}),o=sock({},oc),p=sock({},pc),v=sock({},vc),x=sock({},xc);const ps=[a,o,p,v,x].map(s=>{const wait=connected(s);s.connect();return wait});await Promise.all(ps);
 assert.equal((await emit(x,'session:request',{deviceId:d.deviceId})).status,403);
 const statusReport={cpuPercent:37.5,ramUsedBytes:600,ramTotalBytes:1000,networkRxBytesPerSecond:2048,networkTxBytesPerSecond:512,uptimeSeconds:3600};
 const ownerSnapshot=once(o,'devices:snapshot');assert.equal((await emit(a,'agent:status',statusReport)).ok,true);const [statusRows]=await ownerSnapshot;assert.deepEqual(statusRows.find(row=>row.id===d.deviceId).status,{...statusReport,updatedAt:statusRows.find(row=>row.id===d.deviceId).status.updatedAt});
 assert.deepEqual((await request('/devices',{cookie:oc,method:'GET'})).data[0].status,statusRows.find(row=>row.id===d.deviceId).status);
 assert.deepEqual((await request('/devices',{cookie:pc,method:'GET'})).data[0].status,statusRows.find(row=>row.id===d.deviceId).status);
 assert.equal((await request('/devices',{cookie:xc,method:'GET'})).data.length,0);
 assert.equal((await emit(a,'agent:status',{...statusReport,cpuPercent:101})).status,400);
 assert.equal((await emit(a,'agent:status',{...statusReport,deviceId:'another-device'})).status,400);
 assert.equal((await emit(a,'agent:status',statusReport)).status,429);
 const catalog=[{id:'workflow.run',label:'Run workflow',description:'Run configured workflow',parameters:[{name:'scenario',label:'Scenario',type:'text',required:true,maxLength:64},{name:'profile',label:'Profile',type:'choice',required:true,options:[{value:'Profile 1',label:'Profile 1'}]},{name:'variablesFile',label:'Variables file',type:'file',required:true,options:[{value:'default',label:'run-values.json'}]},{name:'wait',label:'Wait',type:'boolean',required:false}]}];
 const catalogSnapshot=once(o,'devices:snapshot');assert.equal((await emit(a,'agent:scripts',catalog)).ok,true);const [catalogRows]=await catalogSnapshot;assert.equal(catalogRows[0].scripts[0].id,'workflow.run');assert.equal('path' in catalogRows[0].scripts[0].parameters[2].options[0],false);
 let offerWait=once(a,'session:offer');const first=await emit(p,'session:request',{deviceId:d.deviceId});const [offer]=await offerWait;assert.equal(first.state,'pending');const activeWait=once(p,'session:active');assert.equal((await emit(a,'session:ack',{sessionId:offer.sessionId,nonce:offer.nonce,accept:true})).ok,true);await activeWait;
 assert.equal((await emit(v,'script:run',{deviceId:d.deviceId,sessionId:first.sessionId,scriptId:'workflow.run',params:{scenario:'my-workflow',profile:'Profile 1',variablesFile:'default'}})).status,403);
 assert.equal((await emit(o,'session:request',{deviceId:d.deviceId})).status,409);
 const oldRunEvent=new Promise(resolve=>a.once('script:run',(payload,ack)=>{ack?.({ok:true});resolve(payload)}));const oldRun=await emit(p,'script:run',{deviceId:d.deviceId,sessionId:first.sessionId,scriptId:'workflow.run',params:{scenario:'my-workflow',profile:'Profile 1',variablesFile:'default'}});assert.equal((await oldRunEvent).sessionId,first.sessionId);
 const oldJobStopping=once(p,'script:stopping'),oldJobCancelled=once(p,'script:finished'),oldJobStop=once(a,'script:stop'),revoked=once(p,'session:revoked');
 const blockedTakeover=await emit(o,'session:request',{deviceId:d.deviceId,force:true});assert.equal(blockedTakeover.status,409);await revoked;const [stoppingJob]=await oldJobStopping,[oldStop]=await oldJobStop;assert.equal(stoppingJob.jobId,oldRun.jobId);assert.equal(oldStop.jobId,oldRun.jobId);
 a.emit('script:finished',{jobId:oldRun.jobId,sessionId:first.sessionId,state:'cancelled',exitCode:null,signal:'SIGTERM',durationMs:30,reason:'owner.takeover'});const [oldFinished]=await oldJobCancelled;assert.equal(oldFinished.jobId,oldRun.jobId);assert.equal(oldFinished.state,'cancelled');
 offerWait=once(a,'session:offer');const takeover=await emit(o,'session:request',{deviceId:d.deviceId,force:true});const [newOffer]=await offerWait;assert.notEqual(takeover.sessionId,first.sessionId);
 assert.equal((await emit(p,'session:renew',{deviceId:d.deviceId,sessionId:first.sessionId})).status,403);
 await emit(a,'session:ack',{sessionId:newOffer.sessionId,nonce:newOffer.nonce,accept:true});
 const ownerRun={deviceId:d.deviceId,sessionId:takeover.sessionId,scriptId:'workflow.run',params:{scenario:'my-workflow',profile:'Profile 1',variablesFile:'default',wait:true}};
 assert.equal((await emit(x,'script:run',ownerRun)).status,403);
 assert.equal((await emit(o,'script:run',{...ownerRun,command:'node'})).status,400);
 assert.equal((await emit(o,'script:run',{...ownerRun,params:{...ownerRun.params,variablesFile:'../../private.json'}})).status,400);
 let localRun=new Promise(resolve=>a.once('script:run',(payload,ack)=>{ack?.({ok:true});resolve(payload)}));
 const startedEvent=once(o,'script:started'),outputEvent=once(o,'script:output'),finishedEvent=once(o,'script:finished');
 const firstRun=await emit(o,'script:run',ownerRun);assert.equal(firstRun.state,'starting');const dispatched=await localRun;assert.equal(dispatched.scriptId,'workflow.run');assert.deepEqual(dispatched.params,ownerRun.params);
 a.emit('script:started',{jobId:firstRun.jobId,sessionId:takeover.sessionId});const [startedJob]=await startedEvent;assert.equal(startedJob.jobId,firstRun.jobId);
 a.emit('script:output',{jobId:firstRun.jobId,sessionId:takeover.sessionId,stream:'stdout',text:'workflow output'});const [logEvent]=await outputEvent;assert.equal(logEvent.text,'workflow output');
 a.emit('script:finished',{jobId:firstRun.jobId,sessionId:takeover.sessionId,state:'completed',exitCode:0,signal:null,durationMs:25});const [doneJob]=await finishedEvent;assert.equal(doneJob.state,'completed');
 localRun=new Promise(resolve=>a.once('script:run',(payload,ack)=>{ack?.({ok:true});resolve(payload)}));const secondRun=await emit(o,'script:run',ownerRun);const secondDispatch=await localRun;
 const stopEvent=once(a,'script:stop'),stoppedBrowser=once(o,'script:finished');assert.equal((await emit(o,'script:stop',{deviceId:d.deviceId,sessionId:takeover.sessionId,jobId:secondRun.jobId})).state,'stopping');const [stopPayload]=await stopEvent;assert.equal(stopPayload.jobId,secondDispatch.jobId);
 a.emit('script:finished',{jobId:secondRun.jobId,sessionId:takeover.sessionId,state:'cancelled',exitCode:null,signal:'SIGTERM',durationMs:30,reason:'cancelled'});const [stoppedJob]=await stoppedBrowser;assert.equal(stoppedJob.state,'cancelled');
 localRun=new Promise(resolve=>a.once('script:run',(payload,ack)=>{ack?.({ok:true});resolve(payload)}));const lostRun=await emit(o,'script:run',ownerRun);await localRun;
 const offline=once(o,'session:revoked'),lostStopping=once(o,'script:stopping');a.disconnect();await offline;const [lostJobStopping]=await lostStopping;assert.equal(lostJobStopping.jobId,lostRun.jobId);assert.equal(core.db.lease(d.deviceId),null);const offlineDevice=(await request('/devices',{cookie:oc,method:'GET'})).data[0];assert.equal(offlineDevice.runnerStatus,'offline');assert.equal(offlineDevice.status,null);
 assert.equal((await emit(o,'session:request',{deviceId:d.deviceId})).status,409);
 const replacement=sock({kind:'agent',credential:d.credential}),ready=once(replacement,'agent:ready');replacement.connect();await ready;const reconciled=once(o,'script:finished');assert.equal((await emit(replacement,'agent:script-state',[])).ok,true);const [lostFinished]=await reconciled;assert.equal(lostFinished.jobId,lostRun.jobId);assert.equal(lostFinished.reason,'runner.confirmed-stopped');
 assert.equal((await emit(o,'session:request',{deviceId:d.deviceId})).state,'pending');
 const invalid=sock({kind:'agent',credential:'invalid'});const denied=once(invalid,'connect_error');invalid.connect();await denied;invalid.disconnect();
 await request(`/devices/${d.deviceId}`,{cookie:oc,method:'DELETE'});assert.equal(core.db.agent(d.credential),undefined);assert.ok(core.db.all('SELECT * FROM audit WHERE deviceId=?',d.deviceId).length>=5);
});

// Exercise the actual Local Runner executable, not only a simulated socket.
test('real Local Runner connects and auto-approves only a server-issued handshake',async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {fileURLToPath}=await import('node:url');const {spawn}=await import('node:child_process');
 const core=createApp({dbPath:':memory:',origin:'http://localhost:5173'});await new Promise(r=>core.http.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+core.http.address().port;const dir=mkdtempSync(join(tmpdir(),'rca-test-'));const owner=core.db.addUser('runner-owner@test',secret,'Owner'),d=core.db.enroll(core.db.pair(owner,'Runner executable'));
 const res=await fetch(url+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({email:'runner-owner@test',password:secret})});const cookie=res.headers.get('set-cookie').split(';')[0];
 const browser=io(url,{autoConnect:false,transports:['websocket'],extraHeaders:{Cookie:cookie,Origin:'http://localhost:5173'}});const wait=connected(browser);browser.connect();await wait;
 const file=join(dir,'credentials.json');writeFileSync(file,JSON.stringify({...d,server:url}),{mode:0o600});const workdir=join(dir,'workflow');mkdirSync(workdir);writeFileSync(join(workdir,'capture.js'),"process.stdout.write(JSON.stringify(process.argv.slice(2)))");writeFileSync(join(workdir,'run-values.json'),'{}');
 const manifest=join(dir,'scripts.json');writeFileSync(manifest,JSON.stringify({scripts:[{id:'workflow.run',label:'Run workflow',description:'',executable:process.execPath,cwd:'./workflow',args:['capture.js','run'],timeoutSeconds:30,parameters:[{name:'scenario',label:'Scenario',type:'text',required:true,maxLength:64,flag:'--scenario'},{name:'profile',label:'Profile',type:'choice',required:true,flag:'--profile',options:[{value:'Profile 1',label:'Profile 1'}]},{name:'variablesFile',label:'Variables file',type:'file',required:true,flag:'--variables-file',options:[{value:'default',label:'run-values.json',path:'run-values.json'}]},{name:'wait',label:'Wait',type:'boolean',required:false,flag:'--wait'}]}]}));let child;
 t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit}browser.disconnect();await core.close();rmSync(dir,{recursive:true,force:true})});
 const online=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Runner did not connect')),5000);browser.on('devices:snapshot',rows=>{if(rows.some(v=>v.id===d.deviceId&&v.runnerStatus==='online')){clearTimeout(timeout);resolve()}})});
 const statusReported=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Runner did not report device status')),15000);browser.on('devices:snapshot',rows=>{const device=rows.find(v=>v.id===d.deviceId);if(device?.status){clearTimeout(timeout);resolve(device.status)}})});
 const scriptsReady=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Runner did not publish its script allowlist')),5000);browser.on('devices:snapshot',rows=>{const device=rows.find(v=>v.id===d.deviceId);if(device?.scripts?.some(script=>script.id==='workflow.run')){clearTimeout(timeout);resolve()}})});
 child=spawn(process.execPath,[fileURLToPath(new URL('../../local-agent/src/index.js',import.meta.url))],{env:{...process.env,SERVER_URL:url,CREDENTIALS_PATH:file,SCRIPTS_PATH:manifest,AUTO_APPROVE_SESSIONS:'true',STATUS_INTERVAL_SECONDS:'5'},stdio:['ignore','ignore','pipe']});
 await Promise.all([online,statusReported,scriptsReady]);const active=once(browser,'session:active');const result=await emit(browser,'session:request',{deviceId:d.deviceId});assert.equal(result.state,'pending');const [session]=await active;assert.equal(core.db.lease(d.deviceId).id,session.sessionId);assert.equal(core.db.lease(d.deviceId).state,'active');
 const scriptStarted=once(browser,'script:started'),scriptOutput=once(browser,'script:output'),scriptFinished=once(browser,'script:finished');
 const run=await emit(browser,'script:run',{deviceId:d.deviceId,sessionId:session.sessionId,scriptId:'workflow.run',params:{scenario:'my-workflow',profile:'Profile 1',variablesFile:'default',wait:true}});assert.equal(run.state,'starting');
 const [started]=await scriptStarted,[output]=await scriptOutput,[finished]=await scriptFinished;assert.equal(started.jobId,run.jobId);assert.deepEqual(JSON.parse(output.text),['run','--scenario','my-workflow','--profile','Profile 1','--variables-file','run-values.json','--wait']);assert.equal(finished.state,'completed');assert.equal(finished.exitCode,0);
 const revoked=once(browser,'session:revoked');const exit=once(child,'exit');child.kill('SIGTERM');await Promise.all([revoked,exit]);assert.equal(core.db.lease(d.deviceId),null);
});

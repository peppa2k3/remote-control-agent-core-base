import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {io} from 'socket.io-client';
import {Store} from '../src/store.js';
import helper from '../../local-agent/workflow-engine/test/helpers/engine.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await pause(40);}assert.fail('Backend crash fixture deadline');}

test('killed backend process recovers committed dispatch as unknown, removes lease and never replays under reconnect',async t=>{
  const dir=helper.temporary('backend-job-crash-'),dbPath=join(dir,'core.sqlite'),db=new Store(dbPath),password='crash-fixture-password',owner=db.addUser('crash@test',password,'Owner'),device=db.enroll(db.pair(owner,'Fixture'));db.db.close();
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`;
  let child,agent,browser;const sockets=[];t.after(async()=>{for(const s of sockets)s.disconnect();if(child?.exitCode===null&&child?.signalCode===null){const done=once(child,'close');child.kill('SIGKILL');await done;}helper.removeTemporary(dir);});
  async function boot(){const env={DB_PATH:dbPath,HOST:'127.0.0.1',PORT:String(port),PUBLIC_ORIGIN:'http://localhost:5173'};for(const k of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP','HOME','USERPROFILE'])if(process.env[k])env[k]=process.env[k];child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.js',import.meta.url))],{cwd:dir,env,windowsHide:true,stdio:'ignore'});await until(async()=>{try{return (await fetch(base+'/api/health',{signal:AbortSignal.timeout(300)})).ok;}catch{return false;}});}
  await boot();const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost:5173','content-type':'application/json'},body:JSON.stringify({email:'crash@test',password})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const cap={protocolVersion:2,jobsVersion:1,agentInstanceId:randomUUID(),engineInstanceId:randomUUID(),engineVersion:'0.5.0',mode:'integrated',operations:['profiles','scenarios','describe','runs','status','run','stop','openProfile'],policyRevision:1,health:{state:'ready',reasonCode:'READY',checkedAt:Date.now()}};
  let dispatched=0,jobId;
  async function connect(){agent=io(base,{autoConnect:false,transports:['websocket'],auth:{kind:'agent',credential:device.credential}});browser=io(base,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:'http://localhost:5173',Cookie:cookie}});sockets.push(agent,browser);
    agent.on('session:offer',p=>agent.emit('session:ack',{sessionId:p.sessionId,nonce:p.nonce,accept:true},()=>{}));agent.on('workflow:v2:grant',(p,ack)=>ack({ok:true,grantId:p.grantId,fence:p.fence,seq:p.seq,state:'active'}));agent.on('workflow:v2:revoke',(p,ack)=>ack({ok:true,grantId:p.grantId,fence:p.fence,state:'revoked',quiescent:false}));agent.on('workflow:v2:dispatch',p=>{dispatched++;jobId=p.jobId;});
    for(const s of [agent,browser]){const ready=once(s,'connect');s.connect();await ready;}assert.equal((await agent.timeout(3000).emitWithAck('workflow:v2:capabilities',cap)).ok,true);
  }
  await connect();const active=once(agent,'session:active');await browser.timeout(3000).emitWithAck('session:request',{deviceId:device.deviceId});const [lease]=await active;
  browser.emit('workflow:v2:request',{deviceId:device.deviceId,sessionId:lease.sessionId,operation:'run',params:{scenario:'wait',profile:'Default'},requestId:'crash-key'},()=>{});await until(()=>dispatched===1);
  const done=once(child,'close');child.kill('SIGKILL');await done;agent.disconnect();browser.disconnect();await boot();cap.agentInstanceId=randomUUID();await connect();
  const history=await fetch(base+'/api/devices/'+device.deviceId+'/workflow/jobs/'+jobId,{headers:{Cookie:cookie}});assert.equal(history.status,200);assert.equal((await history.json()).job.state,'unknown');
  const result=await browser.timeout(3000).emitWithAck('session:request',{deviceId:device.deviceId});assert.equal(result.status,409,JSON.stringify(result));await pause(2200);assert.equal(dispatched,1);
});

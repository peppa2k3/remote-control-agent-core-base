import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {io} from 'socket.io-client';
import {createWorkflowJobs} from '../src/workflow-jobs.js';
import {createApp} from '../src/server.js';
import {bindWorkflowV2Socket,createWorkflowV2Client} from '../../local-agent/src/workflow-v2.js';
import {createWorkflowJournal} from '../../local-agent/src/workflow-journal.js';
import helper from '../../local-agent/workflow-engine/test/helpers/engine.js';
const {temporary,removeTemporary,startEngine}=helper;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await pause(40);}assert.fail('Jobs sync fixture deadline');}
const emit=(s,e,p)=>s.timeout(15000).emitWithAck(e,p);

test('real durable pipeline: HTTP response lost, committed report ACK lost, duplicate key, cancel and backend/adapter restart without replay',async t=>{
  const dir=temporary('jobs-sync-'),engine=await startEngine({directory:dir,configure({data,scenarios}){fs.writeFileSync(path.join(data,'workflow-policy.json'),JSON.stringify({schemaVersion:1,revision:1,profiles:[{id:'Default',allowOpen:false}],scenarios:[{id:'wait',sha256:createHash('sha256').update(fs.readFileSync(path.join(scenarios,'wait.json'))).digest('hex'),profiles:['Default'],variables:{delay:{type:'integer',minimum:1,maximum:30000},secret:{type:'string',maxLength:100}},publicDefaults:[]}]}));return {LOCAL_AGENT_MODE:'integrated'};}});
  const dbPath=path.join(dir,'core.sqlite');let core=createApp({dbPath,origin:'http://localhost:5173'});await new Promise(r=>core.http.listen(0,'127.0.0.1',r));const port=core.http.address().port,base=`http://127.0.0.1:${port}`;
  const password='jobs-fixture-password-123',owner=core.db.addUser('owner@jobs.test',password,'Owner'),viewer=core.db.addUser('viewer@jobs.test',password,'Viewer'),device=core.db.enroll(core.db.pair(owner,'Fixture'));core.db.run('INSERT INTO members VALUES(?,?,?)',device.deviceId,viewer,'viewer');
  let agent,browser,binding,journal,active=null,beat,posts=0,dropHTTP=true,dropACK=true;const sockets=[];
  t.after(async()=>{clearInterval(beat);await binding?.close();for(const s of sockets)s.disconnect();await pause(100);journal?.close();await core.close();await engine.close();removeTemporary(dir);});
  async function login(email){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost:5173','content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
  const cookie=await login('owner@jobs.test'),viewerCookie=await login('viewer@jobs.test');
  async function connect(){
    active=null;agent=io(base,{autoConnect:false,transports:['websocket'],auth:{kind:'agent',credential:device.credential}});sockets.push(agent);
    agent.on('session:active',p=>active=p);agent.on('session:revoked',()=>active=null);agent.on('session:offer',p=>agent.emit('session:ack',{sessionId:p.sessionId,nonce:p.nonce,accept:true},()=>{}));
    const original=agent.emitWithAck.bind(agent);agent.emitWithAck=async(event,...args)=>{const ack=await original(event,...args);if(event==='workflow:v2:report'&&dropACK){dropACK=false;throw Error('fixture ACK lost after commit');}return ack;};
    journal=createWorkflowJournal(path.join(dir,'journal.sqlite'));
    binding=bindWorkflowV2Socket({socket:agent,getSession:()=>active,journal,deviceId:device.deviceId,syncIntervalMs:50,client:createWorkflowV2Client({settings:()=>({enabled:true,baseUrl:engine.base,token:engine.token}),fetchImpl:async(url,options)=>{const r=await fetch(url,options);if(options.method==='POST'&&new URL(url).pathname==='/api/v2/jobs'){posts++;if(dropHTTP&&r.ok){dropHTTP=false;await r.arrayBuffer();throw Error('fixture HTTP response lost after execution');}}return r;}})});
    browser=io(base,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:'http://localhost:5173',Cookie:cookie}});sockets.push(browser);
    for(const s of [agent,browser]){const ready=once(s,'connect');s.connect();await ready;}await binding.publish();await pause(80);beat=setInterval(()=>agent.emit('agent:heartbeat',{},()=>{}),1000);
  }
  await connect();
  async function lease(){const r=await emit(browser,'session:request',{deviceId:device.deviceId});assert.equal(r.ok,true,JSON.stringify(r));await until(()=>active);return active.sessionId;}
  let sessionId=await lease();const params={scenario:'wait',profile:'Default',variables:{delay:1500,secret:'NEVER_SYNC_VARIABLE'}},request=()=>emit(browser,'workflow:v2:request',{deviceId:device.deviceId,sessionId,operation:'run',params,requestId:'durable-key'});
  assert.equal((await request()).ok,false,'lost HTTP reply is not treated as execution failure');
  const row=()=>core.db.one('SELECT * FROM workflow_jobs WHERE requestId=?','durable-key');await until(()=>row()?.state==='succeeded');assert.equal(posts,1);assert.equal((await request()).data.jobId,row().jobId);assert.equal(posts,1);
  assert.equal(dropACK,false);await until(()=>journal.pending(device.deviceId).length===0);
  const conflicting=await emit(browser,'workflow:v2:request',{deviceId:device.deviceId,sessionId,operation:'run',params:{...params,variables:{delay:1}},requestId:'durable-key'});assert.equal(conflicting.code,'IDEMPOTENCY_CONFLICT');
  const history=await fetch(base+'/api/devices/'+device.deviceId+'/workflow/jobs',{headers:{Cookie:viewerCookie}});assert.equal(history.status,200);assert(!JSON.stringify(await history.json()).includes('NEVER_SYNC_VARIABLE'));assert(!JSON.stringify(core.db.all('SELECT * FROM workflow_jobs')).includes('NEVER_SYNC_VARIABLE'));
  const second=await emit(browser,'workflow:v2:request',{deviceId:device.deviceId,sessionId,operation:'run',params:{...params,variables:{delay:20000}},requestId:'cancel-key'});assert.equal(second.ok,true,JSON.stringify(second));const cancelled=core.db.one('SELECT * FROM workflow_jobs WHERE requestId=?','cancel-key');
  assert.equal((await emit(browser,'workflow:v2:cancel',{deviceId:device.deviceId,sessionId,jobId:cancelled.jobId})).ok,true);await until(()=>core.db.one('SELECT state,quiescent FROM workflow_jobs WHERE jobId=?',cancelled.jobId)?.quiescent===1);
  assert.equal(core.db.one('SELECT state FROM workflow_jobs WHERE jobId=?',cancelled.jobId).state,'cancelled');
  const priorGrant=JSON.parse(core.db.one('SELECT grantJson FROM workflow_control WHERE deviceId=?',device.deviceId).grantJson);
  clearInterval(beat);await binding.close();agent.disconnect();browser.disconnect();await pause(100);
  const ledger=createWorkflowJobs(core.db,{recover:false}),beforeDelivery=ledger.accept({deviceId:device.deviceId,userId:owner,browserId:browser.id||'closed-browser',sessionId,requestId:'crash-before-http',operation:'run',params,deadline:Date.now()+10000}).job;ledger.dispatch(beforeDelivery.jobId,priorGrant);
  journal.accept({jobId:beforeDelivery.jobId,requestId:'crash-before-http',operation:'run',params,grantId:priorGrant.grantId,fence:priorGrant.fence,engineInstanceId:priorGrant.engineInstanceId},priorGrant);
  journal.close();await core.close();
  core=createApp({dbPath,origin:'http://localhost:5173'});await new Promise(r=>core.http.listen(port,'127.0.0.1',r));await connect();assert.equal(core.db.lease(device.deviceId),null);await until(()=>core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId)?.barrier===0);
  await until(()=>core.db.one('SELECT state FROM workflow_jobs WHERE jobId=?',beforeDelivery.jobId)?.state==='cancelled');
  sessionId=await lease();const again=await request();assert.equal(again.ok,true,JSON.stringify(again));assert.equal(posts,2,'neither duplicate nor restart may submit the old command again');
  core.db.run('DELETE FROM members WHERE deviceId=? AND userId=?',device.deviceId,viewer);assert.equal((await fetch(base+'/api/devices/'+device.deviceId+'/workflow/jobs',{headers:{Cookie:viewerCookie}})).status,403);
});

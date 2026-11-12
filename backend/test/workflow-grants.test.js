import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {io} from 'socket.io-client';
import {createApp} from '../src/server.js';
import {bindWorkflowV2Socket,createWorkflowV2Client} from '../../local-agent/src/workflow-v2.js';
import fixture from '../../local-agent/workflow-engine/test/helpers/engine.js';
const {temporary,removeTemporary,startEngine}=fixture;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<120;i++){if(await check())return;await pause(50);}assert.fail('Timed out waiting for verified workflow state');}
const emit=(s,event,p)=>s.timeout(15000).emitWithAck(event,p);

test('real core + adapter + integrated engine: policy, user/browser lease, takeover barrier, disconnect and membership revoke',async t=>{
  const directory=temporary('core-grant-e2e-');
  const engine=await startEngine({directory,configure({data,scenarios}){
    const file=path.join(scenarios,'wait.json');const source=JSON.parse(fs.readFileSync(file));source.variables.private='never-relay-this';fs.writeFileSync(file,JSON.stringify(source));
    const web=path.join(scenarios,'web.json');fs.writeFileSync(web,JSON.stringify({variables:{delay:10},steps:[{action:'openUrl',url:'https://example.test/'},{action:'click',selector:'#never-after-revoke'}]}));
    const rule=id=>({id,sha256:createHash('sha256').update(fs.readFileSync(path.join(scenarios,id+'.json'))).digest('hex'),profiles:['Default'],variables:{delay:{type:'integer',minimum:1,maximum:10000}},publicDefaults:['delay']});
    fs.writeFileSync(path.join(data,'workflow-policy.json'),JSON.stringify({schemaVersion:1,revision:1,profiles:[{id:'Default',allowOpen:false}],urlOrigins:['https://example.test'],scenarios:[rule('wait'),rule('web')]}));
    return {LOCAL_AGENT_MODE:'integrated'};
  }});
  const core=createApp({dbPath:':memory:',origin:'http://localhost:5173'});await new Promise(resolve=>core.http.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${core.http.address().port}`,sockets=[];let binding,beat;
  t.after(async()=>{clearInterval(beat);await binding?.close();for(const s of sockets)s.disconnect();await core.close();await engine.close();removeTemporary(directory);});
  const password='grant-fixture-password-123',owner=core.db.addUser('grant-owner@test',password,'Owner'),operator=core.db.addUser('grant-operator@test',password,'Operator'),viewer=core.db.addUser('grant-viewer@test',password,'Viewer');
  const device=core.db.enroll(core.db.pair(owner,'Fixture'));core.db.run('INSERT INTO members VALUES(?,?,?)',device.deviceId,operator,'operator');core.db.run('INSERT INTO members VALUES(?,?,?)',device.deviceId,viewer,'viewer');
  async function browser(email){const response=await fetch(url+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost:5173','content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];const socket=io(url,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:'http://localhost:5173',Cookie:cookie}});return {socket,cookie};}
  const own=await browser('grant-owner@test'),op=await browser('grant-operator@test'),view=await browser('grant-viewer@test'),other=await browser('grant-operator@test');
  const agent=io(url,{autoConnect:false,transports:['websocket'],auth:{kind:'agent',credential:device.credential}});let active=null,seen;
  agent.on('session:active',p=>{active=p;});agent.on('session:revoked',()=>{active=null;});agent.on('disconnect',()=>{active=null;});
  let dropRunResponse=false;
  binding=bindWorkflowV2Socket({socket:agent,getSession:()=>active,client:createWorkflowV2Client({settings:()=>({enabled:true,baseUrl:engine.base,token:engine.token}),fetchImpl:async(url,options)=>{const response=await fetch(url,options);if(dropRunResponse&&options.method==='POST'&&new URL(url).pathname==='/api/v2/runs'&&response.status===202){dropRunResponse=false;await response.arrayBuffer();throw new Error('fixture response lost after acceptance');}return response;}})});
  own.socket.on('devices:snapshot',snapshot=>{seen=snapshot.find(d=>d.id===device.deviceId);});
  for(const socket of [agent,own.socket,op.socket,view.socket,other.socket]){sockets.push(socket);const ready=once(socket,'connect');socket.connect();await ready;}
  beat=setInterval(()=>agent.emit('agent:heartbeat',{},()=>{}),1000);
  await until(()=>seen?.workflowSupported);
  async function lease(socket,force=false){const offered=once(agent,'session:offer');const result=await emit(socket,'session:request',{deviceId:device.deviceId,force});assert.equal(result.ok,true,JSON.stringify(result));const [p]=await offered;await emit(agent,'session:ack',{sessionId:p.sessionId,nonce:p.nonce,accept:true});await until(()=>active?.sessionId===p.sessionId);return p.sessionId;}
  let sessionId=await lease(op.socket);
  const request=(socket,operation,params={},requestId)=>emit(socket,'workflow:request',{deviceId:device.deviceId,sessionId,operation,params,...(requestId?{requestId}:{})});
  assert.equal((await request(view.socket,'scenarios')).status,403);assert.equal((await request(other.socket,'scenarios')).status,403);
  assert.equal((await request(op.socket,'run',{scenario:'wait',profile:'Default',uploadPath:'C:/arbitrary'},'invalid')).status,400);
  const describe=await request(op.socket,'describe',{scenario:'wait'});assert.equal(describe.ok,true,JSON.stringify(describe));assert.deepEqual(describe.data.variables,{delay:20});assert(!JSON.stringify(describe).includes('never-relay-this'));
  assert.equal((await request(op.socket,'run',{scenario:'not-allowed',profile:'Default'},'denied')).status,403);
  assert.equal((await request(op.socket,'run',{scenario:'wait',profile:'Default',variables:{delay:10001}},'denied-value')).status,403);
  const first=await request(op.socket,'run',{scenario:'wait',profile:'Default',variables:{delay:10000}},'run-stable-key');assert.equal(first.ok,true,JSON.stringify(first));
  const duplicate=await request(op.socket,'run',{scenario:'wait',profile:'Default',variables:{delay:10000}},'run-stable-key');assert.equal(duplicate.data.runId,first.data.runId);
  const renewed=await emit(op.socket,'session:renew',{deviceId:device.deviceId,sessionId});assert.equal(renewed.ok,true);
  const takeover=await emit(own.socket,'session:request',{deviceId:device.deviceId,force:true});assert.equal(takeover.status,409);
  await until(()=>core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId)?.barrier===0);
  sessionId=await lease(own.socket);assert.equal((await request(op.socket,'scenarios')).status,403);
  const history=await request(own.socket,'runs');assert.equal(history.ok,true);assert.equal(history.data.runs.find(r=>r.runId===first.data.runId).state,'cancelled');
  dropRunResponse=true;
  assert.equal((await request(own.socket,'run',{scenario:'wait',profile:'Default',variables:{delay:10000}},'lost-response')).status,503);
  const unknownRun=(await request(own.socket,'runs')).data.runs.find(r=>r.state==='running');assert(unknownRun,'engine accepted the run before the response was lost');
  await emit(own.socket,'session:release',{deviceId:device.deviceId});
  await until(()=>core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId).barrier===0);
  sessionId=await lease(own.socket);
  assert.equal((await request(own.socket,'status',{runId:unknownRun.runId})).data.state,'cancelled','revoke stops accepted runs without a returned runId');
  // Real engine/HTTP with an extension protocol fixture, no logged-in Chrome.
  async function local(route,body){return (await fetch(engine.base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:'Default',clientId:'fixture-extension',settlementVersion:1,...body})})).json();}
  await local('/state',{});
  const web=await request(own.socket,'run',{scenario:'web',profile:'Default'},'web-key');assert.equal(web.ok,true,JSON.stringify(web));
  const step=await local('/next',{});assert.equal(step.step.action,'openUrl');
  assert.equal((await emit(own.socket,'session:request',{deviceId:device.deviceId,force:true})).status,409);
  await pause(300);assert.equal(core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId).barrier,1);
  await local('/result',{runId:step.runId,id:step.step.id,ok:true,settled:true});
  await until(()=>core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId).barrier===0);
  sessionId=await lease(op.socket);
  const run=await request(op.socket,'run',{scenario:'wait',profile:'Default',variables:{delay:10000}},'membership-run');assert.equal(run.ok,true);
  const removed=await fetch(url+`/api/devices/${device.deviceId}/members/${operator}`,{method:'DELETE',headers:{Origin:'http://localhost:5173',Cookie:own.cookie}});assert.equal(removed.status,200);
  await until(()=>core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId).barrier===0);
  assert.equal((await request(op.socket,'status',{runId:run.data.runId})).status,403);
  sessionId=await lease(own.socket);
  const expired=await request(own.socket,'run',{scenario:'wait',profile:'Default',variables:{delay:10000}},'expired-run');assert.equal(expired.ok,true);
  core.db.run('UPDATE leases SET expires=? WHERE deviceId=?',Date.now()-1,device.deviceId);
  assert.equal((await request(own.socket,'status',{runId:expired.data.runId})).status,403,'expired lease is rejected before the sweep');
  await until(()=>core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId).barrier===0);
  sessionId=await lease(own.socket);
  const disconnected=await request(own.socket,'run',{scenario:'wait',profile:'Default',variables:{delay:10000}},'disconnect-run');assert.equal(disconnected.ok,true);
  agent.disconnect();await until(()=>!core.db.lease(device.deviceId));
  const html=await(await fetch(engine.base)).text(),dashboard=/name="local-agent-session" content="([a-f0-9]+)"/.exec(html)[1];
  await until(async()=>{const status=await(await fetch(engine.base+'/api/history/'+disconnected.data.runId,{headers:{'x-local-agent-session':dashboard}})).json();return status.state==='cancelled';});
  assert.equal(core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId).barrier,1,'offline barrier cannot be cleared by an unauthenticated receipt');
  let connected=once(agent,'connect');agent.connect();await connected;
  await until(()=>core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId).barrier===0);
  sessionId=await lease(own.socket);
  const browserLost=await request(own.socket,'run',{scenario:'wait',profile:'Default',variables:{delay:10000}},'browser-disconnect');assert.equal(browserLost.ok,true);
  own.socket.disconnect();await until(()=>!core.db.lease(device.deviceId));
  await until(()=>core.db.one('SELECT barrier FROM workflow_control WHERE deviceId=?',device.deviceId).barrier===0);
  connected=once(own.socket,'connect');own.socket.connect();await connected;sessionId=await lease(own.socket);
  const deviceLost=await request(own.socket,'run',{scenario:'wait',profile:'Default',variables:{delay:10000}},'device-revoked');assert.equal(deviceLost.ok,true);
  const deletion=await fetch(url+'/api/devices/'+device.deviceId,{method:'DELETE',headers:{Origin:'http://localhost:5173',Cookie:own.cookie}});assert.equal(deletion.status,200);
  await until(async()=>{const status=await(await fetch(engine.base+'/api/history/'+deviceLost.data.runId,{headers:{'x-local-agent-session':dashboard}})).json();return status.state==='cancelled';});
  assert.equal(core.db.one('SELECT revoked FROM devices WHERE id=?',device.deviceId).revoked,1);
});

test('backend restart deletes leases but preserves fencing and unresolved workflow barriers',async t=>{
  const directory=temporary('workflow-backend-restart-');const dbPath=path.join(directory,'core.sqlite');
  let core=createApp({dbPath});
  t.after(async()=>{await core.close();removeTemporary(directory);});
  const owner=core.db.addUser('restart@test','fixture-long-password','Owner'),device=core.db.enroll(core.db.pair(owner,'Fixture'));
  const lease=core.db.request(device.deviceId,owner,'fixture-browser').lease;core.db.ack(device.deviceId,lease.id,lease.nonce,true);
  const grant={grantId:randomUUID(),sessionId:lease.id,fence:17};core.db.run('INSERT INTO workflow_control VALUES(?,?,?,?)',device.deviceId,17,JSON.stringify(grant),1);
  await core.close();core=createApp({dbPath});
  assert.equal(core.db.lease(device.deviceId),null);const row=core.db.one('SELECT * FROM workflow_control WHERE deviceId=?',device.deviceId);assert.equal(row.fence,17);assert.equal(row.barrier,1);assert.equal(JSON.parse(row.grantJson).grantId,grant.grantId);
});

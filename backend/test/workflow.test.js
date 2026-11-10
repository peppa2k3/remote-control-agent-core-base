import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.js';
import {bindWorkflowSocket,createWorkflowClient} from '../../local-agent/src/workflow.js';

const emit=(socket,event,payload)=>socket.timeout(4000).emitWithAck(event,payload);
test('workflow travels browser → authenticated VPS → leased local runner → loopback API',async t=>{
  const token='fixture-workflow-token-32-characters',requests=[];
  let releaseHeld,markHeld;
  const heldArrived=new Promise(resolve=>{markHeld=resolve;});
  const heldResponse=new Promise(resolve=>{releaseHeld=resolve;});
  const run={runId:randomUUID(),state:'running',profile:'Default',scenario:'fixture'};
  const engine=createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,`Bearer ${token}`);
    let raw='';for await(const chunk of req)raw+=chunk;
    requests.push({url:req.url,body:raw?JSON.parse(raw):null,key:req.headers['idempotency-key']});
    res.setHeader('content-type','application/json');
    if(req.url==='/api/v1/scenarios/held'){markHeld();await heldResponse;res.end(JSON.stringify({variables:{private:'do-not-return-after-revoke'}}));return;}
    if(req.url==='/api/v1/scenarios')res.end(JSON.stringify({names:['fixture']}));
    else if(req.url.endsWith('/stop'))res.end(JSON.stringify({...run,state:'cancelled'}));
    else res.end(JSON.stringify(run));
  });
  await new Promise(r=>engine.listen(0,'127.0.0.1',r));
  const core=createApp({dbPath:':memory:',origin:'http://localhost:5173'});
  await new Promise(r=>core.http.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${core.http.address().port}`,sockets=[];
  t.after(async()=>{for(const socket of sockets)socket.disconnect();await core.close();await new Promise(r=>{engine.close(r);engine.closeAllConnections();});});
  const password='workflow-test-password-123',owner=core.db.addUser('workflow-owner@test',password,'Owner'),viewer=core.db.addUser('workflow-viewer@test',password,'Viewer');
  const device=core.db.enroll(core.db.pair(owner,'Fixture'));
  core.db.run('INSERT INTO members VALUES(?,?,?)',device.deviceId,viewer,'viewer');
  async function browser(email){const response=await fetch(url+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost:5173','content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(response.status,200);return io(url,{autoConnect:false,transports:['websocket'],extraHeaders:{Origin:'http://localhost:5173',Cookie:response.headers.get('set-cookie').split(';')[0]}});}
  const agent=io(url,{autoConnect:false,transports:['websocket'],auth:{kind:'agent',credential:device.credential}}),web=await browser('workflow-owner@test'),otherBrowser=await browser('workflow-owner@test'),view=await browser('workflow-viewer@test');
  let lease=null;
  agent.on('session:active',payload=>{lease=payload;});agent.on('session:revoked',()=>{lease=null;});
  const client=createWorkflowClient({settings:()=>({enabled:true,token,baseUrl:`http://127.0.0.1:${engine.address().port}`})});
  bindWorkflowSocket({socket:agent,getSession:()=>lease,client});
  for(const socket of [agent,web,otherBrowser,view]){sockets.push(socket);const ready=once(socket,'connect');socket.connect();await ready;}
  await emit(agent,'agent:workflow-capabilities',client.capabilities());
  const payload={deviceId:device.deviceId,sessionId:randomUUID(),operation:'scenarios',params:{}};
  assert.equal((await emit(web,'workflow:request',payload)).status,403);
  const offer=once(agent,'session:offer');await emit(web,'session:request',{deviceId:device.deviceId});const [pending]=await offer;
  const activated=once(agent,'session:active');await emit(agent,'session:ack',{sessionId:pending.sessionId,nonce:pending.nonce,accept:true});await activated;
  payload.sessionId=pending.sessionId;
  assert.equal((await emit(otherBrowser,'workflow:request',payload)).status,403);
  assert.equal((await emit(view,'workflow:request',payload)).status,403);
  assert.deepEqual((await emit(web,'workflow:request',payload)).data,{names:['fixture']});
  const start={...payload,operation:'run',params:{scenario:'fixture',profile:'Default',variables:{caption:'Tiếng Việt'}},requestId:'stable-request'};
  assert.equal((await emit(web,'workflow:request',start)).data.runId,run.runId);
  assert.equal(requests.at(-1).key,'stable-request');assert.equal(requests.at(-1).body.variables.caption,'Tiếng Việt');
  assert.equal((await emit(web,'workflow:request',{...start,params:{...start.params,command:'whoami'}})).status,400);
  assert.equal((await emit(web,'workflow:request',{...start,params:{...start.params,uploadPath:'C:/private'}})).status,400);
  assert.equal((await emit(web,'workflow:request',{...payload,operation:'stop',params:{runId:run.runId}})).data.state,'cancelled');
  const waiting=emit(web,'workflow:request',{...payload,operation:'describe',params:{scenario:'held'}});
  await heldArrived;
  await emit(web,'session:release',{deviceId:device.deviceId});
  releaseHeld();
  const denied=await waiting;assert.equal(denied.status,403);assert.equal(Object.hasOwn(denied,'data'),false,'revoked browser never receives an in-flight response');
  const count=requests.length;assert.equal((await emit(web,'workflow:request',start)).status,403);assert.equal(requests.length,count);
  assert(core.db.all('SELECT event FROM audit WHERE deviceId=?',device.deviceId).some(row=>row.event==='workflow.run'));
});

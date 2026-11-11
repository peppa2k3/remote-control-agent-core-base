import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readWorkflowSettings,createWorkflowClient,bindWorkflowSocket} from '../src/workflow.js';
import {runWorkflowCli} from '../src/workflow-cli.js';

const token='workflow-test-token-with-32-characters';
test('workflow configuration uses local files from any cwd without returning secrets',()=>{
  const directory=mkdtempSync(join(tmpdir(),'workflow-env-'));
  try {
    writeFileSync(join(directory,'engine.env'),`LOCAL_AGENT_API_TOKEN=${token}\nLOCAL_AGENT_PORT=34999\n`);
    writeFileSync(join(directory,'.env'),'WORKFLOW_AGENT_ENV_FILE=engine.env\nSERVER_URL=https://vps.example\n');
    const settings=readWorkflowSettings({directory,env:{}});
    assert.equal(settings.token,token);assert.equal(settings.baseUrl,'http://127.0.0.1:34999');
    const client=createWorkflowClient({settings:()=>settings});
    assert.equal(client.capabilities().configured,true);assert(!JSON.stringify(client.capabilities()).includes(token));
    for(const baseUrl of ['https://vps.example','http://localhost:34719','http://user:password@127.0.0.1:34719','http://127.0.0.1:34719/api']) assert.equal(createWorkflowClient({settings:()=>({...settings,baseUrl})}).capabilities().configured,false);
    assert.equal(readWorkflowSettings({directory,env:{LOCAL_AGENT_API_TOKEN:'shell-token'}}).token,'shell-token');
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('HTTP client supplies auth/idempotency, validates requests, refuses redirects and redacts token',async t=>{
  const received=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    received.push({url:req.url,auth:req.headers.authorization,key:req.headers['idempotency-key'],body});
    res.setHeader('content-type','application/json');
    if(req.url.endsWith('/scenarios')){res.statusCode=401;res.end(JSON.stringify({error:token}));}
    else if(req.url.includes('/scenarios/redirect')){res.writeHead(302,{location:'http://127.0.0.1:1'});res.end();}
    else res.end(JSON.stringify({runId:randomUUID(),state:'running'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const client=createWorkflowClient({settings:()=>({enabled:true,token,baseUrl:`http://127.0.0.1:${server.address().port}`})});
  await client.request('run',{scenario:'fixture',profile:'Profile 1',variables:{title:'Tiếng Việt'}},{requestId:'same-request'});
  assert.equal(received[0].auth,`Bearer ${token}`);assert.equal(received[0].key,'same-request');assert.equal(JSON.parse(received[0].body).variables.title,'Tiếng Việt');
  await assert.rejects(client.request('run',{scenario:'fixture',profile:'Default'}),/requestId/);
  await assert.rejects(client.request('run',{scenario:'../escape',profile:'Default'},{requestId:'a'}),/scenario/);
  await assert.rejects(client.request('status',{runId:'bad'}),/runId/);
  await assert.rejects(client.request('profiles',{command:'whoami'}),/parameters/);
  await assert.rejects(client.request('scenarios'),error=>error.status===401&&!error.message.includes(token));
  await assert.rejects(client.request('describe',{scenario:'redirect'}),error=>error.code==='UNAVAILABLE');
});

test('Socket bridge requires active lease, filters shell/path parameters and cancels requests on revoke',async()=>{
  const socket=new EventEmitter();socket.connected=true;
  let session={sessionId:randomUUID(),expires:Date.now()+60000},calls=0;
  const client={async request(operation,params,{signal}){calls++;if(operation==='scenarios')return {names:['fixture']};if(operation==='profiles')return {data:'x'.repeat(500001)};return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{code:'UNAVAILABLE',status:503})),{once:true}));}};
  const bridge=bindWorkflowSocket({socket,getSession:()=>session,client});
  const send=payload=>new Promise(resolve=>socket.emit('workflow:request',payload,resolve));
  assert.equal((await send({sessionId:'wrong',operation:'scenarios',params:{}})).status,403);
  assert.equal(calls,0);
  const result=await send({sessionId:session.sessionId,operation:'scenarios',params:{}});
  assert.deepEqual(result.data,{names:['fixture']});
  assert.equal((await send({sessionId:session.sessionId,operation:'profiles',params:{}})).status,502);
  assert.equal((await send({sessionId:session.sessionId,operation:'run',params:{uploadPath:'C:/private'}})).status,400);
  const pending=send({sessionId:session.sessionId,operation:'status',params:{runId:randomUUID()}});
  socket.emit('session:revoked',{sessionId:session.sessionId});session=null;
  assert.equal((await pending).ok,false);bridge.close();assert.equal(socket.listenerCount('workflow:request'),0);
});

test('pending HTTP is aborted at local lease expiry without a VPS revoke, and renewed leases survive the old deadline', async t => {
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: 1000});
  const socket = new EventEmitter(); socket.connected = true;
  let session = {sessionId: randomUUID(), expires: 1100}, signal, finish;
  const client = {request(operation, params, options) {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      finish = resolve;
      signal.addEventListener('abort', () => reject(Object.assign(Error('interrupted'), {status: 503})), {once: true});
    });
  }};
  const bridge = bindWorkflowSocket({socket, getSession: () => session, client});
  t.after(() => bridge.close());
  const send = () => new Promise(resolve => socket.emit('workflow:request', {sessionId: session.sessionId, operation: 'scenarios'}, resolve));
  const expired = send();
  t.mock.timers.tick(100);
  assert.equal(signal.aborted, true, 'expiry aborts HTTP without waiting for its network timeout');
  assert.equal((await expired).ok, false);

  session = {sessionId: randomUUID(), expires: 1200};
  const renewed = send();
  session = {...session, expires: 1500};
  socket.emit('session:active', session);
  t.mock.timers.tick(100);
  assert.equal(signal.aborted, false);
  finish({names: ['fixture']});
  assert.deepEqual((await renewed).data, {names: ['fixture']});
  t.mock.timers.tick(300);
  assert.equal(signal.aborted, false, 'settled requests release the expiry timer');
});

test('socket bridge bounds local requests and cancels on replacement, disconnect and shutdown', async t => {
  const socket = new EventEmitter(); socket.connected = true;
  const session = {sessionId: randomUUID(), expires: Date.now() + 60000};
  const signals = [];
  let finish;
  const client = {request(operation, params, {signal}) {
    signals.push(signal);
    // Deliberately ignore cancellation: the bridge must still suppress late data.
    return new Promise(resolve => { finish = resolve; });
  }};
  const bridge = bindWorkflowSocket({socket, getSession: () => session, client});
  t.after(() => bridge.close());
  const send = (params = {}) => new Promise(resolve => socket.emit('workflow:request', {sessionId: session.sessionId, operation: 'scenarios', params}, resolve));
  assert.equal((await send({value: 'x'.repeat(12001)})).status, 413);
  assert.equal(signals.length, 0);
  for (const cancel of [
    () => socket.emit('session:active', {...session, sessionId: randomUUID()}),
    () => socket.emit('session:revoked', {sessionId: session.sessionId}),
    () => { socket.connected = false; socket.emit('disconnect'); },
    () => bridge.close(),
  ]) {
    socket.connected = true;
    const pending = send();
    cancel();
    assert.equal(signals.at(-1).aborted, true);
    finish({private: 'stale-result'});
    const result = await pending;
    assert.equal(result.status, 403);
    assert.equal(Object.hasOwn(result, 'data'), false);
  }
  for (const event of ['workflow:request', 'disconnect', 'session:active', 'session:revoked']) assert.equal(socket.listenerCount(event), 0);
});

test('CLI exposes a retry key before a potentially accepted run loses its response', async () => {
  const messages = [], submitted = [];
  const client = {async request(operation, params, {requestId}) {
    assert.equal(messages.at(-1).requestId, requestId, 'the retry key is available before POST');
    submitted.push({operation, params, requestId});
    if (submitted.length === 1) throw Error('Response lost after engine accepted POST');
    return {runId: 'fixture', state: 'running'};
  }};
  const args = ['run', '--scenario', 'fixture', '--profile', 'Default', '--var', 'title=example'];
  const output = [], options = {client, diagnostic: message => messages.push(message), output: data => output.push(data)};
  await assert.rejects(runWorkflowCli(args, options), /Response lost/);
  const requestId = messages[0].requestId;
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  await runWorkflowCli([...args, '--request-id', requestId], options);
  assert.deepEqual(submitted[1], submitted[0]);
  assert.equal(output.length, 1);
});

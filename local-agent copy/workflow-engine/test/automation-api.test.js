const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const { temporary, removeTemporary, startEngine } = require('./helpers/engine');

test('real packaged engine: API auth, local run/stop/history, retry, restart and legacy polling disabled', async t => {
  const directory = temporary('workflow-api-');
  let engine = await startEngine({directory});
  t.after(async () => { await engine.close(); removeTemporary(directory); });
  async function api(route, {body, headers={}, method=body ? 'POST':'GET', status=200} = {}) {
    const response = await fetch(engine.base+route, {method,headers:{Authorization:`Bearer ${engine.token}`,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data = await response.json(); assert.equal(response.status,status,JSON.stringify(data)); return data;
  }
  assert.deepEqual((await api('/api/v1/profiles')).profiles.map(p=>p.directory), ['Default']);
  await api('/api/v1/profiles',{headers:{Authorization:'Bearer incorrect'},status:401});
  await api('/api/v1/profiles',{headers:{Origin:engine.base},status:403});
  // Node fetch derives Host from the URL; use HTTP directly to exercise Host validation.
  const hostStatus=await new Promise((resolve,reject)=>{
    require('node:http').get(engine.base+'/api/v1/profiles',{headers:{Host:'untrusted.example',Authorization:`Bearer ${engine.token}`}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);
  });
  assert.equal(hostStatus,403);
  const html = await (await fetch(engine.base)).text();
  assert(!html.includes(engine.token));
  const dashboardSession = /name="local-agent-session" content="([a-f0-9]+)"/.exec(html)?.[1];
  assert(dashboardSession);
  assert.equal((await api('/api/remote/status',{headers:{'x-local-agent-session':dashboardSession}})).enabled,false);
  await api('/api/remote/pair-start',{body:{url:'https://never-contact.invalid'},headers:{'x-local-agent-session':dashboardSession},status:410});
  const legacy = fs.readFileSync(path.join(engine.data,'remote.json'),'utf8');
  await new Promise(resolve=>setTimeout(resolve,3100)); // More than a legacy poll period.
  assert.equal(fs.readFileSync(path.join(engine.data,'remote.json'),'utf8'),legacy);
  await api('/api/v1/runs',{body:{scenario:'wait',profile:'Default',steps:[]},status:400});
  await api('/api/v1/runs',{body:{scenario:'../escape',profile:'Default'},status:400});
  const body={scenario:'wait',profile:'Default',variables:{delay:20}};
  const run=await api('/api/v1/runs',{body,headers:{'Idempotency-Key':'fixture-key'},status:202});
  assert.match(run.runId,/^[0-9a-f-]{36}$/);
  assert.equal((await api('/api/v1/runs',{body,headers:{'Idempotency-Key':'fixture-key'}})).runId,run.runId);
  await api('/api/v1/runs',{body:{...body,variables:{delay:30}},headers:{'Idempotency-Key':'fixture-key'},status:409});
  let result;
  for(let n=0;n<100;n++){result=await api('/api/v1/runs/'+run.runId);if(result.state!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(result.state,'succeeded');
  const slow=await api('/api/v1/runs',{body:{...body,variables:{delay:10000}},status:202});
  assert.equal((await api('/api/v1/runs/'+slow.runId+'/stop',{method:'POST'})).state,'cancelled');
  assert.equal((await api('/api/v1/runs/'+slow.runId+'/stop',{method:'POST'})).state,'cancelled');
  assert((await api('/api/v1/runs')).runs.some(r=>r.runId===run.runId));
  await engine.close(); engine=await startEngine({directory});
  assert.equal((await api('/api/v1/runs/'+run.runId)).state,'succeeded','persisted history survives process restart');
  await engine.close(); engine=await startEngine({directory,token:''});
  await api('/api/v1/profiles',{status:503});
});

test('entrypoint rejects malformed API token without reading a real env', async t=>{
  const directory=temporary('workflow-invalid-token-');t.after(()=>removeTemporary(directory));
  const child=spawn(process.execPath,[path.resolve(__dirname,'../index.js'),'--daemon'],{cwd:directory,env:{LOCAL_AGENT_ENV_FILE:path.join(directory,'absent.env'),LOCAL_AGENT_API_TOKEN:'short'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.resume();child.stderr.resume();
  const [code]=await once(child,'close');assert.notEqual(code,0);
});

test('existing core HTTP adapter controls the imported engine without a ref dependency', async t=>{
  const directory=temporary('workflow-core-adapter-');
  const engine=await startEngine({directory});
  t.after(async()=>{await engine.close();removeTemporary(directory);});
  const {createWorkflowClient}=await import('../../src/workflow.js');
  const client=createWorkflowClient({settings:()=>({enabled:true,baseUrl:engine.base,token:engine.token})});
  assert.equal((await client.request('scenarios')).names.includes('wait'),true);
  const run=await client.request('run',{scenario:'wait',profile:'Default',variables:{delay:10000}},{requestId:'core-adapter-fixture'});
  assert.equal(run.state,'running');
  assert.equal((await client.request('stop',{runId:run.runId})).state,'cancelled');
  assert.equal((await client.request('status',{runId:run.runId})).state,'cancelled');
});

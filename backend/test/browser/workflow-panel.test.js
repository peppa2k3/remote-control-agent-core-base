import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {io} from 'socket.io-client';
import {createApp} from '../../src/server.js';
import {createWorkflowJobs} from '../../src/workflow-jobs.js';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await pause(50)}assert.fail('Fixture deadline')}

for(const viewport of [{width:1280,height:900},{width:390,height:844}])test(`workflow dashboard ${viewport.width}px: scoped recovery, validation, stop, roles, revoke and stale ACK`,async t=>{
  const core=createApp({dbPath:':memory:',origin:'http://localhost:5173'});await new Promise(r=>core.http.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${core.http.address().port}`;
  // Recreate with the actual origin, required by both cookie and websocket checks.
  await core.close();
  const app=createApp({dbPath:':memory:',origin:base});await new Promise(r=>app.http.listen(Number(new URL(base).port),'127.0.0.1',r));
  const password='frontend-fixture-password',owner=app.db.addUser('owner@ui.test',password,'Owner'),viewer=app.db.addUser('viewer@ui.test',password,'Viewer');
  const device=app.db.enroll(app.db.pair(owner,'UI fixture'));app.db.run("INSERT INTO members(deviceId,userId,role) VALUES(?,?,'viewer')",device.deviceId,viewer);
  const ledger=createWorkflowJobs(app.db,{recover:false}),agent=io(base,{autoConnect:false,transports:['websocket'],auth:{kind:'agent',credential:device.credential}});
  const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));let heartbeat;
  t.after(async()=>{clearInterval(heartbeat);agent.disconnect();await browser.close();await app.close()});
  const cap={protocolVersion:2,jobsVersion:1,agentInstanceId:randomUUID(),engineInstanceId:randomUUID(),engineVersion:'0.5.0',mode:'integrated',policyRevision:1,operations:['profiles','scenarios','describe','runs','status','run','stop','openProfile']};
  let ready=false,current=null,runCalls=0,statusCalls=0,profileCalls=0,hold=false,held=null,lastWire=null;
  const publish=(state='ready')=>agent.timeout(3000).emitWithAck('workflow:v2:capabilities',{...cap,health:{state,reasonCode:state==='ready'?'READY':'AUTH_FAILED',checkedAt:Date.now()}});
  agent.on('session:offer',p=>agent.emit('session:ack',{sessionId:p.sessionId,nonce:p.nonce,accept:true},()=>{}));
  agent.on('workflow:v2:grant',(p,ack)=>ack({ok:true,grantId:p.grantId,fence:p.fence,seq:p.seq,state:'active'}));
  agent.on('workflow:v2:revoke',(p,ack)=>ack({ok:true,grantId:p.grantId,fence:p.fence,state:'revoked',quiescent:true}));
  function report(wire,state,quiescent){const j=ledger.get(wire.jobId);ledger.merge(device.deviceId,{jobId:j.jobId,grantId:j.grantId,fence:j.fence,originEngineInstanceId:j.engineInstanceId,seq:j.reportSeq+1,state,runId:current.runId,quiescent,reasonCode:'NONE',progress:{index:1,total:2,action:null}})}
  agent.on('workflow:v2:dispatch',(p,ack)=>{
    let data;
    if(p.operation==='profiles'){profileCalls++;data={profiles:[{directory:'Default',name:'Default',allowOpen:true,readiness:{state:ready?'ready':'missing-extension'}}]};}
    else if(p.operation==='scenarios')data={names:['wait']};
    else if(p.operation==='describe')data={name:'wait',profiles:['Default'],variables:{delay:10},variableSchema:{delay:{type:'integer',minimum:1,maximum:100}}};
    else if(p.operation==='runs')data={runs:current?[current]:[]};
    else if(p.operation==='openProfile'){ready=true;data={profile:'Default',state:'starting'};}
    else if(p.operation==='run'){
      runCalls++;lastWire=p;current={runId:randomUUID(),scenario:'wait',state:'running',index:0,total:2,quiescent:false};report(p,'running',false);data=current;
      if(hold){held=()=>ack({ok:true,requestId:p.requestId,data:{...current,scenario:'STALE_ACK_MUST_NOT_RENDER'}});return;}
    }
    else if(p.operation==='status'){statusCalls++;data=current;}
    else if(p.operation==='stop'){current={...current,state:'cancelled',quiescent:true};report(lastWire,'cancelled',true);data={operation:'stop',state:'succeeded',quiescent:true};}
    ack({ok:true,requestId:p.requestId,data});
  });
  const connection=once(agent,'connect');agent.connect();await connection;await publish();heartbeat=setInterval(()=>{agent.emit('agent:heartbeat',{},()=>{});void publish()},4000);
  async function login(target,email){await target.goto(base);await target.locator('[name=email]').fill(email);await target.locator('[name=password]').fill(password);await target.getByRole('button',{name:'Đăng nhập',exact:true}).click();await target.getByRole('heading',{name:'UI fixture',exact:true}).waitFor()}
  async function lease(){await page.getByRole('button',{name:'Yêu cầu điều khiển',exact:true}).click();await until(()=>page.getByRole('button',{name:'Tải danh sách kịch bản'}).isEnabled())}
  async function catalog(){await page.getByRole('button',{name:'Tải danh sách kịch bản'}).focus();await page.keyboard.press('Enter');await page.locator('[aria-label="Chrome profile"] option[value=Default]').waitFor({state:'attached'});await page.getByLabel('Kịch bản',{exact:true}).selectOption('wait');await until(()=>page.getByLabel('Biến ghi đè (JSON)').isEnabled())}
  await login(page,'owner@ui.test');await lease();await catalog();
  await page.getByText('Chrome profile: Thiếu extension hoặc heartbeat đã hết hạn',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Mở Chrome profile',exact:true}).click();await page.getByText('Chrome profile: Extension đã kết nối',{exact:true}).waitFor();
  await page.getByLabel('Biến ghi đè (JSON)').fill('{"delay":200}');await page.getByRole('button',{name:'Chạy kịch bản',exact:true}).click();await page.getByRole('alert').filter({hasText:'không đúng kiểu'}).waitFor();assert.equal(runCalls,0);
  await page.getByLabel('Biến ghi đè (JSON)').fill('{"path":"forbidden"}');await page.getByRole('button',{name:'Chạy kịch bản',exact:true}).click();await page.getByRole('alert').filter({hasText:'không đúng kiểu'}).waitFor();assert.equal(runCalls,0);
  await page.getByLabel('Biến ghi đè (JSON)').fill('{"delay":10}');await page.getByRole('button',{name:'Chạy kịch bản',exact:true}).click();await page.getByText('wait · Đang chạy',{exact:true}).waitFor();assert.equal(runCalls,1);
  const stored=await page.evaluate(()=>Object.entries(sessionStorage).filter(([k])=>k.startsWith('workflow-intent:')));assert(!JSON.stringify(stored).includes('variables'));assert(!JSON.stringify(stored).includes('"delay"'));
  await page.getByRole('button',{name:'Dừng lượt chạy',exact:true}).click();await page.getByText('wait · Đã hủy',{exact:true}).waitFor();
  // Wrong browser can view history but cannot issue even a forged request.
  const other=await context.newPage();await other.goto(base);await other.getByRole('heading',{name:'UI fixture',exact:true}).waitFor();assert.equal(await other.getByRole('button',{name:'Tải danh sách kịch bản'}).isEnabled(),false);
  const cookie=(await context.cookies()).map(c=>`${c.name}=${c.value}`).join(';'),forged=io(base,{autoConnect:false,transports:['websocket'],extraHeaders:{Cookie:cookie,Origin:base}});const c=once(forged,'connect');forged.connect();await c;
  const response=await forged.timeout(3000).emitWithAck('workflow:request',{deviceId:device.deviceId,sessionId:app.db.lease(device.deviceId).id,operation:'run',params:{profile:'Default',scenario:'wait',variables:{}},requestId:randomUUID()});assert.equal(response.ok,false);forged.disconnect();await other.close();
  await page.getByRole('button',{name:'Chuẩn bị lượt mới'}).click();await until(()=>page.getByRole('button',{name:'Chạy kịch bản',exact:true}).isEnabled());hold=true;
  await page.getByRole('button',{name:'Chạy kịch bản',exact:true}).click();await until(()=>held!==null);
  await page.getByRole('button',{name:'Kết thúc phiên',exact:true}).click();await until(()=>page.getByRole('button',{name:'Tải danh sách kịch bản'}).isDisabled());
  // Reload loses ACK; current user's key resolves the original run without dispatch.
  await page.reload();await page.getByText('Đang chạy',{exact:true}).waitFor();assert.equal(runCalls,2);
  await page.getByRole('button',{name:'Yêu cầu điều khiển',exact:true}).waitFor();
  held();await pause(150);assert(!(await page.locator('body').innerText()).includes('STALE_ACK_MUST_NOT_RENDER'));
  const polls=statusCalls,profilesBefore=profileCalls;await pause(2300);assert.equal(statusCalls,polls);assert.equal(profileCalls,profilesBefore);
  // Unknown survives reconnect/history and cannot become a new intent.
  ledger.uncertain(lastWire.jobId);await page.reload();await page.getByText('Chưa xác định kết quả',{exact:true}).waitFor();assert.equal(runCalls,2);
  await page.locator('summary').filter({hasText:'Lịch sử jobs trên VPS'}).click();await page.getByRole('button',{name:`Theo dõi job ${lastWire.jobId}`}).waitFor();
  // Viewer gets metadata, no controls, and cannot look up owner's requestId.
  const viewerContext=await browser.newContext({viewport}),vp=await viewerContext.newPage();await login(vp,'viewer@ui.test');assert.equal(await vp.getByRole('button',{name:'Tải danh sách kịch bản'}).isEnabled(),false);
  const lookup=await vp.request.get(`${base}/api/devices/${device.deviceId}/workflow/requests/${lastWire.requestId}`);assert.equal((await lookup.json()).job,null);await viewerContext.close();
  clearInterval(heartbeat);await publish('failed');await page.getByText('Workflow: Lỗi',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Chạy kịch bản',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});

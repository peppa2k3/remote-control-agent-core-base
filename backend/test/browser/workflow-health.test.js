import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {io} from 'socket.io-client';
import {createApp} from '../../src/server.js';

test('built dashboard displays engine health separately from runner and requires lease for controls',async t=>{
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base=`http://127.0.0.1:${port}`,core=createApp({dbPath:':memory:',origin:base});await new Promise(r=>core.http.listen(port,'127.0.0.1',r));
  const password='browser-health-fixture-password',owner=core.db.addUser('browser-health@test.local',password,'Fixture');const device=core.db.enroll(core.db.pair(owner,'Browser health fixture'));
  const agent=io(base,{autoConnect:false,transports:['websocket'],auth:{kind:'agent',credential:device.credential}});const browser=await chromium.launch({channel:'chrome',headless:true});
  t.after(async()=>{agent.disconnect();await browser.close();await core.close();});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('input[name=email]').fill('browser-health@test.local');await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  const connected=once(agent,'connect');agent.connect();await connected;
  const cap={protocolVersion:2,agentInstanceId:randomUUID(),engineInstanceId:randomUUID(),engineVersion:'0.3.0',mode:'integrated',operations:['profiles','scenarios','describe','runs','status','run','stop'],policyRevision:1,supervisor:{mode:'managed',owned:true,restarts:0}};
  const publish=(state,reasonCode)=>agent.timeout(3000).emitWithAck('workflow:v2:capabilities',{...cap,health:{state,reasonCode,checkedAt:Date.now(),path:'never-display-path',token:'never-display-token'}});
  await publish('starting','STARTING');await page.getByText('Workflow: Đang khởi động',{exact:false}).waitFor();
  await publish('ready','READY');await page.getByText('Workflow: Engine sẵn sàng',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Chạy kịch bản',exact:true}).isEnabled(),false);
  await page.getByText('Engine sẵn sàng chưa xác nhận phiên Windows tương tác, Chrome hoặc extension sẵn sàng.',{exact:true}).waitFor();
  await publish('failed','AUTH_FAILED');await page.getByText('Workflow: Lỗi',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Chạy kịch bản',exact:true}).count(),0);
  assert(!(await page.locator('body').innerText()).includes('never-display'));
  agent.disconnect();await page.getByText('Workflow: Runner offline',{exact:false}).waitFor();assert.deepEqual(errors,[]);
});

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
 const owner=core.db.addUser('owner@test',secret,'Owner'),op=core.db.addUser('op@test',secret,'Operator');core.db.addUser('outsider@test',secret,'Outsider');
 async function request(path,{cookie,body,method='POST',origin='http://localhost:5173'}={}){const r=await fetch(url+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const oc=(await request('/auth/login',{body:{email:'owner@test',password:secret}})).cookie,pc=(await request('/auth/login',{body:{email:'op@test',password:secret}})).cookie,xc=(await request('/auth/login',{body:{email:'outsider@test',password:secret}})).cookie;
 assert.equal((await request('/pairing',{cookie:oc,body:{name:'Home'},origin:'http://evil.test'})).status,403);
 const code=(await request('/pairing',{cookie:oc,body:{name:'Home'}})).data.code;const d=(await request('/agents/enroll',{body:{code}})).data;assert.equal((await request('/agents/enroll',{body:{code}})).status,401);
 await request(`/devices/${d.deviceId}/members`,{cookie:oc,body:{email:'op@test',role:'operator'}});
 assert.equal((await request('/devices',{cookie:xc,method:'GET'})).data.length,0);
 function sock(auth={},cookie){const s=io(url,{autoConnect:false,transports:['websocket'],auth,extraHeaders:cookie?{Cookie:cookie,Origin:'http://localhost:5173'}:{}});sockets.push(s);return s}
 const a=sock({kind:'agent',credential:d.credential}),o=sock({},oc),p=sock({},pc),x=sock({},xc);const ps=[a,o,p,x].map(s=>{const wait=connected(s);s.connect();return wait});await Promise.all(ps);
 assert.equal((await emit(x,'session:request',{deviceId:d.deviceId})).status,403);
 let offerWait=once(a,'session:offer');const first=await emit(p,'session:request',{deviceId:d.deviceId});const [offer]=await offerWait;assert.equal(first.state,'pending');const activeWait=once(p,'session:active');assert.equal((await emit(a,'session:ack',{sessionId:offer.sessionId,nonce:offer.nonce,accept:true})).ok,true);await activeWait;
 assert.equal((await emit(o,'session:request',{deviceId:d.deviceId})).status,409);
 const revoked=once(p,'session:revoked');offerWait=once(a,'session:offer');const takeover=await emit(o,'session:request',{deviceId:d.deviceId,force:true});await revoked;const [newOffer]=await offerWait;assert.notEqual(takeover.sessionId,first.sessionId);
 assert.equal((await emit(p,'session:renew',{deviceId:d.deviceId,sessionId:first.sessionId})).status,403);
 await emit(a,'session:ack',{sessionId:newOffer.sessionId,nonce:newOffer.nonce,accept:true});
 const offline=once(o,'session:revoked');a.disconnect();await offline;assert.equal(core.db.lease(d.deviceId),null);
 assert.equal((await emit(o,'session:request',{deviceId:d.deviceId})).status,409);
 const invalid=sock({kind:'agent',credential:'invalid'});const denied=once(invalid,'connect_error');invalid.connect();await denied;invalid.disconnect();
 await request(`/devices/${d.deviceId}`,{cookie:oc,method:'DELETE'});assert.equal(core.db.agent(d.credential),undefined);assert.ok(core.db.all('SELECT * FROM audit WHERE deviceId=?',d.deviceId).length>=5);
});

// Exercise the actual Local Runner executable, not only a simulated socket.
test('real Local Runner connects and auto-approves only a server-issued handshake',async t=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {fileURLToPath}=await import('node:url');const {spawn}=await import('node:child_process');
 const core=createApp({dbPath:':memory:',origin:'http://localhost:5173'});await new Promise(r=>core.http.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+core.http.address().port;const dir=mkdtempSync(join(tmpdir(),'rca-test-'));const owner=core.db.addUser('runner-owner@test',secret,'Owner'),d=core.db.enroll(core.db.pair(owner,'Runner executable'));
 const res=await fetch(url+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({email:'runner-owner@test',password:secret})});const cookie=res.headers.get('set-cookie').split(';')[0];
 const browser=io(url,{autoConnect:false,transports:['websocket'],extraHeaders:{Cookie:cookie,Origin:'http://localhost:5173'}});const wait=connected(browser);browser.connect();await wait;
 const file=join(dir,'credentials.json');writeFileSync(file,JSON.stringify({...d,server:url}),{mode:0o600});let child;
 t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit}browser.disconnect();await core.close();rmSync(dir,{recursive:true,force:true})});
 const online=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Runner did not connect')),5000);browser.on('devices:snapshot',rows=>{if(rows.some(v=>v.id===d.deviceId&&v.runnerStatus==='online')){clearTimeout(timeout);resolve()}})});
 child=spawn(process.execPath,[fileURLToPath(new URL('../../local-agent/src/index.js',import.meta.url))],{env:{...process.env,SERVER_URL:url,CREDENTIALS_PATH:file,AUTO_APPROVE_SESSIONS:'true'},stdio:['ignore','ignore','pipe']});
 await online;const active=once(browser,'session:active');const result=await emit(browser,'session:request',{deviceId:d.deviceId});assert.equal(result.state,'pending');const [session]=await active;assert.equal(core.db.lease(d.deviceId).id,session.sessionId);assert.equal(core.db.lease(d.deviceId).state,'active');
 const revoked=once(browser,'session:revoked');const exit=once(child,'exit');child.kill('SIGTERM');await Promise.all([revoked,exit]);assert.equal(core.db.lease(d.deviceId),null);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {io} from 'socket.io-client';
import {createApp} from '../src/server.js';

const password='terminal-test-password-123';
function connected(socket){return Promise.race([once(socket,'connect'),once(socket,'connect_error').then(([error])=>{throw error})])}
function emit(socket,event,data){return new Promise((resolve,reject)=>socket.timeout(3000).emit(event,data,(error,result)=>error?reject(error):resolve(result)))}

test('Remote Terminal enforces browser lease ownership, one session, bounded relay and revoke cleanup',async t=>{
 const core=createApp({dbPath:':memory:',origin:'http://localhost:5173'});await new Promise(resolve=>core.http.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+core.http.address().port,sockets=[];
 t.after(async()=>{for(const socket of sockets)socket.disconnect();await core.close()});
 const owner=core.db.addUser('terminal-owner@test',password,'Owner'),operator=core.db.addUser('terminal-operator@test',password,'Operator'),viewer=core.db.addUser('terminal-viewer@test',password,'Viewer');const device=core.db.enroll(core.db.pair(owner,'Windows PC'));
 core.db.run('INSERT INTO members VALUES(?,?,?)',device.deviceId,operator,'operator');core.db.run('INSERT INTO members VALUES(?,?,?)',device.deviceId,viewer,'viewer');
 async function login(email){const response=await fetch(url+'/api/auth/login',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0]}
 function browser(cookie){const socket=io(url,{autoConnect:false,transports:['websocket'],extraHeaders:{Cookie:cookie,Origin:'http://localhost:5173'}});sockets.push(socket);return socket}
 function agent(){const socket=io(url,{autoConnect:false,transports:['websocket'],auth:{kind:'agent',credential:device.credential}});sockets.push(socket);return socket}
 const ownerSocket=browser(await login('terminal-owner@test')),operatorSocket=browser(await login('terminal-operator@test')),viewerSocket=browser(await login('terminal-viewer@test')),agentSocket=agent();
 const connections=[ownerSocket,operatorSocket,viewerSocket,agentSocket].map(socket=>{const wait=connected(socket);socket.connect();return wait});await Promise.all(connections);
 assert.equal((await emit(agentSocket,'agent:terminal-capabilities',{platform:'win32',shells:['cmd','powershell']})).ok,true);
 const offerWait=once(agentSocket,'session:offer'),request=await emit(operatorSocket,'session:request',{deviceId:device.deviceId}),[offer]=await offerWait;assert.equal(request.state,'pending');await emit(agentSocket,'session:ack',{sessionId:offer.sessionId,nonce:offer.nonce,accept:true});
 const viewerResult=await emit(viewerSocket,'terminal:open',{deviceId:device.deviceId,sessionId:offer.sessionId,shell:'cmd',cols:100,rows:30});assert.equal(viewerResult.status,403);
 const openWait=once(agentSocket,'terminal:open'),openResultPromise=emit(operatorSocket,'terminal:open',{deviceId:device.deviceId,sessionId:offer.sessionId,shell:'cmd',cols:100,rows:30}),[openPayload,openAck]=await openWait;openAck({ok:true,state:'connected'});const openResult=await openResultPromise;assert.equal(openResult.state,'connecting');assert.equal(openPayload.sessionId,offer.sessionId);
 const openedWait=once(operatorSocket,'terminal:opened');agentSocket.emit('terminal:opened',{terminalId:openPayload.terminalId,sessionId:offer.sessionId,shell:'cmd',startedAt:Date.now()});const [opened]=await openedWait;assert.equal(opened.terminalId,openResult.terminalId);
 assert.equal((await emit(ownerSocket,'session:request',{deviceId:device.deviceId})).status,409);
 assert.equal((await emit(operatorSocket,'session:request',{deviceId:device.deviceId,force:true})).status,403);
 let closeCount=0;agentSocket.on('terminal:close',()=>closeCount++);
 const foreignInput=await emit(ownerSocket,'terminal:input',{deviceId:device.deviceId,terminalId:openResult.terminalId,sessionId:offer.sessionId,data:'hostname\r'});assert.equal(foreignInput.status,404);
 const inputWait=once(agentSocket,'terminal:input'),inputPromise=emit(operatorSocket,'terminal:input',{deviceId:device.deviceId,terminalId:openResult.terminalId,sessionId:offer.sessionId,data:'hostname\r'}),[inputPayload,inputAck]=await inputWait;inputAck({ok:true});assert.equal((await inputPromise).ok,true);assert.equal(inputPayload.data,'hostname\r');
 const ownerOutput=[];ownerSocket.on('terminal:output',payload=>ownerOutput.push(payload));const operatorOutput=once(operatorSocket,'terminal:output');agentSocket.emit('terminal:output',{terminalId:openResult.terminalId,sessionId:offer.sessionId,text:'hostname result\r\n'});const [output]=await operatorOutput;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(output.text,'hostname result\r\n');assert.equal(ownerOutput.length,0);
 const releaseClose=once(agentSocket,'terminal:close'),revoked=once(operatorSocket,'session:revoked');assert.equal((await emit(operatorSocket,'session:release',{deviceId:device.deviceId})).ok,true);const [closePayload]=await releaseClose;await revoked;assert.equal(closePayload.terminalId,openResult.terminalId);assert.equal(closePayload.sessionId,offer.sessionId);
 const closed=once(operatorSocket,'terminal:closed');agentSocket.emit('terminal:exited',{terminalId:openResult.terminalId,sessionId:offer.sessionId,state:'closed',reason:'lease.released',durationMs:50});const [closedPayload]=await closed;assert.equal(closedPayload.state,'closed');assert.equal(closeCount,1);
 const audits=core.db.all('SELECT event FROM audit WHERE deviceId=?',device.deviceId).map(row=>row.event);assert.ok(audits.includes('terminal.opened'));assert.ok(audits.includes('terminal.closed'));assert.equal(audits.some(event=>event.includes('hostname result')),false);
 assert.equal((await emit(operatorSocket,'terminal:input',{deviceId:device.deviceId,terminalId:openResult.terminalId,sessionId:offer.sessionId,data:'whoami\r'})).status,404);
});

import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Server} from 'socket.io';
import {Store,hash,token,passwordOK,fail} from './store.js';
const STATUS_FIELDS=['cpuPercent','ramUsedBytes','ramTotalBytes','networkRxBytesPerSecond','networkTxBytesPerSecond','uptimeSeconds'];
const STATUS_MAX_AGE_MS=180000;
const TERMINAL_SHELLS=['cmd','powershell'],MAX_TERMINAL_CHUNK_BYTES=4096,MAX_TERMINAL_INPUT_BYTES=1024*1024,MAX_TERMINAL_OUTPUT_BYTES=4*1024*1024;
const MAX_TERMINAL_SESSION_MS=60*60*1000,IDLE_TERMINAL_MS=30*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function plainObject(v){return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype}
function exactKeys(v,allowed){return Object.keys(v).every(k=>allowed.includes(k))}
function terminalLease(db,terminal){const lease=db.lease(terminal.deviceId);return lease&&lease.state==='active'&&lease.id===terminal.sessionId&&lease.userId===terminal.userId&&lease.browserId===terminal.browserId}
function validateDeviceStatus(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==STATUS_FIELDS.length||STATUS_FIELDS.some(k=>!Object.hasOwn(value,k)))fail(400,'Thông số status không hợp lệ');
 const {cpuPercent,ramUsedBytes,ramTotalBytes,networkRxBytesPerSecond,networkTxBytesPerSecond,uptimeSeconds}=value;
 if(typeof cpuPercent!=='number'||!Number.isFinite(cpuPercent)||cpuPercent<0||cpuPercent>100)fail(400,'Thông số CPU không hợp lệ');
 if(!Number.isSafeInteger(ramTotalBytes)||ramTotalBytes<=0||!Number.isSafeInteger(ramUsedBytes)||ramUsedBytes<0||ramUsedBytes>ramTotalBytes)fail(400,'Thông số RAM không hợp lệ');
 if(!Number.isSafeInteger(networkRxBytesPerSecond)||networkRxBytesPerSecond<0||!Number.isSafeInteger(networkTxBytesPerSecond)||networkTxBytesPerSecond<0)fail(400,'Thông số mạng không hợp lệ');
 if(!Number.isSafeInteger(uptimeSeconds)||uptimeSeconds<0)fail(400,'Thông số uptime không hợp lệ');
 return {cpuPercent,ramUsedBytes,ramTotalBytes,networkRxBytesPerSecond,networkTxBytesPerSecond,uptimeSeconds};
}
export function createApp({dbPath=process.env.DB_PATH||'./data/rca.sqlite',origin=process.env.PUBLIC_ORIGIN||'http://localhost:5173',secure=process.env.COOKIE_SECURE==='true'}={}) {
 const db=new Store(dbPath), app=express(), http=createServer(app);
 if(process.env.TRUST_PROXY==='true')app.set('trust proxy',1);
 app.use(helmet());app.use(express.json({limit:'16kb'}));
 app.use('/api',rateLimit({windowMs:60000,limit:180}));
 const io=new Server(http,{cors:{origin,credentials:true},maxHttpBufferSize:16384,allowRequest:(req,done)=>done(null,!req.headers.origin||req.headers.origin===origin)});
 const agents=new Map(), viewers=new Map(), deviceStatuses=new Map(),terminalCapabilities=new Map(),terminalSessions=new Map();
 const cookie=req=>{const part=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('rca='));return part?part.slice(4):''};
 function user(req){const s=db.one('SELECT userId,expires FROM logins WHERE hash=?',hash(cookie(req)));if(!s||s.expires<Date.now())fail(401,'Cần đăng nhập');return s.userId}
 const auth=(req,res,next)=>{try{req.userId=user(req);next()}catch(e){next(e)}};
 const owner=(d,u)=>{if(db.role(d,u)!=='owner')fail(403,'Chỉ owner được thao tác')};
 const writeOrigin=(req,res,next)=>{if(['POST','PUT','DELETE','PATCH'].includes(req.method)&&req.headers.origin!==origin)return res.status(403).json({error:'Origin không hợp lệ'});next()};
 function validString(v,max=120){if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'Dữ liệu không hợp lệ');return v.trim()}
 function browserTerminalEvent(terminal,event,payload={}){const browser=io.sockets.sockets.get(terminal.browserId);if(browser&&viewers.get(terminal.browserId)===terminal.userId)browser.emit(event,{deviceId:terminal.deviceId,terminalId:terminal.id,sessionId:terminal.sessionId,...payload})}
 function finishTerminal(terminal,state='closed',reason='process.exit'){
  if(terminalSessions.get(terminal.deviceId)!==terminal)return;
  clearTimeout(terminal.idleTimer);clearTimeout(terminal.maxTimer);terminalSessions.delete(terminal.deviceId);terminal.state=state;terminal.closedAt=Date.now();if(state==='error'){if(!terminal.errorAudited)db.audit(terminal.userId,terminal.deviceId,'terminal.error')}else db.audit(terminal.userId,terminal.deviceId,'terminal.closed');
  browserTerminalEvent(terminal,'terminal:closed',{state,reason,durationMs:Math.max(0,terminal.closedAt-terminal.startedAt)});broadcast();
 }
 function closeTerminal(d,reason='user.closed'){
  const terminal=terminalSessions.get(d);if(!terminal)return false;
  if(terminal.state!=='closing'){terminal.state='closing';terminal.closeReason=reason;clearTimeout(terminal.idleTimer);clearTimeout(terminal.maxTimer);db.audit(terminal.userId,d,'terminal.close.requested');browserTerminalEvent(terminal,'terminal:status',{state:'closing',reason});}
  const agent=agents.get(d);if(!agent){finishTerminal(terminal,'closed',reason);return true}
  agent.socket.emit('terminal:close',{terminalId:terminal.id,sessionId:terminal.sessionId,reason});return true;
 }
 function terminalError(terminal,message){if(terminalSessions.get(terminal.deviceId)!==terminal)return;terminal.state='error';if(!terminal.errorAudited){db.audit(terminal.userId,terminal.deviceId,'terminal.error');terminal.errorAudited=true}browserTerminalEvent(terminal,'terminal:error',{message:String(message||'Terminal error').slice(0,160)});}
 function stop(d,event){closeTerminal(d,event);const l=db.release(d,event);if(l){agents.get(d)?.socket.emit('session:revoked',{sessionId:l.id,reason:event});io.to(l.browserId).emit('session:revoked',{deviceId:d,sessionId:l.id,reason:event})}}
 function visible(u){const now=Date.now();return db.all(`SELECT d.id,d.name,d.ownerId,CASE WHEN d.ownerId=? THEN 'owner' ELSE m.role END AS role,l.id AS sessionId,l.userId AS sessionUserId,l.state AS sessionState,l.expires AS sessionExpires FROM devices d LEFT JOIN members m ON m.deviceId=d.id AND m.userId=? LEFT JOIN leases l ON l.deviceId=d.id AND l.expires>? WHERE d.revoked=0 AND (d.ownerId=? OR m.userId IS NOT NULL)`,u,u,now,u).map(d=>{const a=agents.get(d.id),live=!!a&&now-a.seen<25000,status=deviceStatuses.get(d.id),capability=terminalCapabilities.get(d.id),terminal=terminalSessions.get(d.id);return {id:d.id,name:d.name,ownerId:d.ownerId,role:d.role,runnerStatus:live?'online':'offline',lastSeen:a?.seen??null,meshStatus:'not_integrated',status:live&&status&&now-status.updatedAt<=STATUS_MAX_AGE_MS?status:null,terminalSupported:live&&capability?.platform==='win32',terminalShells:live?capability?.shells??[]:[],terminal:terminal?{state:terminal.state,startedAt:terminal.startedAt}:null,session:d.sessionId?{id:d.sessionId,userId:d.sessionUserId,state:d.sessionState,expires:d.sessionExpires}:null}})}
 function broadcast(){const snapshots=new Map();for(const [id,u]of viewers){const s=io.sockets.sockets.get(id);if(!s)continue;if(!snapshots.has(u))snapshots.set(u,visible(u));s.emit('devices:snapshot',snapshots.get(u))}}
 app.get('/api/health',(req,res)=>res.json({status:'ok',at:Date.now()}));
 app.post('/api/auth/login',writeOrigin,rateLimit({windowMs:60000,limit:10}), (req,res)=>{const email=validString(req.body.email,254).toLowerCase(),pw=validString(req.body.password,256),u=db.one('SELECT * FROM users WHERE email=?',email);if(!passwordOK(pw,u?.password||'invalid'))fail(401,'Thông tin đăng nhập không đúng');const key=token();db.run('INSERT INTO logins VALUES(?,?,?)',hash(key),u.id,Date.now()+8*3600000);res.cookie('rca',key,{httpOnly:true,secure,sameSite:'strict',maxAge:8*3600000,path:'/'});res.json({id:u.id,email:u.email,name:u.name})});
 // Local enrollment authenticates with a one-use secret and requires console consent.
 app.post('/api/agents/enroll',rateLimit({windowMs:60000,limit:10}),(req,res)=>{res.status(201).json(db.enroll(validString(req.body.code,100)))});
 app.use('/api',writeOrigin,auth);
 app.get('/api/auth/me',(req,res)=>res.json(db.one('SELECT id,email,name FROM users WHERE id=?',req.userId)));
 app.post('/api/auth/logout',(req,res)=>{db.run('DELETE FROM logins WHERE hash=?',hash(cookie(req)));for(const [id,u]of viewers)if(u===req.userId&&cookie(io.sockets.sockets.get(id)?.request||{headers:{}})===cookie(req))io.sockets.sockets.get(id)?.disconnect(true);res.clearCookie('rca',{path:'/'});res.json({ok:true})});
 app.get('/api/devices',(req,res)=>res.json(visible(req.userId)));
 app.post('/api/pairing',(req,res)=>res.status(201).json({code:db.pair(req.userId,validString(req.body.name)),expiresIn:300}));
 app.get('/api/devices/:id/members',(req,res)=>{owner(req.params.id,req.userId);res.json(db.all('SELECT u.id,u.email,m.role FROM members m JOIN users u ON u.id=m.userId WHERE deviceId=?',req.params.id))});
 app.post('/api/devices/:id/members',(req,res)=>{const d=req.params.id;owner(d,req.userId);const u=db.one('SELECT id FROM users WHERE email=?',validString(req.body.email,254).toLowerCase());if(!u)fail(404,'Tài khoản chưa được tạo');if(u.id===req.userId)fail(400,'Owner đã có quyền');if(!['viewer','operator'].includes(req.body.role))fail(400,'Role không hợp lệ');db.run('INSERT INTO members VALUES(?,?,?) ON CONFLICT(deviceId,userId) DO UPDATE SET role=excluded.role',d,u.id,req.body.role);if(db.lease(d)?.userId===u.id)stop(d,'membership.changed');db.audit(req.userId,d,'membership.updated');broadcast();res.json({ok:true})});
 app.delete('/api/devices/:id/members/:userId',(req,res)=>{const d=req.params.id;owner(d,req.userId);db.run('DELETE FROM members WHERE deviceId=? AND userId=?',d,req.params.userId);if(db.lease(d)?.userId===req.params.userId)stop(d,'membership.removed');db.audit(req.userId,d,'membership.removed');broadcast();res.json({ok:true})});
 app.delete('/api/devices/:id',(req,res)=>{const d=req.params.id;owner(d,req.userId);stop(d,'device.revoked');db.run('UPDATE devices SET revoked=1 WHERE id=?',d);agents.get(d)?.socket.disconnect(true);db.audit(req.userId,d,'device.revoked');broadcast();res.json({ok:true})});
 app.get('/api/devices/:id/audit',(req,res)=>{owner(req.params.id,req.userId);res.json(db.all('SELECT * FROM audit WHERE deviceId=? ORDER BY at DESC LIMIT 100',req.params.id))});
 const dist=resolve(import.meta.dirname,'../../frontend/dist');if(existsSync(dist)){app.use(express.static(dist));app.get('/{*path}',(req,res)=>res.sendFile(resolve(dist,'index.html')))}
 app.use((e,req,res,next)=>{if(!e.status)console.error('Request failed',e.message);res.status(e.status||500).json({error:e.status?e.message:'Lỗi máy chủ'})});
 io.use((socket,next)=>{try{if(socket.handshake.auth.kind==='agent'){const a=db.agent(validString(socket.handshake.auth.credential,100));if(!a)fail(401,'Credential không hợp lệ');socket.data.deviceId=a.id}else{socket.data.userId=user(socket.request)}next()}catch(e){next(new Error(e.message))}});
 io.on('connection',socket=>{
  if(socket.data.deviceId){
   const d=socket.data.deviceId;if(agents.has(d)){socket.disconnect(true);return} // no silent replacement of an active agent
    deviceStatuses.delete(d);terminalCapabilities.delete(d);agents.set(d,{socket,seen:Date.now()});socket.emit('agent:ready',{deviceId:d});broadcast();
   socket.on('agent:heartbeat',(_,ack)=>{if(agents.get(d)?.socket!==socket)return;agents.get(d).seen=Date.now();ack?.({ok:true,at:Date.now()})});
   let lastStatusAt=0;
   socket.on('agent:status',(payload,ack)=>{if(agents.get(d)?.socket!==socket)return;try{const status=validateDeviceStatus(payload),now=Date.now();if(now-lastStatusAt<1000)fail(429,'Status được gửi quá thường xuyên');lastStatusAt=now;deviceStatuses.set(d,{...status,updatedAt:now});ack?.({ok:true,at:now});broadcast()}catch(e){ack?.({error:e.message,status:e.status||400})}});
    socket.on('agent:terminal-capabilities',(payload,ack)=>{if(agents.get(d)?.socket!==socket)return;try{if(!plainObject(payload)||!exactKeys(payload,['platform','shells'])||typeof payload.platform!=='string'||!Array.isArray(payload.shells)||payload.shells.length>TERMINAL_SHELLS.length||payload.shells.some(x=>!TERMINAL_SHELLS.includes(x))||new Set(payload.shells).size!==payload.shells.length||(payload.platform!=='win32'&&payload.shells.length))fail(400,'Terminal capabilities không hợp lệ');terminalCapabilities.set(d,{platform:payload.platform,shells:payload.platform==='win32'?payload.shells:[]});ack?.({ok:true});broadcast()}catch(e){terminalCapabilities.delete(d);ack?.({error:e.message,status:e.status||400})}});
    socket.on('terminal:opened',payload=>{const terminal=terminalSessions.get(d);if(agents.get(d)?.socket!==socket||!terminal)return;if(!plainObject(payload)||!exactKeys(payload,['terminalId','sessionId','shell','startedAt'])||payload.terminalId!==terminal.id||payload.sessionId!==terminal.sessionId||payload.shell!==terminal.shell||!Number.isSafeInteger(payload.startedAt)||!terminalLease(db,terminal)||terminal.state==='closing'){closeTerminal(d,'lease.invalid');return}terminal.state='connected';terminal.startedAt=payload.startedAt;db.audit(terminal.userId,d,'terminal.opened');browserTerminalEvent(terminal,'terminal:opened',{shell:terminal.shell,startedAt:terminal.startedAt});broadcast()});
    socket.on('terminal:output',payload=>{const terminal=terminalSessions.get(d);if(agents.get(d)?.socket!==socket||!terminal||terminal.state!=='connected')return;if(!plainObject(payload)||!exactKeys(payload,['terminalId','sessionId','text'])||payload.terminalId!==terminal.id||payload.sessionId!==terminal.sessionId||typeof payload.text!=='string'){closeTerminal(d,'terminal.output.invalid');return}const size=Buffer.byteLength(payload.text,'utf8');if(!size||size>MAX_TERMINAL_CHUNK_BYTES||terminal.outputBytes+size>MAX_TERMINAL_OUTPUT_BYTES||!terminalLease(db,terminal)){closeTerminal(d,'terminal.output.limit');return}terminal.outputBytes+=size;browserTerminalEvent(terminal,'terminal:output',{text:payload.text})});
    socket.on('terminal:exited',payload=>{const terminal=terminalSessions.get(d);if(agents.get(d)?.socket!==socket||!terminal||!plainObject(payload)||payload.terminalId!==terminal.id||payload.sessionId!==terminal.sessionId||!['closed','exited'].includes(payload.state))return;finishTerminal(terminal,'closed',typeof payload.reason==='string'?payload.reason.slice(0,80):'process.exit')});
    socket.on('terminal:error',payload=>{const terminal=terminalSessions.get(d);if(agents.get(d)?.socket!==socket||!terminal||payload?.terminalId!==terminal.id||payload?.sessionId!==terminal.sessionId)return;terminalError(terminal,payload.error)});
    socket.on('agent:terminal-state',(payload,ack)=>{if(agents.get(d)?.socket!==socket)return;if(!Array.isArray(payload)||payload.length>1||payload.some(x=>!plainObject(x)||!UUID.test(x.terminalId||'')||!UUID.test(x.sessionId||''))){ack?.({error:'Trạng thái Terminal không hợp lệ'});return}const terminal=terminalSessions.get(d);if(terminal&&!payload.some(x=>x.terminalId===terminal.id&&x.sessionId===terminal.sessionId))finishTerminal(terminal,'closed','agent.reconnected');else if(terminal?.state==='closing')closeTerminal(d,terminal.closeReason||'session.closing');ack?.({ok:true});broadcast()});
   socket.on('session:ack',(p,ack)=>{try{if(Date.now()-agents.get(d).seen>=25000)fail(409,'Heartbeat quá hạn');const l=db.ack(d,p?.sessionId,p?.nonce,p?.accept===true);if(l){socket.emit('session:active',{sessionId:l.id,expires:l.expires});io.to(l.browserId).emit('session:active',{deviceId:d,sessionId:l.id,expires:l.expires})}broadcast();ack?.({ok:true})}catch(e){ack?.({error:e.message})}});
    socket.on('disconnect',()=>{if(agents.get(d)?.socket===socket){agents.delete(d);deviceStatuses.delete(d);terminalCapabilities.delete(d);stop(d,'agent.disconnected');broadcast()}});
  }else{
   let eventWindow=Date.now(),eventCount=0;const u=socket.data.userId;viewers.set(socket.id,u);socket.emit('devices:snapshot',visible(u));
    function handle(event,fn,rateLimited=true){socket.on(event,(p,ack)=>{try{if(rateLimited){if(Date.now()-eventWindow>10000){eventWindow=Date.now();eventCount=0}if(++eventCount>100)fail(429,'Quá nhiều yêu cầu realtime')}if(user(socket.request)!==u)fail(401,'Phiên đăng nhập hết hạn');ack?.({ok:true,...fn(p||{})})}catch(e){ack?.({error:e.message,status:e.status||400})}})}
   handle('session:request',p=>{
    const d=validString(p.deviceId),a=agents.get(d),role=db.role(d,u),current=db.lease(d);
    if(!a||Date.now()-a.seen>=25000)fail(409,'Local Runner offline');
     if(terminalSessions.has(d)){if(p.force===true){if(role!=='owner')fail(403,'Chỉ owner được thu hồi');stop(d,'owner.takeover');broadcast()}fail(409,'Terminal đang chạy hoặc dừng; thử lại sau khi Local Runner xác nhận đã dừng')}
    const {lease:l,old}=db.request(d,u,socket.id,p.force===true);
    if(old){a.socket.emit('session:revoked',{sessionId:old.id,reason:'owner.takeover'});io.to(old.browserId).emit('session:revoked',{deviceId:d,sessionId:old.id,reason:'owner.takeover'})}
     const username=db.one('SELECT name FROM users WHERE id=?',u).name;a.socket.emit('session:offer',{sessionId:l.id,nonce:l.nonce,userId:u,userName:username,owner:role==='owner',expires:l.expires});broadcast();return {sessionId:l.id,state:'pending'}
    });
   handle('session:renew',p=>{const l=db.renew(p.deviceId,u,socket.id,p.sessionId);agents.get(p.deviceId)?.socket.emit('session:active',{sessionId:l.id,expires:l.expires});return {expires:l.expires}});
   handle('session:release',p=>{const l=db.lease(p.deviceId);db.role(p.deviceId,u);if(l&&(l.browserId!==socket.id||l.userId!==u))fail(403,'Không sở hữu phiên này');stop(p.deviceId,'lease.released');broadcast();return {}});
    handle('terminal:open',p=>{
     if(!plainObject(p)||!exactKeys(p,['deviceId','sessionId','shell','cols','rows']))fail(400,'Yêu cầu mở Terminal không hợp lệ');
     const d=validString(p.deviceId),sessionId=validString(p.sessionId,80),shell=p.shell,cols=p.cols,rows=p.rows,role=db.role(d,u),a=agents.get(d),lease=db.lease(d),capability=terminalCapabilities.get(d);
     if(role==='viewer')fail(403,'Viewer không được mở Terminal');if(!a||Date.now()-a.seen>=25000)fail(409,'Local Runner offline');
     if(!lease||lease.state!=='active'||lease.id!==sessionId||lease.userId!==u||lease.browserId!==socket.id)fail(403,'Cần active lease của phiên này');
     if(!capability||capability.platform!=='win32'||!capability.shells.includes(shell))fail(409,'CMD/PowerShell chỉ hỗ trợ trên Windows');
     if(!TERMINAL_SHELLS.includes(shell)||!Number.isInteger(cols)||cols<20||cols>300||!Number.isInteger(rows)||rows<5||rows>120)fail(400,'Shell hoặc kích thước Terminal không hợp lệ');
     if(terminalSessions.has(d))fail(409,'Thiết bị đã có Terminal session');
     const terminal={id:randomUUID(),deviceId:d,userId:u,browserId:socket.id,sessionId,shell,state:'connecting',startedAt:Date.now(),outputBytes:0,inputBytes:0};terminal.maxTimer=setTimeout(()=>closeTerminal(d,'session.timeout'),MAX_TERMINAL_SESSION_MS);terminal.maxTimer.unref?.();terminal.idleTimer=setTimeout(()=>closeTerminal(d,'idle.timeout'),IDLE_TERMINAL_MS);terminal.idleTimer.unref?.();terminalSessions.set(d,terminal);
     a.socket.timeout(5000).emit('terminal:open',{terminalId:terminal.id,sessionId,shell,cols,rows},(err,result)=>{if(terminalSessions.get(d)!==terminal)return;if(err||result?.error){terminalError(terminal,result?.error||'Local Agent không phản hồi');finishTerminal(terminal,'error','agent.open.failed')} });
     broadcast();return {terminalId:terminal.id,state:'connecting'};
    });
    handle('terminal:input',p=>{
     if(!plainObject(p)||!exactKeys(p,['deviceId','terminalId','sessionId','data']))fail(400,'Input Terminal không hợp lệ');
     const d=validString(p.deviceId),terminal=terminalSessions.get(d),a=agents.get(d),lease=db.lease(d);if(!terminal||terminal.id!==p.terminalId||terminal.sessionId!==p.sessionId||terminal.browserId!==socket.id||terminal.userId!==u)fail(404,'Không tìm thấy Terminal session của bạn');
     if(terminal.state!=='connected'||!lease||lease.state!=='active'||lease.id!==terminal.sessionId||lease.userId!==u||lease.browserId!==socket.id)fail(403,'Terminal không còn active lease');
     if(!a||Date.now()-a.seen>=25000)fail(409,'Local Runner offline');if(typeof p.data!=='string'||!p.data||Buffer.byteLength(p.data,'utf8')>MAX_TERMINAL_CHUNK_BYTES)fail(400,'Input Terminal vượt giới hạn');
     const size=Buffer.byteLength(p.data,'utf8');if(terminal.inputBytes+size>MAX_TERMINAL_INPUT_BYTES){closeTerminal(d,'terminal.input.limit');fail(413,'Terminal input vượt giới hạn phiên')};terminal.inputBytes+=size;clearTimeout(terminal.idleTimer);terminal.idleTimer=setTimeout(()=>closeTerminal(d,'idle.timeout'),IDLE_TERMINAL_MS);terminal.idleTimer.unref?.();
     a.socket.timeout(5000).emit('terminal:input',{terminalId:terminal.id,sessionId:terminal.sessionId,data:p.data},(err,result)=>{if((err||result?.error)&&terminalSessions.get(d)===terminal){terminalError(terminal,result?.error||'Không thể gửi input tới Local Agent');closeTerminal(d,'terminal.input.failed')}});return {ok:true};
    },false);
    handle('terminal:resize',p=>{
     if(!plainObject(p)||!exactKeys(p,['deviceId','terminalId','sessionId','cols','rows']))fail(400,'Resize Terminal không hợp lệ');
     const d=validString(p.deviceId),terminal=terminalSessions.get(d),a=agents.get(d),lease=db.lease(d);if(!terminal||terminal.id!==p.terminalId||terminal.sessionId!==p.sessionId||terminal.browserId!==socket.id||terminal.userId!==u)fail(404,'Không tìm thấy Terminal session của bạn');
     if(terminal.state!=='connected'||!lease||lease.state!=='active'||lease.id!==terminal.sessionId||lease.userId!==u||lease.browserId!==socket.id)fail(403,'Terminal không còn active lease');
     if(!a||Date.now()-a.seen>=25000)fail(409,'Local Runner offline');if(!Number.isInteger(p.cols)||p.cols<20||p.cols>300||!Number.isInteger(p.rows)||p.rows<5||p.rows>120)fail(400,'Kích thước Terminal không hợp lệ');
     clearTimeout(terminal.idleTimer);terminal.idleTimer=setTimeout(()=>closeTerminal(d,'idle.timeout'),IDLE_TERMINAL_MS);terminal.idleTimer.unref?.();a.socket.emit('terminal:resize',{terminalId:terminal.id,sessionId:terminal.sessionId,cols:p.cols,rows:p.rows});return {ok:true};
    });
    handle('terminal:close',p=>{
     if(!plainObject(p)||!exactKeys(p,['deviceId','terminalId','sessionId']))fail(400,'Yêu cầu đóng Terminal không hợp lệ');
     const d=validString(p.deviceId),terminal=terminalSessions.get(d),lease=db.lease(d);db.role(d,u);if(!terminal||terminal.id!==p.terminalId||terminal.sessionId!==p.sessionId||terminal.browserId!==socket.id||terminal.userId!==u)fail(404,'Không tìm thấy Terminal session của bạn');
     if(!lease||lease.state!=='active'||lease.id!==terminal.sessionId||lease.userId!==u||lease.browserId!==socket.id)fail(403,'Terminal không còn active lease');closeTerminal(d,'user.closed');return {state:'closing'};
    });
   socket.on('disconnect',()=>{viewers.delete(socket.id);for(const l of db.all('SELECT deviceId FROM leases WHERE browserId=?',socket.id))stop(l.deviceId,'browser.disconnected');broadcast()});
  }
 });
 const sweep=setInterval(()=>{for(const [d,a]of agents)if(Date.now()-a.seen>=25000)a.socket.disconnect(true);for(const l of db.all('SELECT deviceId FROM leases WHERE expires<=?',Date.now()))stop(l.deviceId,'lease.expired');for(const [id,u]of viewers){const s=io.sockets.sockets.get(id);try{if(!s||user(s.request)!==u)throw Error()}catch{s?.disconnect(true)}}db.run('DELETE FROM logins WHERE expires<=?',Date.now());db.run('DELETE FROM pairs WHERE expires<=?',Date.now());broadcast()},2000);sweep.unref();
 // A restart cannot revive a formerly active lease.
 db.run('DELETE FROM leases');
 return {app,http,io,db,close:async()=>{clearInterval(sweep);await new Promise(r=>io.close(r));db.db.close()}};
}
if(process.argv[1]===import.meta.filename){const core=createApp();core.http.listen(Number(process.env.PORT||4000),process.env.HOST||'127.0.0.1',()=>console.log('RCA backend listening'));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await core.close();process.exit(0)})}


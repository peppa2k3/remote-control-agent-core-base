import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {Server} from 'socket.io';
import {Store,hash,token,passwordOK,fail} from './store.js';
export function createApp({dbPath=process.env.DB_PATH||'./data/rca.sqlite',origin=process.env.PUBLIC_ORIGIN||'http://localhost:5173',secure=process.env.COOKIE_SECURE==='true'}={}) {
 const db=new Store(dbPath), app=express(), http=createServer(app);
 if(process.env.TRUST_PROXY==='true')app.set('trust proxy',1);
 app.use(helmet());app.use(express.json({limit:'16kb'}));
 app.use('/api',rateLimit({windowMs:60000,limit:180}));
 const io=new Server(http,{cors:{origin,credentials:true},maxHttpBufferSize:16384,allowRequest:(req,done)=>done(null,!req.headers.origin||req.headers.origin===origin)});
 const agents=new Map(), viewers=new Map();
 const cookie=req=>{const part=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('rca='));return part?part.slice(4):''};
 function user(req){const s=db.one('SELECT userId,expires FROM logins WHERE hash=?',hash(cookie(req)));if(!s||s.expires<Date.now())fail(401,'Cần đăng nhập');return s.userId}
 const auth=(req,res,next)=>{try{req.userId=user(req);next()}catch(e){next(e)}};
 const owner=(d,u)=>{if(db.role(d,u)!=='owner')fail(403,'Chỉ owner được thao tác')};
 const writeOrigin=(req,res,next)=>{if(['POST','PUT','DELETE','PATCH'].includes(req.method)&&req.headers.origin!==origin)return res.status(403).json({error:'Origin không hợp lệ'});next()};
 function validString(v,max=120){if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'Dữ liệu không hợp lệ');return v.trim()}
 function stop(d,event){const l=db.release(d,event);if(l){agents.get(d)?.socket.emit('session:revoked',{sessionId:l.id,reason:event});io.to(l.browserId).emit('session:revoked',{deviceId:d,sessionId:l.id,reason:event})}}
 function visible(u){const now=Date.now();return db.all(`SELECT d.id,d.name,d.ownerId,CASE WHEN d.ownerId=? THEN 'owner' ELSE m.role END AS role,l.id AS sessionId,l.userId AS sessionUserId,l.state AS sessionState,l.expires AS sessionExpires FROM devices d LEFT JOIN members m ON m.deviceId=d.id AND m.userId=? LEFT JOIN leases l ON l.deviceId=d.id AND l.expires>? WHERE d.revoked=0 AND (d.ownerId=? OR m.userId IS NOT NULL)`,u,u,now,u).map(d=>{const a=agents.get(d.id),live=!!a&&now-a.seen<25000;return {id:d.id,name:d.name,ownerId:d.ownerId,role:d.role,runnerStatus:live?'online':'offline',lastSeen:a?.seen??null,meshStatus:'not_integrated',session:d.sessionId?{id:d.sessionId,userId:d.sessionUserId,state:d.sessionState,expires:d.sessionExpires}:null}})}
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
   agents.set(d,{socket,seen:Date.now()});socket.emit('agent:ready',{deviceId:d});broadcast();
   socket.on('agent:heartbeat',(_,ack)=>{if(agents.get(d)?.socket!==socket)return;agents.get(d).seen=Date.now();ack?.({ok:true,at:Date.now()})});
   socket.on('session:ack',(p,ack)=>{try{if(Date.now()-agents.get(d).seen>=25000)fail(409,'Heartbeat quá hạn');const l=db.ack(d,p?.sessionId,p?.nonce,p?.accept===true);if(l){socket.emit('session:active',{sessionId:l.id,expires:l.expires});io.to(l.browserId).emit('session:active',{deviceId:d,sessionId:l.id,expires:l.expires})}broadcast();ack?.({ok:true})}catch(e){ack?.({error:e.message})}});
   socket.on('disconnect',()=>{if(agents.get(d)?.socket===socket){agents.delete(d);stop(d,'agent.disconnected');broadcast()}});
  }else{
   let eventWindow=Date.now(),eventCount=0;const u=socket.data.userId;viewers.set(socket.id,u);socket.emit('devices:snapshot',visible(u));
   function handle(event,fn){socket.on(event,(p,ack)=>{try{if(Date.now()-eventWindow>10000){eventWindow=Date.now();eventCount=0}if(++eventCount>100)fail(429,'Quá nhiều yêu cầu realtime');if(user(socket.request)!==u)fail(401,'Phiên đăng nhập hết hạn');ack?.({ok:true,...fn(p||{})})}catch(e){ack?.({error:e.message,status:e.status||400})}})}
   handle('session:request',p=>{const d=validString(p.deviceId),a=agents.get(d);db.role(d,u);if(!a||Date.now()-a.seen>=25000)fail(409,'Local Runner offline');const {lease:l,old}=db.request(d,u,socket.id,p.force===true);if(old){a.socket.emit('session:revoked',{sessionId:old.id,reason:'owner.takeover'});io.to(old.browserId).emit('session:revoked',{deviceId:d,sessionId:old.id,reason:'owner.takeover'})}const username=db.one('SELECT name FROM users WHERE id=?',u).name;a.socket.emit('session:offer',{sessionId:l.id,nonce:l.nonce,userId:u,userName:username,owner:db.role(d,u)==='owner',expires:l.expires});broadcast();return {sessionId:l.id,state:'pending'}});
   handle('session:renew',p=>{const l=db.renew(p.deviceId,u,socket.id,p.sessionId);agents.get(p.deviceId)?.socket.emit('session:active',{sessionId:l.id,expires:l.expires});return {expires:l.expires}});
   handle('session:release',p=>{const l=db.lease(p.deviceId);db.role(p.deviceId,u);if(l&&(l.browserId!==socket.id||l.userId!==u))fail(403,'Không sở hữu phiên này');stop(p.deviceId,'lease.released');broadcast();return {}});
   socket.on('disconnect',()=>{viewers.delete(socket.id);for(const l of db.all('SELECT deviceId FROM leases WHERE browserId=?',socket.id))stop(l.deviceId,'browser.disconnected');broadcast()});
  }
 });
 const sweep=setInterval(()=>{for(const [d,a]of agents)if(Date.now()-a.seen>=25000)a.socket.disconnect(true);for(const l of db.all('SELECT deviceId FROM leases WHERE expires<=?',Date.now()))stop(l.deviceId,'lease.expired');for(const [id,u]of viewers){const s=io.sockets.sockets.get(id);try{if(!s||user(s.request)!==u)throw Error()}catch{s?.disconnect(true)}}db.run('DELETE FROM logins WHERE expires<=?',Date.now());db.run('DELETE FROM pairs WHERE expires<=?',Date.now());broadcast()},2000);sweep.unref();
 // A restart cannot revive a formerly active lease.
 db.run('DELETE FROM leases');
 return {app,http,io,db,close:async()=>{clearInterval(sweep);await new Promise(r=>io.close(r));db.db.close()}};
}
if(process.argv[1]===import.meta.filename){const core=createApp();core.http.listen(Number(process.env.PORT||4000),process.env.HOST||'127.0.0.1',()=>console.log('RCA backend listening'));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await core.close();process.exit(0)})}


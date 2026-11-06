import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
export const hash = v => createHash('sha256').update(v).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function passwordHash(v) { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(v, salt, 64).toString('hex'); }
export function passwordOK(v, h) { try { const [s,k] = h.split(':'); return timingSafeEqual(scryptSync(v,s,64),Buffer.from(k,'hex')); } catch { return false; } }
export function fail(status, message) { throw Object.assign(new Error(message), {status}); }
export class Store {
 constructor(path) {
  if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
  this.db=new DatabaseSync(path); this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS logins(hash TEXT PRIMARY KEY,userId TEXT REFERENCES users(id),expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,ownerId TEXT REFERENCES users(id),credentialHash TEXT UNIQUE NOT NULL,revoked INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS members(deviceId TEXT REFERENCES devices(id),userId TEXT REFERENCES users(id),role TEXT CHECK(role IN ('viewer','operator')),PRIMARY KEY(deviceId,userId));
  CREATE TABLE IF NOT EXISTS pairs(hash TEXT PRIMARY KEY,ownerId TEXT REFERENCES users(id),name TEXT NOT NULL,expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS leases(deviceId TEXT PRIMARY KEY REFERENCES devices(id),id TEXT UNIQUE NOT NULL,userId TEXT REFERENCES users(id),browserId TEXT NOT NULL,nonce TEXT NOT NULL,state TEXT CHECK(state IN ('pending','active')),expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,userId TEXT,deviceId TEXT,event TEXT NOT NULL);`);
 }
 one(sql,...p){return this.db.prepare(sql).get(...p)}
 all(sql,...p){return this.db.prepare(sql).all(...p)}
 run(sql,...p){return this.db.prepare(sql).run(...p)}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const out=fn();this.db.exec('COMMIT');return out}catch(e){this.db.exec('ROLLBACK');throw e}}
 audit(u,d,e){this.run('INSERT INTO audit VALUES(?,?,?,?,?)',randomUUID(),Date.now(),u??null,d??null,e)}
 addUser(email,password,name){if(password.length<12)fail(400,'Mật khẩu tối thiểu 12 ký tự');const id=randomUUID();this.run('INSERT INTO users VALUES(?,?,?,?)',id,email.toLowerCase(),name,passwordHash(password));return id}
 role(d,u){const v=this.one('SELECT * FROM devices WHERE id=? AND revoked=0',d);if(!v)fail(404,'Không tìm thấy máy'); if(v.ownerId===u)return 'owner'; const m=this.one('SELECT role FROM members WHERE deviceId=? AND userId=?',d,u);if(!m)fail(403,'Không có quyền');return m.role}
 pair(u,name){const code=token();this.run('INSERT INTO pairs VALUES(?,?,?,?)',hash(code),u,name,Date.now()+300000);this.audit(u,null,'pair.created');return code}
 enroll(code){return this.tx(()=>{const p=this.one('SELECT * FROM pairs WHERE hash=?',hash(code));if(!p||p.expires<Date.now())fail(401,'Mã ghép cặp hết hạn hoặc đã dùng');this.run('DELETE FROM pairs WHERE hash=?',hash(code));const id=randomUUID(),credential=token();this.run('INSERT INTO devices(id,name,ownerId,credentialHash) VALUES(?,?,?,?)',id,p.name,p.ownerId,hash(credential));this.audit(p.ownerId,id,'device.enrolled');return {deviceId:id,credential}})}
 agent(credential){return this.one('SELECT * FROM devices WHERE credentialHash=? AND revoked=0',hash(credential))}
 lease(d){const l=this.one('SELECT * FROM leases WHERE deviceId=?',d);return l&&l.expires>Date.now()?l:null}
 request(d,u,b,force=false){return this.tx(()=>{const role=this.role(d,u);if(role==='viewer')fail(403,'Chỉ được xem');const old=this.lease(d);if(force&&role!=='owner')fail(403,'Chỉ owner được thu hồi');if(old&&!force)fail(409,'Máy đang có phiên điều khiển');this.run('DELETE FROM leases WHERE deviceId=?',d);const l={deviceId:d,id:randomUUID(),userId:u,browserId:b,nonce:token(),state:'pending',expires:Date.now()+20000};this.run('INSERT INTO leases VALUES(?,?,?,?,?,?,?)',d,l.id,u,b,l.nonce,l.state,l.expires);this.audit(u,d,old?'lease.takeover':'lease.request');return {lease:l,old}})}
 ack(d,id,nonce,accept){const l=this.lease(d);if(!l||l.id!==id||l.nonce!==nonce||l.state!=='pending')fail(409,'Handshake không hợp lệ');if(!accept){this.release(d,'lease.denied');return null}this.run("UPDATE leases SET state='active',expires=? WHERE deviceId=?",Date.now()+45000,d);this.audit(l.userId,d,'lease.accepted');return this.lease(d)}
 renew(d,u,b,id){const l=this.lease(d);this.role(d,u);if(!l||l.id!==id||l.userId!==u||l.browserId!==b||l.state!=='active')fail(403,'Phiên đã hết hiệu lực');this.run('UPDATE leases SET expires=? WHERE deviceId=?',Date.now()+45000,d);return this.lease(d)}
 release(d,event='lease.released'){const l=this.one('SELECT * FROM leases WHERE deviceId=?',d);this.run('DELETE FROM leases WHERE deviceId=?',d);if(l)this.audit(l.userId,d,event);return l}
}

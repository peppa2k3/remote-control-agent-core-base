import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
export const fingerprint=(operation,params)=>createHash('sha256').update(JSON.stringify({operation,params},(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)).digest('hex');
export function createWorkflowJournal(file,{now=Date.now}={}){
  if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});const db=new DatabaseSync(file);db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS jobs(jobId TEXT PRIMARY KEY,deviceId TEXT NOT NULL,userId TEXT NOT NULL,requestId TEXT NOT NULL,operation TEXT NOT NULL,fingerprint TEXT NOT NULL,grantId TEXT NOT NULL,fence INTEGER NOT NULL,originEngineInstanceId TEXT NOT NULL,engineSeq INTEGER NOT NULL DEFAULT 0,seq INTEGER NOT NULL DEFAULT 0,ack INTEGER NOT NULL DEFAULT 0,report TEXT,retired INTEGER NOT NULL DEFAULT 0,updatedAt INTEGER NOT NULL,UNIQUE(deviceId,userId,requestId));`);
  if(!db.prepare('PRAGMA table_info(jobs)').all().some(c=>c.name==='retired'))db.exec('ALTER TABLE jobs ADD COLUMN retired INTEGER NOT NULL DEFAULT 0');
  const get=id=>db.prepare('SELECT * FROM jobs WHERE jobId=?').get(id);
  function accept(p,g){
    const old=get(p.jobId),hash=fingerprint(p.operation,p.params);
    if(old){if(old.fingerprint!==hash||old.grantId!==p.grantId||old.fence!==p.fence)throw Object.assign(Error('IDEMPOTENCY_CONFLICT'),{code:'IDEMPOTENCY_CONFLICT',status:409});return {old:true,record:old};}
    if(db.prepare('SELECT count(*) n FROM jobs').get().n>=10000)throw Object.assign(Error('RETENTION_REQUIRED'),{code:'RETENTION_REQUIRED',status:409});
    db.prepare('INSERT INTO jobs(jobId,deviceId,userId,requestId,operation,fingerprint,grantId,fence,originEngineInstanceId,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.jobId,g.deviceId,g.userId,p.requestId,p.operation,hash,p.grantId,p.fence,p.engineInstanceId,now());return {old:false,record:get(p.jobId)};
  }
  function update(r){const old=get(r.jobId);if(!old||old.grantId!==r.grantId||old.fence!==r.fence||old.originEngineInstanceId!==r.originEngineInstanceId||r.seq<=old.engineSeq)return;
    const seq=old.seq+1,report={jobId:r.jobId,grantId:r.grantId,fence:r.fence,originEngineInstanceId:r.originEngineInstanceId,seq,state:r.state,runId:r.runId,progress:{index:r.progress.index,total:r.progress.total,action:null},quiescent:r.quiescent===true,reasonCode:r.reasonCode};db.prepare('UPDATE jobs SET engineSeq=?,seq=?,report=?,updatedAt=? WHERE jobId=?').run(r.seq,seq,JSON.stringify(report),now(),r.jobId);
  }
  return {get,accept,update,unconfirmed(deviceId){return db.prepare('SELECT * FROM jobs WHERE deviceId=? AND engineSeq=0 ORDER BY updatedAt LIMIT 20').all(deviceId);},cancelIntent(jobId,b){if(!get(jobId)&&db.prepare('SELECT count(*) n FROM jobs').get().n>=10000)throw Error('RETENTION_REQUIRED');if(!get(jobId))db.prepare('INSERT INTO jobs(jobId,deviceId,userId,requestId,operation,fingerprint,grantId,fence,originEngineInstanceId,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(jobId,b.deviceId,b.userId,b.requestId,b.operation,b.fingerprint,b.grantId,b.fence,b.originEngineInstanceId,now());},pending(deviceId){return db.prepare('SELECT report,seq,jobId,engineSeq FROM jobs WHERE deviceId=? AND seq>ack AND report IS NOT NULL ORDER BY updatedAt,jobId LIMIT 20').all(deviceId).map(r=>({...r,report:JSON.parse(r.report)}));},ack(id,seq){db.prepare('UPDATE jobs SET ack=max(ack,?) WHERE jobId=? AND seq>=?').run(seq,id,seq);},prune(){for(const r of db.prepare('SELECT * FROM jobs WHERE ack=seq AND seq>0 AND updatedAt<?').all(now()-30*86400000)){
    const p=r.report?JSON.parse(r.report):null;
    if(r.retired||p?.quiescent&&['succeeded','failed','cancelled','expired','rejected'].includes(p.state)){
      if(now()-r.updatedAt>90*86400000)db.prepare('DELETE FROM jobs WHERE jobId=?').run(r.jobId);else db.prepare('UPDATE jobs SET retired=1,report=NULL WHERE jobId=?').run(r.jobId);
    }
  }},close(){db.close();}};
}

import {randomUUID,createHash} from 'node:crypto';
export const terminal=new Set(['succeeded','failed','cancelled','expired','rejected']);
export const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const fingerprint=(operation,params)=>createHash('sha256').update(canonical({operation,params})).digest('hex');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};
export function migrateWorkflowJobs(db,{rollback=false}={}){
  db.db.exec('PRAGMA synchronous=FULL');
  db.tx(()=>{
    if(rollback){
      if(db.one("SELECT 1 FROM workflow_jobs WHERE quiescent=0 OR state NOT IN ('succeeded','failed','cancelled','expired','rejected') LIMIT 1"))fail('UNRESOLVED_JOBS');
      db.db.exec('DROP TABLE workflow_receipts; DROP TABLE workflow_jobs; DELETE FROM workflow_migrations WHERE version=1');return;
    }
    db.db.exec(`CREATE TABLE IF NOT EXISTS workflow_migrations(version INTEGER PRIMARY KEY,appliedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workflow_jobs(jobId TEXT PRIMARY KEY,deviceId TEXT NOT NULL REFERENCES devices(id),requestedBy TEXT NOT NULL REFERENCES users(id),browserId TEXT NOT NULL,sessionId TEXT NOT NULL,requestId TEXT NOT NULL,operation TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,grantId TEXT,fence INTEGER,engineInstanceId TEXT,runId TEXT,reportSeq INTEGER NOT NULL DEFAULT 0,quiescent INTEGER NOT NULL DEFAULT 0,reasonCode TEXT NOT NULL DEFAULT 'ACCEPTED',progress TEXT NOT NULL DEFAULT '{}',createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,deadline INTEGER NOT NULL,cancelled INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS workflow_job_device ON workflow_jobs(deviceId,createdAt,jobId);
      CREATE TABLE IF NOT EXISTS workflow_job_keys(deviceId TEXT NOT NULL,requestedBy TEXT NOT NULL,requestId TEXT NOT NULL,jobId TEXT NOT NULL,fingerprint TEXT NOT NULL,expiresAt INTEGER NOT NULL,PRIMARY KEY(deviceId,requestedBy,requestId));
      CREATE TABLE IF NOT EXISTS workflow_receipts(jobId TEXT PRIMARY KEY REFERENCES workflow_jobs(jobId) ON DELETE CASCADE,seq INTEGER NOT NULL,digest TEXT NOT NULL,receivedAt INTEGER NOT NULL);
      INSERT OR IGNORE INTO workflow_migrations VALUES(1,0);`);
    db.run('UPDATE workflow_migrations SET appliedAt=? WHERE version=1 AND appliedAt=0',Date.now());
  });
}
export function createWorkflowJobs(db,{now=Date.now,recover=true}={}){
  migrateWorkflowJobs(db);
  if(recover){db.run("UPDATE workflow_jobs SET state='cancelled',quiescent=1,reasonCode='BACKEND_RESTART',updatedAt=? WHERE state='queued'",now());db.run("UPDATE workflow_jobs SET state='unknown',quiescent=0,reasonCode='BACKEND_RESTART',updatedAt=? WHERE state IN ('dispatched','running','stopping')",now());}
  const get=id=>db.one('SELECT * FROM workflow_jobs WHERE jobId=?',id);
  function project(j){return {jobId:j.jobId,deviceId:j.deviceId,operation:j.operation,state:j.state,runId:j.runId,seq:j.reportSeq,progress:JSON.parse(j.progress),quiescent:!!j.quiescent,reasonCode:j.reasonCode,createdAt:j.createdAt,updatedAt:j.updatedAt};}
  function accept({deviceId,userId,browserId,sessionId,requestId,operation,params,deadline}){
    return db.tx(()=>{
      const hash=fingerprint(operation,params),key=db.one('SELECT * FROM workflow_job_keys WHERE deviceId=? AND requestedBy=? AND requestId=?',deviceId,userId,requestId);
      if(key){if(key.fingerprint!==hash)fail('IDEMPOTENCY_CONFLICT');const j=get(key.jobId);return {job:j||{jobId:key.jobId,state:'expired',quiescent:1},duplicate:true};}
      if(db.one('SELECT count(*) n FROM workflow_jobs WHERE deviceId=?',deviceId).n>=10000)fail('RETENTION_REQUIRED');
      const jobId=randomUUID(),at=now();db.run('INSERT INTO workflow_jobs(jobId,deviceId,requestedBy,browserId,sessionId,requestId,operation,fingerprint,state,createdAt,updatedAt,deadline) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',jobId,deviceId,userId,browserId,sessionId,requestId,operation,hash,'queued',at,at,deadline);
      db.run('INSERT INTO workflow_job_keys VALUES(?,?,?,?,?,?)',deviceId,userId,requestId,jobId,hash,at+90*86400000);return {job:get(jobId),duplicate:false};
    });
  }
  function dispatch(id,g){return db.tx(()=>{const j=get(id);if(j.state!=='queued'||j.cancelled||now()>=j.deadline)fail('JOB_CANCELLED');db.run("UPDATE workflow_jobs SET state='dispatched',grantId=?,fence=?,engineInstanceId=?,updatedAt=? WHERE jobId=?",g.grantId,g.fence,g.engineInstanceId,now(),id);return get(id);});}
  function uncertain(id,code='UNAVAILABLE'){const j=get(id);if(j&&!terminal.has(j.state))db.run("UPDATE workflow_jobs SET state='unknown',reasonCode=?,updatedAt=? WHERE jobId=?",code,now(),id);}
  function cancel(id){return db.tx(()=>{const j=get(id);if(!j)fail('NOT_FOUND',404);if(!terminal.has(j.state))db.run("UPDATE workflow_jobs SET cancelled=1,state=?,quiescent=?,reasonCode='CANCEL_REQUESTED',updatedAt=? WHERE jobId=?",j.state==='queued'?'cancelled':'stopping',j.state==='queued'?1:0,now(),id);return get(id);});}
  function merge(deviceId,r){return db.tx(()=>{
    const j=get(r.jobId);if(!j||j.deviceId!==deviceId||j.grantId!==r.grantId||j.fence!==r.fence||j.engineInstanceId!==r.originEngineInstanceId)fail('STALE_REPORT');
    if(r.seq<j.reportSeq)return {jobId:r.jobId,seq:r.seq};
    const digest=createHash('sha256').update(canonical(r)).digest('hex'),old=db.one('SELECT * FROM workflow_receipts WHERE jobId=?',r.jobId);
    if(r.seq===j.reportSeq){if(old?.digest!==digest)fail('REPORT_CONFLICT');return {jobId:r.jobId,seq:r.seq};}
    if(terminal.has(j.state)&&(j.state!==r.state||j.quiescent&&!r.quiescent))fail('TERMINAL_CONFLICT');
    if(j.runId&&r.runId!==j.runId)fail('REPORT_CONFLICT');
    if(j.cancelled&&['queued','dispatched','running'].includes(r.state)){db.run('UPDATE workflow_jobs SET reportSeq=? WHERE jobId=?',r.seq,r.jobId);db.run('INSERT INTO workflow_receipts VALUES(?,?,?,?) ON CONFLICT(jobId) DO UPDATE SET seq=excluded.seq,digest=excluded.digest,receivedAt=excluded.receivedAt',r.jobId,r.seq,digest,now());return {jobId:r.jobId,seq:r.seq};}
    db.run('UPDATE workflow_jobs SET state=?,runId=?,reportSeq=?,quiescent=?,reasonCode=?,progress=?,updatedAt=? WHERE jobId=?',r.state,r.runId,r.seq,r.quiescent?1:0,r.reasonCode,JSON.stringify(r.progress),now(),r.jobId);
    db.run('INSERT INTO workflow_receipts VALUES(?,?,?,?) ON CONFLICT(jobId) DO UPDATE SET seq=excluded.seq,digest=excluded.digest,receivedAt=excluded.receivedAt',r.jobId,r.seq,digest,now());return {jobId:r.jobId,seq:r.seq};
  });}
  function expire(){db.run("UPDATE workflow_jobs SET state='expired',quiescent=1,reasonCode='LEASE_EXPIRED',updatedAt=? WHERE state='queued' AND deadline<=?",now(),now());}
  function prune(){db.tx(()=>{db.run("DELETE FROM workflow_jobs WHERE quiescent=1 AND state IN ('succeeded','failed','cancelled','expired','rejected') AND updatedAt<?",now()-30*86400000);db.run('DELETE FROM workflow_job_keys WHERE expiresAt<? AND jobId NOT IN (SELECT jobId FROM workflow_jobs)',now());});}
  return {get,project,accept,dispatch,uncertain,cancel,merge,expire,prune,list(deviceId,userId,{cursor='',limit=20}={}){
    db.role(deviceId,userId);if(!Number.isInteger(limit)||limit<1||limit>50||cursor&&!/^[a-f0-9-]{36}$/.test(cursor))fail('INVALID_CURSOR',400);
    // Cursor is a device-scoped row identity, not a timestamp supplied by a browser.
    const after=cursor?get(cursor):null;if(cursor&&after?.deviceId!==deviceId)fail('INVALID_CURSOR',400);
    const rows=after?db.all('SELECT * FROM workflow_jobs WHERE deviceId=? AND (createdAt<? OR (createdAt=? AND jobId<?)) ORDER BY createdAt DESC,jobId DESC LIMIT ?',deviceId,after.createdAt,after.createdAt,cursor,limit):db.all('SELECT * FROM workflow_jobs WHERE deviceId=? ORDER BY createdAt DESC,jobId DESC LIMIT ?',deviceId,limit);
    return {version:1,checkedAt:now(),jobs:rows.map(project),cursor:rows.length===limit?rows.at(-1).jobId:null};
  }};
}

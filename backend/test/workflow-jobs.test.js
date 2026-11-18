import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../src/store.js';
import {createWorkflowJobs,migrateWorkflowJobs} from '../src/workflow-jobs.js';
function fixture(t){const db=new Store(':memory:');t.after(()=>db.db.close());const userId=db.addUser('jobs@test','fixture-password-123','Fixture'),other=db.addUser('other@test','fixture-password-123','Other'),d=db.enroll(db.pair(userId,'Fixture'));let clock=100000;const jobs=createWorkflowJobs(db,{now:()=>clock});const input={deviceId:d.deviceId,userId,browserId:'browser',sessionId:randomUUID(),requestId:'stable-key',operation:'run',params:{scenario:'wait',profile:'Default',variables:{a:1,b:2}},deadline:clock+10000};return {db,jobs,input,other,advance:ms=>clock+=ms};}
test('migration upgrades existing core, transaction request key is canonical and rollback refuses unresolved data',async t=>{
  const f=fixture(t);migrateWorkflowJobs(f.db);const values=await Promise.all(Array.from({length:10},()=>Promise.resolve().then(()=>f.jobs.accept(f.input))));assert.equal(values.filter(v=>!v.duplicate).length,1);assert.equal(new Set(values.map(v=>v.job.jobId)).size,1);
  assert(f.jobs.accept({...f.input,params:{variables:{b:2,a:1},profile:'Default',scenario:'wait'}}).duplicate);
  assert.throws(()=>f.jobs.accept({...f.input,operation:'stop',params:{runId:randomUUID()}}),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>migrateWorkflowJobs(f.db,{rollback:true}),/UNRESOLVED_JOBS/);
  f.jobs.cancel(values[0].job.jobId);migrateWorkflowJobs(f.db,{rollback:true});assert(f.db.one('SELECT * FROM users WHERE id=?',f.input.userId));migrateWorkflowJobs(f.db);assert(createWorkflowJobs(f.db,{recover:false}).accept(f.input).duplicate,'rollback must preserve retained idempotency keys');
});
test('reports commit monotonic sequence, duplicate ACK, terminal conflicts, membership and 30/90-day keys',t=>{
  const f=fixture(t),j=f.jobs.accept(f.input).job,g={grantId:randomUUID(),fence:1,engineInstanceId:randomUUID()};f.jobs.dispatch(j.jobId,g);
  const r={jobId:j.jobId,grantId:g.grantId,fence:1,originEngineInstanceId:g.engineInstanceId,seq:2,state:'succeeded',runId:randomUUID(),progress:{index:1,total:1,action:null},quiescent:true,reasonCode:'UPDATED'};
  assert.deepEqual(f.jobs.merge(j.deviceId,r),{jobId:j.jobId,seq:2});assert.deepEqual(f.jobs.merge(j.deviceId,r),{jobId:j.jobId,seq:2});f.jobs.merge(j.deviceId,{...r,seq:1,state:'running'});assert.equal(f.jobs.get(j.jobId).state,'succeeded');assert.throws(()=>f.jobs.merge(j.deviceId,{...r,seq:3,state:'running'}),/TERMINAL_CONFLICT/);
  assert.throws(()=>f.jobs.list(j.deviceId,f.other),/Không có quyền/);assert.equal(f.jobs.list(j.deviceId,f.input.userId).jobs[0].runId,r.runId);
  f.advance(31*86400000);f.jobs.prune();assert.equal(f.jobs.get(j.jobId),undefined);assert(f.jobs.accept(f.input).duplicate,'metadata expiry does not free a retained key');f.advance(60*86400000);f.jobs.prune();assert.equal(f.jobs.accept({...f.input,deadline:Date.now()+1000}).duplicate,false);
});
test('backend restart cancels queued intent and marks dispatched unknown without restoring leases or payload',t=>{
  const f=fixture(t),one=f.jobs.accept(f.input).job,two=f.jobs.accept({...f.input,requestId:'second'}).job;f.jobs.dispatch(two.jobId,{grantId:randomUUID(),fence:1,engineInstanceId:randomUUID()});
  const restarted=createWorkflowJobs(f.db);assert.equal(restarted.get(one.jobId).state,'cancelled');assert.equal(restarted.get(two.jobId).state,'unknown');assert.equal(restarted.get(two.jobId).quiescent,0);assert(!JSON.stringify(f.db.all('SELECT * FROM workflow_jobs')).includes('variables'));assert.throws(()=>migrateWorkflowJobs(f.db,{rollback:true}),/UNRESOLVED_JOBS/);
});

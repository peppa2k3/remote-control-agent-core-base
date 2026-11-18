import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createWorkflowJournal,fingerprint} from '../src/workflow-journal.js';
import helper from '../workflow-engine/test/helpers/engine.js';
const {temporary,removeTemporary}=helper;
test('adapter journal commits before HTTP, survives restart/ACK loss, pins device and keeps params out of receipts',t=>{
  const directory=temporary('adapter-journal-');let clock=1000;const open=()=>createWorkflowJournal(join(directory,'jobs.sqlite'),{now:()=>clock});let journal=open();t.after(()=>{journal.close();removeTemporary(directory);});
  const p={jobId:randomUUID(),requestId:'stable',operation:'run',params:{scenario:'wait',variables:{secret:'NEVER_REPORT'}},grantId:randomUUID(),fence:2,engineInstanceId:randomUUID()},g={deviceId:randomUUID(),userId:randomUUID()};
  assert.equal(journal.accept(p,g).old,false);assert.equal(journal.unconfirmed(g.deviceId).length,1);journal.close();journal=open();assert.equal(journal.accept(p,g).old,true);
  const r={jobId:p.jobId,grantId:p.grantId,fence:2,originEngineInstanceId:p.engineInstanceId,seq:3,state:'succeeded',runId:randomUUID(),progress:{index:1,total:1,action:'raw ignored'},quiescent:true,reasonCode:'UPDATED',token:'NEVER_REPORT'};
  journal.update(r);const pending=journal.pending(g.deviceId);assert.equal(pending.length,1);assert(!JSON.stringify(pending).includes('NEVER_REPORT'));assert.equal(journal.pending(randomUUID()).length,0);
  journal.close();journal=open();assert.equal(journal.pending(g.deviceId)[0].report.seq,pending[0].report.seq);journal.update({...r,seq:2,state:'running'});assert.equal(journal.pending(g.deviceId)[0].report.state,'succeeded');journal.ack(p.jobId,pending[0].seq);assert.equal(journal.pending(g.deviceId).length,0);
  assert.throws(()=>journal.accept({...p,params:{scenario:'changed'}},g),{code:'IDEMPOTENCY_CONFLICT'});assert.equal(journal.get(p.jobId).fingerprint,fingerprint(p.operation,p.params));
  const unresolved={...p,jobId:randomUUID(),requestId:'unresolved'};journal.accept(unresolved,g);journal.update({...r,jobId:unresolved.jobId,state:'unknown',quiescent:false});
  clock+=31*86400000;journal.prune();assert.equal(journal.get(p.jobId).report,null);assert(journal.accept(p,g).old);clock+=60*86400000;journal.prune();assert.equal(journal.get(p.jobId),undefined);assert(journal.get(unresolved.jobId),'unacked unknown is never pruned');
});

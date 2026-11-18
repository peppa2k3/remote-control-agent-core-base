const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('extension settlement requires an idle content script and finished debugger inputs; transport failure stays unknown',async()=>{
  let clock=0,requests=0,mode='idle';
  const event={addListener(){}};
  const chrome={debugger:{onDetach:event,onEvent:event},tabs:{onCreated:event,async sendMessage(tabId,message){requests++;if(mode==='disconnected')throw Error('port closed');if(message.type==='actionStatus')return mode==='old-content'?{ok:true}:{ok:true,busy:false};return {ok:true};}},runtime:{onMessage:event,onInstalled:event,onStartup:event},storage:{local:{async get(){return {}; }},onChanged:event},alarms:{create(){},onAlarm:event}};
  const context=vm.createContext({crypto:require('node:crypto').webcrypto,chrome,console:{warn(){}},setInterval(){},setTimeout,clearInterval(){},Date:{now:()=>{clock+=1000;return clock;}}});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../chrome-reels-extension/background.js'),'utf8')+'\nglobalThis.probe={settle};',context);
  const job={tabId:1,runId:'fixture',pendingInputs:0,uncertainInput:false};
  assert.equal(await context.probe.settle(job),true);
  mode='disconnected';assert.equal(await context.probe.settle(job),false);
  mode='old-content';assert.equal(await context.probe.settle(job),false);
  mode='idle';const before=requests;assert.equal(await context.probe.settle({...job,uncertainInput:true}),false);assert.equal(requests,before);
});

test('debugger ownership is acquired even when another CDP client reports the target attached',async()=>{
  const event={addListener(){}},commands=[];let rejectAttach=false,rejectProof=false,attaches=0;
  const chrome={debugger:{onDetach:event,onEvent:event,async getTargets(){return [{tabId:1,attached:true}];},async attach(){attaches++;if(rejectAttach)throw Error('already attached');},async sendCommand(t,method){commands.push(method);if(method==='Page.getFrameTree'&&rejectProof)throw Error('not attached');return {};}},tabs:{onCreated:event},runtime:{onMessage:event,onInstalled:event,onStartup:event},storage:{local:{async get(){return {}; }},onChanged:event},alarms:{create(){},onAlarm:event}};
  const context=vm.createContext({crypto:require('node:crypto').webcrypto,chrome,console:{warn(){}},setInterval(){},setTimeout,clearInterval(){}});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../chrome-reels-extension/background.js'),'utf8')+'\nglobalThis.probe={performInput,debuggerTabs};',context);
  await context.probe.performInput(1,{kind:'wheel',x:1,y:1,pixels:10});assert.equal(attaches,1);assert(commands.includes('Input.dispatchMouseEvent'));
  context.probe.debuggerTabs.clear();rejectAttach=true;rejectProof=true;commands.length=0;
  await assert.rejects(context.probe.performInput(1,{kind:'wheel',x:1,y:1,pixels:10}),/not attached/);assert.deepEqual(commands,['Page.getFrameTree']);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('extension settlement requires an idle content script and finished debugger inputs; transport failure stays unknown',async()=>{
  let clock=0,requests=0,mode='idle';
  const event={addListener(){}};
  const chrome={debugger:{onDetach:event,onEvent:event},tabs:{onCreated:event,async sendMessage(tabId,message){requests++;if(mode==='disconnected')throw Error('port closed');if(message.type==='actionStatus')return mode==='old-content'?{ok:true}:{ok:true,busy:false};return {ok:true};}},runtime:{onMessage:event,onInstalled:event,onStartup:event},storage:{local:{async get(){return {}; }},onChanged:event},alarms:{create(){},onAlarm:event}};
  const context=vm.createContext({chrome,console:{warn(){}},setInterval(){},setTimeout,clearInterval(){},Date:{now:()=>{clock+=1000;return clock;}}});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../chrome-reels-extension/background.js'),'utf8')+'\nglobalThis.probe={settle};',context);
  const job={tabId:1,runId:'fixture',pendingInputs:0,uncertainInput:false};
  assert.equal(await context.probe.settle(job),true);
  mode='disconnected';assert.equal(await context.probe.settle(job),false);
  mode='old-content';assert.equal(await context.probe.settle(job),false);
  mode='idle';const before=requests;assert.equal(await context.probe.settle({...job,uncertainInput:true}),false);assert.equal(requests,before);
});

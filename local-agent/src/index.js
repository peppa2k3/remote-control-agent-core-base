import {io} from 'socket.io-client';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {createStatusSampler,parseStatusIntervalSeconds} from './status.js';
import {createScriptRunner,loadScriptRegistry,publicScriptCatalog} from './script-runner.js';
const url=process.env.SERVER_URL||'http://localhost:4000';
const statusIntervalSeconds=parseStatusIntervalSeconds();
const endpoint=new URL(url);if(endpoint.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)&&process.env.ALLOW_INSECURE_REMOTE!=='true')throw Error('Kết nối VPS bắt buộc HTTPS');
const file=resolve(process.env.CREDENTIALS_PATH||'./data/credentials.json');
const scriptsFile=resolve(process.env.SCRIPTS_PATH||'./data/scripts.json');
const scriptRegistry=loadScriptRegistry(scriptsFile),scriptCatalog=publicScriptCatalog(scriptRegistry);
const rl=createInterface({input:process.stdin,output:process.stdout});
let credential;
if(existsSync(file)){credential=JSON.parse(readFileSync(file,'utf8'));if(credential.server!==url)throw Error('Credential thuộc server khác; ghép cặp lại bằng file mới')}else{
 const code=process.env.PAIR_CODE;if(!code)throw Error('Điền PAIR_CODE trong local-agent/.env');
 const answer=await rl.question(`Cho phép ghép cặp máy này với ${url}? Gõ YES: `);if(answer!=='YES')throw Error('Đã từ chối ghép cặp');
 const res=await fetch(url+'/api/agents/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const data=await res.json();if(!res.ok)throw Error(data.error);
 credential={...data,server:url};mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify(credential),{mode:0o600});console.log('Ghép cặp thành công; xóa PAIR_CODE khỏi .env.');
}
const socket=io(url,{auth:{kind:'agent',credential:credential.credential},transports:['websocket'],reconnectionDelay:1000,reconnectionDelayMax:10000,randomizationFactor:.5});
let active=null,offered=null,promptAbort=null,statusTimer=null,statusBusy=false,statusErrorLogged=false,disconnectCleanup=Promise.resolve();
const statusSampler=createStatusSampler({maxSampleGapMs:statusIntervalSeconds*2000});
const scriptRunner=createScriptRunner({registry:scriptRegistry,
 onStarted:payload=>socket.emit('script:started',payload),
 onOutput:payload=>socket.emit('script:output',payload),
 onFinished:payload=>socket.emit('script:finished',payload),
});
async function reportStatus(){
 if(!socket.connected||statusBusy)return;
 statusBusy=true;
 try{
  const status=await statusSampler.sample();
  if(status&&socket.connected)socket.timeout(5000).emit('agent:status',status,(err,result)=>{if(err||result?.error){if(!statusErrorLogged)console.error('Không gửi được status thiết bị tới VPS');statusErrorLogged=true}else statusErrorLogged=false});
  else statusErrorLogged=false;
 }catch{if(!statusErrorLogged)console.error('Không đọc được status CPU/RAM/mạng trên máy này');statusErrorLogged=true}
 finally{statusBusy=false}
}
socket.on('connect',async()=>{console.log('Đã kết nối VPS');await disconnectCleanup;if(!socket.connected)return;socket.emit('agent:scripts',scriptCatalog,result=>{if(result?.error){console.error('Không gửi được danh sách script đã cấu hình');return}socket.emit('agent:script-state',scriptRunner.activeJobs.map(job=>job.jobId),stateResult=>{if(stateResult?.error)console.error('Không đồng bộ được trạng thái script')})});statusSampler.reset();void reportStatus();statusTimer=setInterval(()=>void reportStatus(),statusIntervalSeconds*1000)});
socket.on('connect_error',e=>console.error('Lỗi kết nối:',e.message));
socket.on('disconnect',()=>{disconnectCleanup=scriptRunner.cancelAll('agent.disconnected');if(statusTimer)clearInterval(statusTimer);statusTimer=null;statusSampler.reset();active=null;offered=null;promptAbort?.abort();console.log('Mất kết nối; phiên điều khiển đã hủy')});
socket.on('session:offer',async p=>{
 promptAbort?.abort();offered=p.sessionId;let accept=process.env.AUTO_APPROVE_SESSIONS==='true';
 if(!accept){const controller=new AbortController();promptAbort=controller;const timer=setTimeout(()=>controller.abort(),Math.max(1,p.expires-Date.now()));try{accept=(await rl.question(`\n${p.userName}${p.owner?' [OWNER]':''} xin điều khiển. Gõ YES để chấp nhận: `,{signal:controller.signal}))==='YES'}catch{accept=false}finally{clearTimeout(timer);if(promptAbort===controller)promptAbort=null}}
 if(offered!==p.sessionId||Date.now()>=p.expires||!socket.connected)return;
 socket.emit('session:ack',{sessionId:p.sessionId,nonce:p.nonce,accept},r=>{if(r?.error)console.error(r.error)});
});
socket.on('session:active',p=>{active=p;offered=null;console.log('Phiên được cấp hoặc gia hạn:',p.sessionId)});
socket.on('session:revoked',p=>{void scriptRunner.cancelSession(p.sessionId,'lease.revoked');if(active?.sessionId===p.sessionId)active=null;if(offered===p.sessionId){offered=null;promptAbort?.abort()}console.log('Phiên bị thu hồi:',p.reason)});
socket.on('script:run',async(p,ack)=>{
 try{
  if(!p||typeof p!=='object'||active?.sessionId!==p.sessionId||Date.now()>=active.expires)throw Error('Lease không còn hiệu lực');
  const result=await scriptRunner.start({jobId:p.jobId,sessionId:p.sessionId,scriptId:p.scriptId,params:p.params});ack?.({ok:true,...result});
 }catch(e){socket.emit('script:finished',{jobId:p?.jobId,sessionId:p?.sessionId,state:'failed',exitCode:null,durationMs:0,error:'Không thể khởi chạy script đã cấu hình'});ack?.({error:e.message||'Không chạy được script'})}
});
socket.on('script:stop',(p,ack)=>{
 if(!p||active?.sessionId!==p.sessionId||Date.now()>=active.expires){ack?.({error:'Lease không còn hiệu lực'});return}
 const exists=scriptRunner.activeJobs.some(job=>job.jobId===p.jobId);if(exists)scriptRunner.cancel(p.jobId,p.reason||'cancelled');else socket.emit('script:finished',{jobId:p.jobId,sessionId:p.sessionId,state:'cancelled',exitCode:null,durationMs:0,reason:'runner.confirmed-stopped'});
 ack?.({ok:true,stopping:exists});
});
const beat=setInterval(()=>{if(socket.connected)socket.emit('agent:heartbeat',{},()=>{});if(active&&Date.now()>=active.expires){void scriptRunner.cancelSession(active.sessionId,'lease.expired');active=null;console.log('Lease hết hạn tại local')}},5000);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{clearInterval(beat);if(statusTimer)clearInterval(statusTimer);await scriptRunner.cancelAll('agent.shutdown');socket.disconnect();rl.close();process.exit(0)});
// Local scripts use an explicit allowlist; arbitrary shell and remote desktop relay remain unavailable here.

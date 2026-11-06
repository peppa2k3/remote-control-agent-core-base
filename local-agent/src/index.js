import {io} from 'socket.io-client';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
const url=process.env.SERVER_URL||'http://localhost:4000';
const endpoint=new URL(url);if(endpoint.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)&&process.env.ALLOW_INSECURE_REMOTE!=='true')throw Error('Kết nối VPS bắt buộc HTTPS');
const file=resolve(process.env.CREDENTIALS_PATH||'./data/credentials.json');
const rl=createInterface({input:process.stdin,output:process.stdout});
let credential;
if(existsSync(file)){credential=JSON.parse(readFileSync(file,'utf8'));if(credential.server!==url)throw Error('Credential thuộc server khác; ghép cặp lại bằng file mới')}else{
 const code=process.env.PAIR_CODE;if(!code)throw Error('Điền PAIR_CODE trong local-agent/.env');
 const answer=await rl.question(`Cho phép ghép cặp máy này với ${url}? Gõ YES: `);if(answer!=='YES')throw Error('Đã từ chối ghép cặp');
 const res=await fetch(url+'/api/agents/enroll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const data=await res.json();if(!res.ok)throw Error(data.error);
 credential={...data,server:url};mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify(credential),{mode:0o600});console.log('Ghép cặp thành công; xóa PAIR_CODE khỏi .env.');
}
const socket=io(url,{auth:{kind:'agent',credential:credential.credential},transports:['websocket'],reconnectionDelay:1000,reconnectionDelayMax:10000,randomizationFactor:.5});
let active=null,offered=null,promptAbort=null;
socket.on('connect',()=>console.log('Đã kết nối VPS'));
socket.on('connect_error',e=>console.error('Lỗi kết nối:',e.message));
socket.on('disconnect',()=>{active=null;offered=null;promptAbort?.abort();console.log('Mất kết nối; phiên điều khiển đã hủy')});
socket.on('session:offer',async p=>{
 promptAbort?.abort();offered=p.sessionId;let accept=process.env.AUTO_APPROVE_SESSIONS==='true';
 if(!accept){const controller=new AbortController();promptAbort=controller;const timer=setTimeout(()=>controller.abort(),Math.max(1,p.expires-Date.now()));try{accept=(await rl.question(`\n${p.userName}${p.owner?' [OWNER]':''} xin điều khiển. Gõ YES để chấp nhận: `,{signal:controller.signal}))==='YES'}catch{accept=false}finally{clearTimeout(timer);if(promptAbort===controller)promptAbort=null}}
 if(offered!==p.sessionId||Date.now()>=p.expires||!socket.connected)return;
 socket.emit('session:ack',{sessionId:p.sessionId,nonce:p.nonce,accept},r=>{if(r?.error)console.error(r.error)});
});
socket.on('session:active',p=>{active=p;offered=null;console.log('Phiên được cấp hoặc gia hạn:',p.sessionId)});
socket.on('session:revoked',p=>{if(active?.sessionId===p.sessionId)active=null;if(offered===p.sessionId){offered=null;promptAbort?.abort()}console.log('Phiên bị thu hồi:',p.reason)});
const beat=setInterval(()=>{if(socket.connected)socket.emit('agent:heartbeat',{},()=>{});if(active&&Date.now()>=active.expires){active=null;console.log('Lease hết hạn tại local')}},5000);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{clearInterval(beat);socket.disconnect();rl.close();process.exit(0)});
// Phase 1 deliberately has no shell, job runner, or remote desktop relay.

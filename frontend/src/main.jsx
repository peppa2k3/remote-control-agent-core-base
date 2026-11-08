import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {io} from 'socket.io-client';
import './style.css';
import './script-console.css';
import './remote-terminal.css';
const RemoteTerminal=lazy(()=>import('./RemoteTerminal.jsx'));

async function api(path,body,method){
 const r=await fetch('/api'+path,{method:method||(body?'POST':'GET'),credentials:'include',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const d=await r.json();if(!r.ok)throw Error(d.error);return d;
}

function formatBytes(value){
 if(!Number.isFinite(value))return '—';
 const units=['B','KB','MB','GB','TB'];let amount=value,index=0;
 while(amount>=1024&&index<units.length-1){amount/=1024;index++}
 return `${amount.toLocaleString('vi-VN',{maximumFractionDigits:index?1:0})} ${units[index]}`;
}

function formatUptime(value){
 if(!Number.isFinite(value)||value<0)return '—';
 const days=Math.floor(value/86400),hours=Math.floor(value%86400/3600),minutes=Math.floor(value%3600/60);
 return [days&&`${days} ngày`,hours&&`${hours} giờ`,`${minutes} phút`].filter(Boolean).join(' ');
}

function StatusTable({device}){
 const status=device.status;
 const rows=[
  ['CPU',status?`${status.cpuPercent.toLocaleString('vi-VN',{maximumFractionDigits:1})}%`:'—'],
  ['RAM',status?`${formatBytes(status.ramUsedBytes)} / ${formatBytes(status.ramTotalBytes)} (${(status.ramUsedBytes/status.ramTotalBytes*100).toLocaleString('vi-VN',{maximumFractionDigits:1})}%)`:'—'],
  ['Mạng tải xuống',status?`${formatBytes(status.networkRxBytesPerSecond)}/s`:'—'],
  ['Mạng tải lên',status?`${formatBytes(status.networkTxBytesPerSecond)}/s`:'—'],
  ['Uptime',status?formatUptime(status.uptimeSeconds):'—'],
 ];
 const note=status?`Cập nhật lúc ${new Date(status.updatedAt).toLocaleTimeString('vi-VN')}`:device.runnerStatus==='online'?'Đang chờ báo cáo đầu tiên từ Local Runner.':'Không có số liệu mới; Local Runner đang offline.';
 return <div className="status-wrap"><table className="status-table"><caption>Trạng thái thiết bị</caption><thead><tr><th scope="col">Thông số</th><th scope="col">Giá trị</th></tr></thead><tbody>{rows.map(([label,result])=><tr key={label}><th scope="row">{label}</th><td>{result}</td></tr>)}</tbody></table><small className="status-note">{note}</small></div>;
}

function ScriptParameter({parameter}){
 if(parameter.type==='boolean')return <label className="script-checkbox"><input type="checkbox" name={parameter.name}/> {parameter.label}</label>;
 if(parameter.type==='choice'||parameter.type==='file')return <label className="script-field">{parameter.label}<select name={parameter.name} required={parameter.required}><option value="">Chọn…</option>{parameter.options.map(option=><option value={option.value} key={option.value}>{option.label}</option>)}</select></label>;
 return <label className="script-field">{parameter.label}<input name={parameter.name} type="text" required={parameter.required} maxLength={parameter.maxLength} autoComplete="off"/></label>;
}

function ScriptPanel({device,mine,connected,scriptJobs,event,setScriptJobs}){
 const scripts=device.scripts||[],sessionId=mine.current.get(device.id),job=scriptJobs[device.id];
 const hasLease=!!sessionId&&device.session?.id===sessionId&&device.session.state==='active';
 const canRun=connected&&device.runnerStatus==='online'&&device.role!=='viewer'&&hasLease;
 const jobRunning=job&&['requesting','starting','running','stopping'].includes(job.state);
 function submit(e,script){
  e.preventDefault();const form=e.currentTarget,formData=new FormData(form),params={};
  for(const parameter of script.parameters){
   if(parameter.type==='boolean')params[parameter.name]=formData.get(parameter.name)==='on';
   else {const value=formData.get(parameter.name);if(value!==null&&value!=='')params[parameter.name]=String(value)}
  }
  setScriptJobs(previous=>({...previous,[device.id]:{jobId:null,sessionId,scriptId:script.id,state:'requesting',output:[]}}));
  event('script:run',{deviceId:device.id,sessionId,scriptId:script.id,params},result=>setScriptJobs(previous=>{
   const current=previous[device.id];if(!current||current.sessionId!==sessionId||(current.jobId===result.jobId&&!['requesting','starting'].includes(current.state)))return previous;
   return {...previous,[device.id]:{...current,jobId:result.jobId,state:result.state||'starting'}};
  }));
 }
 return <section className="script-panel"><h3>Kịch bản trên máy</h3>
  {!scripts.length?<p className="script-note">Chưa có script allowlist. Cấu hình `local-agent/data/scripts.json` trên máy local.</p>:scripts.map(script=><details className="script-option" key={script.id}>
   <summary>{script.label}</summary>{script.description&&<p className="script-note">{script.description}</p>}
   <form onSubmit={e=>submit(e,script)}>{script.parameters.map(parameter=><ScriptParameter parameter={parameter} key={parameter.name}/>)}
    <button disabled={!canRun||jobRunning}>{jobRunning?'Đang chạy…':'Chạy kịch bản'}</button>
   </form>
  </details>)}
  {!hasLease&&device.role!=='viewer'&&<small className="script-note">Yêu cầu và xác nhận phiên điều khiển trước khi chạy script.</small>}
  {job&&<div className="script-output"><div className="row"><strong>{job.scriptLabel||job.scriptId||'Script'} · {job.state}</strong>{jobRunning&&job.jobId&&<button className="warn" disabled={!canRun} onClick={()=>event('script:stop',{deviceId:device.id,sessionId:job.sessionId,jobId:job.jobId},result=>setScriptJobs(previous=>({...previous,[device.id]:{...previous[device.id],state:result.state||'stopping'}})))}>Dừng</button>}</div>{job.error&&<p role="status">{job.error}</p>}{job.exitCode!==undefined&&<small>Exit code: {job.exitCode??'không có'}{job.durationMs!==undefined?` · ${job.durationMs} ms`:''}</small>}<pre aria-live="polite">{job.output?.map((entry,index)=><span className={entry.stream} key={`${index}-${entry.stream}`}>{entry.text}</span>)}</pre></div>}
 </section>;
}

function RemoteTerminalLauncher(props){
 const [show,setShow]=useState(false);if(!show)return <div className="remote-terminal-launcher"><button className="secondary" disabled={!props.device.terminalSupported} onClick={()=>setShow(true)}>Remote Terminal</button></div>;
 return <Suspense fallback={<p className="terminal-note">Đang tải giao diện terminal…</p>}><RemoteTerminal {...props}/></Suspense>;
}

function DeviceCard({device,user,connected,mine,event,attempt,setMessage,scriptJobs,setScriptJobs,terminalSessions,setTerminalSessions,terminalTargets}){
 return <article className="panel" key={device.id}>
  <div className="row"><h2>{device.name}</h2><span className={'badge '+(device.runnerStatus==='online'?'on':'')}>{device.runnerStatus}</span></div>
  <p>Quyền: <strong>{device.role}</strong></p>
  <p>Local Runner: {device.runnerStatus} · MeshCentral: chưa tích hợp</p>
  <p>{device.session?`Phiên ${device.session.state} · ${device.session.userId===user.id?'tài khoản của bạn':'người quản lý khác'}`:'Chưa có phiên điều khiển'}</p>
  <StatusTable device={device}/>
  <ScriptPanel device={device} mine={mine} connected={connected} scriptJobs={scriptJobs} event={event} setScriptJobs={setScriptJobs}/>
  <RemoteTerminalLauncher device={device} sessionId={mine.current.get(device.id)} connected={connected} canControl={device.role!=='viewer'} blocked={!!(scriptJobs[device.id]&&['requesting','starting','running','stopping'].includes(scriptJobs[device.id].state))} event={event} terminalSessions={terminalSessions} setTerminalSessions={setTerminalSessions} targets={terminalTargets}/>
  <small>{device.id}</small>
  <div className="actions">
   <button disabled={!connected||device.runnerStatus!=='online'||device.role==='viewer'||!!device.session} onClick={()=>event('session:request',{deviceId:device.id})}>Yêu cầu điều khiển</button>
   {device.role==='owner'&&device.session&&<button className="warn" onClick={()=>event('session:request',{deviceId:device.id,force:true})}>Owner lấy quyền</button>}
   <button className="secondary" disabled={!mine.current.has(device.id)} onClick={()=>event('session:release',{deviceId:device.id})}>Kết thúc phiên</button>
  </div>
  {device.role==='owner'&&<>
   <details><summary>Thêm người quản lý</summary><form onSubmit={e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));attempt(async()=>{await api(`/devices/${device.id}/members`,f);setMessage('Đã cập nhật quyền quản lý')})}}><input name="email" type="email" placeholder="Email tài khoản đã tạo" required/><select name="role"><option value="viewer">Viewer · chỉ xem</option><option value="operator">Operator · điều khiển</option></select><button>Cấp quyền</button></form></details>
   <button className="secondary" onClick={()=>{if(window.confirm('Thu hồi máy và hủy mọi phiên?'))attempt(()=>api(`/devices/${device.id}`,undefined,'DELETE'))}}>Thu hồi thiết bị</button>
  </>}
 </article>;
}

function App(){
 const [user,setUser]=useState(null),[devices,setDevices]=useState([]),[error,setError]=useState(''),[connected,setConnected]=useState(false),[pair,setPair]=useState(''),[message,setMessage]=useState(''),[scriptJobs,setScriptJobs]=useState({}),[terminalSessions,setTerminalSessions]=useState({});
 const socket=useRef(null),mine=useRef(new Map());
 const terminalTargets=useRef(null);if(!terminalTargets.current){terminalTargets.current=new Map();terminalTargets.current.pending=new Map()}
 useEffect(()=>{api('/auth/me').then(setUser).catch(()=>{})},[]);
 useEffect(()=>{
  if(!user)return;
  const s=io({autoConnect:false,withCredentials:true});socket.current=s;
  s.on('connect',()=>setConnected(true));
  s.on('disconnect',()=>{setConnected(false);mine.current.clear();setDevices([]);setScriptJobs({});setTerminalSessions({});terminalTargets.current.clear();terminalTargets.current.pending.clear()});
  s.on('connect_error',e=>setError(e.message));
  s.on('devices:snapshot',setDevices);
  s.on('session:active',p=>{mine.current.set(p.deviceId,p.sessionId);setMessage('Local đã xác nhận phiên điều khiển')});
  s.on('session:revoked',p=>{mine.current.delete(p.deviceId);setMessage('Phiên đã kết thúc: '+p.reason)});
  s.on('terminal:opened',p=>setTerminalSessions(previous=>({...previous,[p.deviceId]:{...(previous[p.deviceId]||{}),...p,state:'connected'}})));
  s.on('terminal:output',p=>{const target=terminalTargets.current.get(p.deviceId);if(target)target.write(p.text);else{const pending=terminalTargets.current.pending.get(p.deviceId)||[];if(pending.reduce((total,text)=>total+new TextEncoder().encode(text).length,0)<4*1024*1024){pending.push(p.text);terminalTargets.current.pending.set(p.deviceId,pending)}}});
  s.on('terminal:status',p=>setTerminalSessions(previous=>({...previous,[p.deviceId]:{...(previous[p.deviceId]||{}),...p}})));
  s.on('terminal:error',p=>{setError(p.message||'Remote Terminal gặp lỗi');setTerminalSessions(previous=>({...previous,[p.deviceId]:{...(previous[p.deviceId]||{}),...p,state:'error'}}))});
  s.on('terminal:closed',p=>{terminalTargets.current.pending.delete(p.deviceId);setTerminalSessions(previous=>{const next={...previous};delete next[p.deviceId];return next})});
  function updateJob(p,patch,appendOutput=false){setScriptJobs(previous=>{const current=previous[p.deviceId];if(current?.jobId&&current.jobId!==p.jobId&&!current.requesting)return previous;const base=current?.jobId===p.jobId?current:{...current,jobId:p.jobId,sessionId:p.sessionId,output:current?.output||[]};return {...previous,[p.deviceId]:{...base,...patch,requesting:false,...(appendOutput?{output:[...(base.output||[]),{stream:p.stream,text:p.text}]}:{})}}})}
  s.on('script:started',p=>updateJob(p,{jobId:p.jobId,sessionId:p.sessionId,scriptId:p.scriptId,scriptLabel:p.label,state:'running'}));
  s.on('script:output',p=>updateJob(p,{},true));
  s.on('script:stopping',p=>updateJob(p,{jobId:p.jobId,sessionId:p.sessionId,state:'stopping',reason:p.reason}));
  s.on('script:finished',p=>updateJob(p,{jobId:p.jobId,sessionId:p.sessionId,state:p.state,exitCode:p.exitCode,durationMs:p.durationMs,error:p.error}));
  s.connect();
  const renew=setInterval(()=>{for(const [deviceId,sessionId]of mine.current)s.emit('session:renew',{deviceId,sessionId},r=>{if(r?.error){mine.current.delete(deviceId);setError(r.error)}})},10000);
  return()=>{clearInterval(renew);s.disconnect();mine.current.clear();terminalTargets.current.clear();terminalTargets.current.pending.clear()};
 },[user]);

 const attempt=async fn=>{setError('');try{await fn()}catch(e){setError(e.message)}};
 const event=(name,data,onSuccess)=>{setError('');socket.current?.timeout(5000).emit(name,data,(e,r)=>{if(e){setError('Không nhận được phản hồi VPS');if(name==='script:run')setScriptJobs(previous=>({...previous,[data.deviceId]:{...previous[data.deviceId],state:'failed',requesting:false,error:'Không nhận được phản hồi VPS'}}));if(name==='terminal:open')setTerminalSessions(previous=>{const next={...previous};delete next[data.deviceId];return next});if(name==='terminal:close')setTerminalSessions(previous=>({...previous,[data.deviceId]:{...previous[data.deviceId],state:'connected'}}))}else if(r.error){setError(r.error);if(name==='script:run')setScriptJobs(previous=>({...previous,[data.deviceId]:{...previous[data.deviceId],state:'failed',requesting:false,error:r.error}}));if(name==='terminal:open')setTerminalSessions(previous=>{const next={...previous};delete next[data.deviceId];return next});if(name==='terminal:close')setTerminalSessions(previous=>({...previous,[data.deviceId]:{...previous[data.deviceId],state:'connected'}}))}else{onSuccess?.(r);if(name==='session:request')setMessage('Đang chờ Local Runner xác nhận (20 giây)')}})};

 return <main>
  <header><div><span className="eyebrow">REMOTE CONTROL AGENT · CORE 01</span><h1>Máy của bạn, kết nối từ xa.</h1><p>Quản lý thiết bị và phiên điều khiển qua VPS.</p></div><span className={'badge '+(connected?'on':'')}>{connected?'● VPS realtime đã kết nối':'○ Chưa kết nối VPS realtime'}</span></header>
  {error&&<div className="alert">{error}</div>}{message&&<p role="status">{message}</p>}
  {!user?<form className="panel" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);attempt(async()=>setUser(await api('/auth/login',Object.fromEntries(f))))}}><h2>Đăng nhập</h2><input name="email" type="email" placeholder="Email" required/><input name="password" type="password" placeholder="Mật khẩu" required/><button>Đăng nhập</button></form>:<>
   <nav><strong>{user.name}</strong><button className="secondary" onClick={()=>attempt(async()=>{await api('/auth/logout',{});setUser(null);setDevices([])})}>Đăng xuất</button></nav>
   <section className="panel"><h2>Ghép cặp máy nhà</h2><form className="row" onSubmit={e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');attempt(async()=>{const p=await api('/pairing',{name});setPair(p.code)})}}><input name="name" placeholder="Tên máy, ví dụ PC ở nhà" required maxLength="120"/><button>Tạo mã ghép cặp</button></form>{pair&&<><p>Mã dùng một lần, hết hạn sau 5 phút. Điền vào PAIR_CODE trên máy nhà.</p><code className="pair">{pair}</code></>}</section>
   <section className="grid">{devices.map(device=><DeviceCard key={device.id} device={device} user={user} connected={connected} mine={mine} event={event} attempt={attempt} setMessage={setMessage} scriptJobs={scriptJobs} setScriptJobs={setScriptJobs} terminalSessions={terminalSessions} setTerminalSessions={setTerminalSessions} terminalTargets={terminalTargets}/>)}</section>
   {!devices.length&&<p>{connected?'Chưa có thiết bị. Ghép cặp Local Runner để bắt đầu.':'Chưa kết nối VPS; trạng thái các máy hiện chưa xác định.'}</p>}
   <footer>CPU, RAM, lưu lượng mạng và dữ liệu Terminal được truyền realtime, không lưu nội dung lệnh hay output. CMD/PowerShell chỉ hoạt động trên Windows Local Agent; terminal yêu cầu active lease và tự đóng khi lease kết thúc.</footer>
  </>}
 </main>;
}

createRoot(document.getElementById('root')).render(<App/>);

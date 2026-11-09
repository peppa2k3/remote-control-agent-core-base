import React,{lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {io} from 'socket.io-client';
import './style.css';
import './device-status.css';
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

function usageState(percent){
 if(percent>=85)return {tone:'critical',label:'Cao'};
 if(percent>=60)return {tone:'warning',label:'Trung bình'};
 return {tone:'normal',label:'Bình thường'};
}

function networkState(bytesPerSecond){
 if(bytesPerSecond>20*1024*1024)return {tone:'critical',label:'Tải cao'};
 if(bytesPerSecond>=1024*1024)return {tone:'stable',label:'Đang ổn'};
 return {tone:'normal',label:'Bình thường'};
}

function StatusMetric({value,state,progress}){
 return <div className="status-metric">
  <div className="status-metric__top"><strong className="status-metric__value">{value}</strong><span className={`status-pill status-pill--${state.tone}`}>{state.label}</span></div>
  {Number.isFinite(progress)&&<div className={`status-bar status-bar--${state.tone}`} role="progressbar" aria-label="Mức sử dụng" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}><span style={{width:`${Math.max(0,Math.min(100,progress))}%`}}/></div>}
 </div>;
}

function StatusTable({device}){
 const status=device.status;
 const ramPercent=status?status.ramUsedBytes/status.ramTotalBytes*100:0;
 const cpuState=status?usageState(status.cpuPercent):{tone:'muted',label:'Chưa có dữ liệu'};
 const ramState=status?usageState(ramPercent):{tone:'muted',label:'Chưa có dữ liệu'};
 const rxState=status?networkState(status.networkRxBytesPerSecond):{tone:'muted',label:'Chưa có dữ liệu'};
 const txState=status?networkState(status.networkTxBytesPerSecond):{tone:'muted',label:'Chưa có dữ liệu'};
 const rows=[
  ['CPU',status?<StatusMetric value={`${status.cpuPercent.toLocaleString('vi-VN',{maximumFractionDigits:1})}%`} state={cpuState} progress={status.cpuPercent}/>:<StatusMetric value="—" state={cpuState}/>],
  ['RAM',status?<StatusMetric value={`${formatBytes(status.ramUsedBytes)} / ${formatBytes(status.ramTotalBytes)} (${ramPercent.toLocaleString('vi-VN',{maximumFractionDigits:1})}%)`} state={ramState} progress={ramPercent}/>:<StatusMetric value="—" state={ramState}/>],
  ['Internet tải xuống',status?<StatusMetric value={`${formatBytes(status.networkRxBytesPerSecond)}/s`} state={rxState}/>:<StatusMetric value="—" state={rxState}/>],
  ['Internet tải lên',status?<StatusMetric value={`${formatBytes(status.networkTxBytesPerSecond)}/s`} state={txState}/>:<StatusMetric value="—" state={txState}/>],
  ['Uptime',status?formatUptime(status.uptimeSeconds):'—'],
 ];
 const note=status?`Cập nhật lúc ${new Date(status.updatedAt).toLocaleTimeString('vi-VN')}`:device.runnerStatus==='online'?'Đang chờ báo cáo đầu tiên từ Local Runner.':'Không có số liệu mới; Local Runner đang offline.';
 return <div className="status-wrap"><table className="status-table"><caption>Trạng thái thiết bị</caption><thead><tr><th scope="col">Thông số</th><th scope="col">Giá trị</th></tr></thead><tbody>{rows.map(([label,result])=><tr key={label}><th scope="row">{label}</th><td>{result}</td></tr>)}</tbody></table><small className="status-note">{note} Ngưỡng mạng: dưới 1 MB/s bình thường · 1–20 MB/s đang ổn · trên 20 MB/s tải cao.</small></div>;
}

function RemoteTerminalLauncher(props){
 const [show,setShow]=useState(false),dismiss=useCallback(()=>setShow(false),[]),session=props.terminalSessions[props.device.id];
 if(!show)return <div className="remote-terminal-launcher"><button className="secondary" disabled={!props.device.terminalSupported} aria-haspopup="dialog" onClick={()=>setShow(true)}>{session?.terminalId?'Mở lại cửa sổ Terminal':'Mở cửa sổ Terminal'}</button></div>;
 return <Suspense fallback={<p className="terminal-note">Đang tải giao diện terminal…</p>}><RemoteTerminal {...props} onDismiss={dismiss}/></Suspense>;
}

function DeviceCard({device,user,connected,mine,event,attempt,setMessage,terminalSessions,setTerminalSessions,terminalTargets}){
 return <article className="panel" key={device.id}>
  <div className="row"><h2>{device.name}</h2><span className={'badge '+(device.runnerStatus==='online'?'on':'')}>{device.runnerStatus}</span></div>
  <p>Quyền: <strong>{device.role}</strong></p>
  <p>Local Runner: {device.runnerStatus} · MeshCentral: chưa tích hợp</p>
  <p>{device.session?`Phiên ${device.session.state} · ${device.session.userId===user.id?'tài khoản của bạn':'người quản lý khác'}`:'Chưa có phiên điều khiển'}</p>
  <StatusTable device={device}/>
  <RemoteTerminalLauncher device={device} sessionId={mine.current.get(device.id)} connected={connected} canControl={device.role!=='viewer'} event={event} terminalSessions={terminalSessions} setTerminalSessions={setTerminalSessions} targets={terminalTargets}/>
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
 const [user,setUser]=useState(null),[devices,setDevices]=useState([]),[error,setError]=useState(''),[connected,setConnected]=useState(false),[pair,setPair]=useState(''),[message,setMessage]=useState(''),[terminalSessions,setTerminalSessions]=useState({});
 const socket=useRef(null),mine=useRef(new Map());
 const terminalTargets=useRef(null);if(!terminalTargets.current){terminalTargets.current=new Map();terminalTargets.current.pending=new Map()}
 useEffect(()=>{api('/auth/me').then(setUser).catch(()=>{})},[]);
 useEffect(()=>{
  if(!user)return;
  const s=io({autoConnect:false,withCredentials:true});socket.current=s;
  s.on('connect',()=>setConnected(true));
  s.on('disconnect',()=>{setConnected(false);mine.current.clear();setDevices([]);setTerminalSessions({});terminalTargets.current.clear();terminalTargets.current.pending.clear()});
  s.on('connect_error',e=>setError(e.message));
  s.on('devices:snapshot',setDevices);
  s.on('session:active',p=>{mine.current.set(p.deviceId,p.sessionId);setMessage('Local đã xác nhận phiên điều khiển')});
  s.on('session:revoked',p=>{mine.current.delete(p.deviceId);setMessage('Phiên đã kết thúc: '+p.reason)});
  s.on('terminal:opened',p=>setTerminalSessions(previous=>({...previous,[p.deviceId]:{...(previous[p.deviceId]||{}),...p,state:'connected'}})));
  s.on('terminal:output',p=>{const target=terminalTargets.current.get(p.deviceId);if(target)target.write(p.text);else{const pending=terminalTargets.current.pending.get(p.deviceId)||[];if(pending.reduce((total,text)=>total+new TextEncoder().encode(text).length,0)<4*1024*1024){pending.push(p.text);terminalTargets.current.pending.set(p.deviceId,pending)}}});
  s.on('terminal:status',p=>setTerminalSessions(previous=>({...previous,[p.deviceId]:{...(previous[p.deviceId]||{}),...p}})));
  s.on('terminal:error',p=>{setError(p.message||'Remote Terminal gặp lỗi');setTerminalSessions(previous=>({...previous,[p.deviceId]:{...(previous[p.deviceId]||{}),...p,state:'error'}}))});
  s.on('terminal:closed',p=>{terminalTargets.current.pending.delete(p.deviceId);setTerminalSessions(previous=>{const next={...previous};delete next[p.deviceId];return next})});
  s.connect();
  const renew=setInterval(()=>{for(const [deviceId,sessionId]of mine.current)s.emit('session:renew',{deviceId,sessionId},r=>{if(r?.error){mine.current.delete(deviceId);setError(r.error)}})},10000);
  return()=>{clearInterval(renew);s.disconnect();mine.current.clear();terminalTargets.current.clear();terminalTargets.current.pending.clear()};
 },[user]);

 const attempt=async fn=>{setError('');try{await fn()}catch(e){setError(e.message)}};
 const event=(name,data,onSuccess)=>{setError('');socket.current?.timeout(5000).emit(name,data,(e,r)=>{if(e){setError('Không nhận được phản hồi VPS');if(name==='terminal:open')setTerminalSessions(previous=>{const next={...previous};delete next[data.deviceId];return next});if(name==='terminal:close')setTerminalSessions(previous=>({...previous,[data.deviceId]:{...previous[data.deviceId],state:'connected'}}))}else if(r.error){setError(r.error);if(name==='terminal:open')setTerminalSessions(previous=>{const next={...previous};delete next[data.deviceId];return next});if(name==='terminal:close')setTerminalSessions(previous=>({...previous,[data.deviceId]:{...previous[data.deviceId],state:'connected'}}))}else{onSuccess?.(r);if(name==='session:request')setMessage('Đang chờ Local Runner xác nhận (20 giây)')}})};

 return <main>
  <header><div><span className="eyebrow">REMOTE CONTROL AGENT · CORE 01</span><h1>Máy của bạn, kết nối từ xa.</h1><p>Quản lý thiết bị và phiên điều khiển qua VPS.</p></div><span className={'badge '+(connected?'on':'')}>{connected?'● VPS realtime đã kết nối':'○ Chưa kết nối VPS realtime'}</span></header>
  {error&&<div className="alert">{error}</div>}{message&&<p role="status">{message}</p>}
  {!user?<form className="panel" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);attempt(async()=>setUser(await api('/auth/login',Object.fromEntries(f))))}}><h2>Đăng nhập</h2><input name="email" type="email" placeholder="Email" required/><input name="password" type="password" placeholder="Mật khẩu" required/><button>Đăng nhập</button></form>:<>
   <nav><strong>{user.name}</strong><button className="secondary" onClick={()=>attempt(async()=>{await api('/auth/logout',{});setUser(null);setDevices([])})}>Đăng xuất</button></nav>
   <section className="panel"><h2>Ghép cặp máy nhà</h2><form className="row" onSubmit={e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');attempt(async()=>{const p=await api('/pairing',{name});setPair(p.code)})}}><input name="name" placeholder="Tên máy, ví dụ PC ở nhà" required maxLength="120"/><button>Tạo mã ghép cặp</button></form>{pair&&<><p>Mã dùng một lần, hết hạn sau 5 phút. Điền vào PAIR_CODE trên máy nhà.</p><code className="pair">{pair}</code></>}</section>
   <section className="grid">{devices.map(device=><DeviceCard key={device.id} device={device} user={user} connected={connected} mine={mine} event={event} attempt={attempt} setMessage={setMessage} terminalSessions={terminalSessions} setTerminalSessions={setTerminalSessions} terminalTargets={terminalTargets}/>)}</section>
   {!devices.length&&<p>{connected?'Chưa có thiết bị. Ghép cặp Local Runner để bắt đầu.':'Chưa kết nối VPS; trạng thái các máy hiện chưa xác định.'}</p>}
   <footer>CPU, RAM, lưu lượng mạng và dữ liệu Terminal được truyền realtime, không lưu nội dung lệnh hay output. CMD/PowerShell chỉ hoạt động trên Windows Local Agent; terminal yêu cầu active lease và tự đóng khi lease kết thúc.</footer>
  </>}
 </main>;
}

createRoot(document.getElementById('root')).render(<App/>);

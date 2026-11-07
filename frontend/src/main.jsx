import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {io} from 'socket.io-client';
import './style.css';

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

function DeviceCard({device,user,connected,mine,event,attempt,setMessage}){
 return <article className="panel" key={device.id}>
  <div className="row"><h2>{device.name}</h2><span className={'badge '+(device.runnerStatus==='online'?'on':'')}>{device.runnerStatus}</span></div>
  <p>Quyền: <strong>{device.role}</strong></p>
  <p>Local Runner: {device.runnerStatus} · MeshCentral: chưa tích hợp</p>
  <p>{device.session?`Phiên ${device.session.state} · ${device.session.userId===user.id?'tài khoản của bạn':'người quản lý khác'}`:'Chưa có phiên điều khiển'}</p>
  <StatusTable device={device}/>
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
 const [user,setUser]=useState(null),[devices,setDevices]=useState([]),[error,setError]=useState(''),[connected,setConnected]=useState(false),[pair,setPair]=useState(''),[message,setMessage]=useState('');
 const socket=useRef(null),mine=useRef(new Map());
 useEffect(()=>{api('/auth/me').then(setUser).catch(()=>{})},[]);
 useEffect(()=>{
  if(!user)return;
  const s=io({autoConnect:false,withCredentials:true});socket.current=s;
  s.on('connect',()=>setConnected(true));
  s.on('disconnect',()=>{setConnected(false);mine.current.clear();setDevices([])});
  s.on('connect_error',e=>setError(e.message));
  s.on('devices:snapshot',setDevices);
  s.on('session:active',p=>{mine.current.set(p.deviceId,p.sessionId);setMessage('Local đã xác nhận phiên điều khiển')});
  s.on('session:revoked',p=>{mine.current.delete(p.deviceId);setMessage('Phiên đã kết thúc: '+p.reason)});
  s.connect();
  const renew=setInterval(()=>{for(const [deviceId,sessionId]of mine.current)s.emit('session:renew',{deviceId,sessionId},r=>{if(r?.error){mine.current.delete(deviceId);setError(r.error)}})},10000);
  return()=>{clearInterval(renew);s.disconnect();mine.current.clear()};
 },[user]);

 const attempt=async fn=>{setError('');try{await fn()}catch(e){setError(e.message)}};
 const event=(name,data)=>{setError('');socket.current?.timeout(5000).emit(name,data,(e,r)=>{if(e)setError('Không nhận được phản hồi VPS');else if(r.error)setError(r.error);else if(name==='session:request')setMessage('Đang chờ Local Runner xác nhận (20 giây)')})};

 return <main>
  <header><div><span className="eyebrow">REMOTE CONTROL AGENT · CORE 01</span><h1>Máy của bạn, kết nối từ xa.</h1><p>Quản lý thiết bị và phiên điều khiển qua VPS.</p></div><span className={'badge '+(connected?'on':'')}>{connected?'● VPS realtime đã kết nối':'○ Chưa kết nối VPS realtime'}</span></header>
  {error&&<div className="alert">{error}</div>}{message&&<p role="status">{message}</p>}
  {!user?<form className="panel" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);attempt(async()=>setUser(await api('/auth/login',Object.fromEntries(f))))}}><h2>Đăng nhập</h2><input name="email" type="email" placeholder="Email" required/><input name="password" type="password" placeholder="Mật khẩu" required/><button>Đăng nhập</button></form>:<>
   <nav><strong>{user.name}</strong><button className="secondary" onClick={()=>attempt(async()=>{await api('/auth/logout',{});setUser(null);setDevices([])})}>Đăng xuất</button></nav>
   <section className="panel"><h2>Ghép cặp máy nhà</h2><form className="row" onSubmit={e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');attempt(async()=>{const p=await api('/pairing',{name});setPair(p.code)})}}><input name="name" placeholder="Tên máy, ví dụ PC ở nhà" required maxLength="120"/><button>Tạo mã ghép cặp</button></form>{pair&&<><p>Mã dùng một lần, hết hạn sau 5 phút. Điền vào PAIR_CODE trên máy nhà.</p><code className="pair">{pair}</code></>}</section>
   <section className="grid">{devices.map(device=><DeviceCard key={device.id} device={device} user={user} connected={connected} mine={mine} event={event} attempt={attempt} setMessage={setMessage}/>)}</section>
   {!devices.length&&<p>{connected?'Chưa có thiết bị. Ghép cặp Local Runner để bắt đầu.':'Chưa kết nối VPS; trạng thái các máy hiện chưa xác định.'}</p>}
   <footer>CPU, RAM và lưu lượng mạng được Local Runner gửi định kỳ. Dữ liệu status tạm thời, chỉ có khi runner đang kết nối; điều khiển desktop và chạy kịch bản được phát triển ở các bước tiếp theo.</footer>
  </>}
 </main>;
}

createRoot(document.getElementById('root')).render(<App/>);

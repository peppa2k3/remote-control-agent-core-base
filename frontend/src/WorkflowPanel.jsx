import React,{useCallback,useEffect,useRef,useState} from 'react';
import WorkflowJobs from './WorkflowJobs.jsx';

const active=['queued','accepted','dispatched','running','stopping','unknown'];
const states={queued:'Đang chờ tiếp nhận',accepted:'Đã tiếp nhận',dispatched:'Đã gửi tới máy',running:'Đang chạy',stopping:'Đang chờ xác nhận dừng',unknown:'Chưa xác định kết quả',succeeded:'Đã hoàn thành',failed:'Không hoàn thành',cancelled:'Đã hủy',expired:'Đã hết hạn',rejected:'Không được tiếp nhận'};
const healthLabels={configured:'Đã cấu hình',starting:'Đang khởi động',ready:'Engine sẵn sàng',degraded:'Cần kiểm tra',stopping:'Đang dừng',failed:'Lỗi',unconfigured:'Chưa sẵn sàng'};
const readinessLabels={starting:'Đang chờ extension',ready:'Extension đã kết nối',busy:'Profile đang bận','missing-extension':'Thiếu extension hoặc heartbeat đã hết hạn',failed:'Không mở được Chrome'};
const messages={BUSY:'Tác vụ trước chưa xác nhận dừng xong. Hãy chờ xác nhận tại máy chạy.',QUIESCENCE_REQUIRED:'Đang chờ tác vụ trước xác nhận dừng.',UNKNOWN_OUTCOME:'Chưa xác định kết quả. Kiểm tra tại máy chạy; không chạy lại tự động.',POLICY_DENIED:'Kịch bản, profile hoặc biến không được phép tại máy chạy.',LEASE_REQUIRED:'Phiên điều khiển đã kết thúc hoặc thuộc cửa sổ khác.',EXTENSION_NOT_READY:'Hãy kết nối extension trong Chrome của máy chạy.',RESPONSE_UNKNOWN:'Chưa nhận được kết quả. Hãy tra lịch sử trước khi thử lại.',VPS_DISCONNECTED:'Đã mất kết nối VPS.'};
const read=key=>{try{return JSON.parse(sessionStorage.getItem(key)||'null')}catch{return null}};
const write=(key,value)=>{try{sessionStorage.setItem(key,JSON.stringify(value))}catch{throw Object.assign(Error('STORAGE_UNAVAILABLE'),{code:'STORAGE_UNAVAILABLE'})}};
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
async function signature(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),x=>x.toString(16).padStart(2,'0')).join('')}

export default function WorkflowPanel(props){
  const d=props.device;
  return <Panel key={`${props.userId}:${d.id}:${props.sessionId||''}:${d.session?.id}:${d.session?.state}:${props.connected}:${d.runnerStatus}:${d.role}:${d.workflowSupported}`} {...props}/>;
}
function Panel({userId,device,sessionId,connected,request}){
  const scope=`workflow-intent:${userId}:${device.id}:`;
  const [profiles,setProfiles]=useState([]),[names,setNames]=useState([]),[profile,setProfile]=useState(''),[scenario,setScenario]=useState('');
  const [description,setDescription]=useState(null),[variables,setVariables]=useState('{}'),[run,setRun]=useState(null),[history,setHistory]=useState([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[pending,setPending]=useState(()=>read(scope+'run'));
  const lifetime=useRef(null);if(!lifetime.current)lifetime.current=new AbortController();
  const busyRef=useRef(false),selectedScenario=useRef(0);
  const health=connected?device.workflowHealth:null;
  const authority=!!(connected&&device.runnerStatus==='online'&&device.role!=='viewer'&&sessionId&&device.session?.id===sessionId&&device.session.state==='active');
  const canControl=authority&&device.workflowSupported;
  const currentProfile=profiles.find(p=>p.directory===profile),profileState=currentProfile?.readiness;
  useEffect(()=>()=>lifetime.current.abort(),[]);
  const call=useCallback((operation,params={},requestId)=>request({deviceId:device.id,sessionId,operation,params,...(requestId?{requestId}:{})},{signal:lifetime.current.signal}),[request,device.id,sessionId]);
  async function lookup(intent){
    const r=await fetch(`/api/devices/${encodeURIComponent(device.id)}/workflow/requests/${encodeURIComponent(intent.requestId)}`,{credentials:'include',signal:lifetime.current.signal});
    if(!r.ok)throw Error('LOOKUP_FAILED');return (await r.json()).job;
  }
  function commit(fn){if(!lifetime.current.signal.aborted)fn()}
  async function perform(action){
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');
    try{await action()}catch(e){commit(()=>setError(messages[e.code||e.message]||'Không thực hiện được yêu cầu. Kiểm tra quyền, kết nối và dữ liệu nhập.'))}
    finally{commit(()=>{busyRef.current=false;setBusy(false);setRefresh(x=>x+1)})}
  }
  async function mutate(operation,params){
    const key=scope+operation,hash=await signature(params);if(lifetime.current.signal.aborted)throw Error('REQUEST_CANCELLED');
    let intent=read(key);
    if(intent){
      const old=await lookup(intent);if(lifetime.current.signal.aborted)throw Error('REQUEST_CANCELLED');
      if(old&&intent.hash===hash){if(operation==='run')commit(()=>{setRun(old);setPending(null)});else sessionStorage.removeItem(key);return old;}
      if(!old||active.includes(old.state)||!old.quiescent){if(intent.hash!==hash||Date.now()-intent.createdAt>89*86400000)throw Error('UNKNOWN_OUTCOME')}
      else intent=null;
    }
    if(!intent){intent={requestId:crypto.randomUUID(),hash,createdAt:Date.now()};write(key,intent)}
    if(operation==='run')commit(()=>setPending(intent));
    const result=await call(operation,params,intent.requestId);
    if(lifetime.current.signal.aborted)throw Error('REQUEST_CANCELLED');
    write(key,{...intent,jobId:result.jobId||null});
    if(operation!=='run')sessionStorage.removeItem(key);
    if(operation==='run')commit(()=>{setPending(null);setRun(result)});
    return result;
  }
  useEffect(()=>{
    const intent=read(scope+'run');if(!connected||!intent)return;
    void lookup(intent).then(job=>commit(()=>{if(job){setRun(job);setPending(null)}else setPending(intent)})).catch(()=>commit(()=>setError('Chưa tra được yêu cầu trước. Không tự chạy lại.')));
  },[connected]);
  useEffect(()=>{
    if(!canControl||!run?.runId||!active.includes(run.state)&&run.quiescent!==false||run.state==='unknown')return;
    let stopped=false,timer,failures=0;
    async function poll(){try{const result=await call('status',{runId:run.runId});if(!stopped){setRun(previous=>({...result,jobId:previous?.jobId}));failures=0}}catch{failures++;}finally{if(!stopped)timer=setTimeout(poll,Math.min(30000,2000*2**failures))}}
    timer=setTimeout(poll,2000);return()=>{stopped=true;clearTimeout(timer)};
  },[canControl,run?.runId,run?.state,call]);
  useEffect(()=>{
    if(!canControl||!profile)return;
    let stopped=false,timer,failures=0;
    async function poll(){try{const p=await call('profiles');if(!stopped){setProfiles(p.profiles||[]);failures=0}}catch{failures++;}finally{if(!stopped)timer=setTimeout(poll,Math.min(30000,2000*2**failures))}}
    timer=setTimeout(poll,2000);return()=>{stopped=true;clearTimeout(timer)};
  },[canControl,profile,call]);
  async function load(){const [p,s,h]=await Promise.all([call('profiles'),call('scenarios'),call('runs')]);commit(()=>{setProfiles(p.profiles||[]);setNames(s.names||[]);setProfile(p.profiles?.[0]?.directory||'');setScenario('');setDescription(null);setHistory(h.runs||[])})}
  async function describe(name){
    const ticket=++selectedScenario.current;setScenario(name);setDescription(null);setVariables('{}');if(!name)return;
    const result=await call('describe',{scenario:name});commit(()=>{if(ticket===selectedScenario.current){setDescription(result);setVariables(JSON.stringify(result.variables||{},null,2))}});
  }
  async function start(){
    let values;try{values=JSON.parse(variables)}catch{setError('Biến phải là JSON hợp lệ.');return}
    if(!values||typeof values!=='object'||Array.isArray(values)){setError('Biến phải là object JSON.');return}
    const schema=description?.variableSchema||Object.fromEntries(Object.entries(description?.variables||{}).map(([k,v])=>[k,{type:typeof v}]));
    for(const [key,v] of Object.entries(values)){
      const rule=schema[key];
      if(!Object.hasOwn(schema,key)||!rule||!(['integer','number'].includes(rule.type)?typeof v==='number'&&Number.isFinite(v)&&(rule.type!=='integer'||Number.isSafeInteger(v)):typeof v===rule.type)||rule.maxLength!==undefined&&v.length>rule.maxLength||typeof v==='string'&&(v.includes('\0')||v.includes('{{'))||rule.minimum!==undefined&&v<rule.minimum||rule.maximum!==undefined&&v>rule.maximum||rule.enum&&!rule.enum.includes(v)){setError(`Biến “${key}” không đúng kiểu, giới hạn hoặc danh sách cho phép.`);return}
    }
    await mutate('run',{profile,scenario,variables:values});
  }
  async function newRun(){
    const old=read(scope+'run');if(old){const job=await lookup(old);if(!job||active.includes(job.state)||!job.quiescent)throw Error('UNKNOWN_OUTCOME')}
    sessionStorage.removeItem(scope+'run');setPending(null);setRun(null);
  }
  return <section className="workflow-panel" aria-label="Kịch bản tự động">
    <h3>Kịch bản tự động</h3>
    <div className="workflow-note" role="status"><p>VPS: {connected?'Đã kết nối':'Chưa xác định — mất kết nối'}</p><p>Workflow: {!connected?'Chưa xác định':device.runnerStatus!=='online'?'Runner offline':health?healthLabels[health.state]||'Chưa xác định':'Chưa có health engine'}{health?.engineVersion?` · v${health.engineVersion}`:''}</p><p>Phiên điều khiển: {authority?'Cửa sổ này đang điều khiển':device.session?'Đang chờ hoặc thuộc cửa sổ khác':'Chưa có phiên'}</p>{health?.reasonCode==='UNKNOWN_OUTCOME'&&<p>Chưa xác nhận tác vụ trước đã dừng. Kiểm tra tại máy chạy trước khi chuyển quyền hoặc chạy lượt mới.</p>}<small>Engine sẵn sàng chưa xác nhận phiên Windows tương tác, Chrome hoặc extension sẵn sàng.</small></div>
    <WorkflowJobs key={device.id} deviceId={device.id} connected={connected} canPoll={canControl} refreshKey={refresh} onSelect={job=>{setRun(job);setPending(null)}}/>
    {!canControl&&<p>{device.role==='viewer'?'Bạn có quyền xem lịch sử; không có quyền chạy hoặc dừng.':'Yêu cầu phiên điều khiển tại cửa sổ này để chọn và chạy kịch bản.'}</p>}
    {device.workflowSupported&&<>
      <button className="secondary" disabled={!canControl||busy} onClick={()=>perform(load)}>Tải danh sách kịch bản</button>
      <div className="workflow-fields">
        <label>Chrome profile<select aria-label="Chrome profile" value={profile} onChange={e=>setProfile(e.target.value)} disabled={!canControl||busy}><option value="">Chọn profile</option>{profiles.map(p=><option key={p.directory} value={p.directory}>{p.name||p.directory}</option>)}</select></label>
        <label>Kịch bản<select aria-label="Kịch bản" value={scenario} onChange={e=>{const name=e.target.value;perform(()=>describe(name))}} disabled={!canControl||busy}><option value="">Chọn kịch bản</option>{names.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
        <label>Biến ghi đè (JSON)<textarea aria-label="Biến ghi đè (JSON)" rows={3} value={variables} onChange={e=>setVariables(e.target.value)} disabled={!canControl||busy||!description}/></label>
      </div>
      <p className="workflow-note">Biến được phép sửa: {description?Object.keys(description.variableSchema||description.variables||{}).join(', ')||'Không có':'Chọn kịch bản để xem'}. Dữ liệu nhập chỉ giữ trong cửa sổ đang mở.</p>
      <button className="secondary" disabled={!canControl||busy||!profile||!currentProfile?.allowOpen||!health?.operations?.includes('openProfile')} onClick={()=>perform(async()=>{await mutate('openProfile',{profile});const p=await call('profiles');commit(()=>setProfiles(p.profiles||[]))})}>Mở Chrome profile</button>
      {profileState&&<p role="status">Chrome profile: {readinessLabels[profileState.state]||'Chưa sẵn sàng'}</p>}
      {profileState?.state==='missing-extension'&&<p>Cài hoặc bật extension trong Chrome trên máy chạy, chọn đúng profile và chờ kết nối.</p>}
      <div className="actions">
        <button className="secondary" disabled={!canControl||busy||!scenario} onClick={()=>perform(()=>describe(scenario))}>Xem biến mặc định</button>
        <button disabled={!canControl||busy||!profile||!scenario||!description||!!pending||!!run||description.profiles&&!description.profiles.includes(profile)} onClick={()=>perform(start)}>Chạy kịch bản</button>
        <button className="warn" disabled={!canControl||!run?.runId||!['running','accepted','dispatched'].includes(run?.state)||busy} onClick={()=>perform(async()=>{const result=await mutate('stop',{runId:run.runId});commit(()=>setRun(previous=>({...previous,state:'stopping',quiescent:false})));if(result.operation!=='stop'&&result.runId)commit(()=>setRun(result))})}>Dừng lượt chạy</button>
        <button className="secondary" disabled={!canControl||busy||!run||!run.quiescent||active.includes(run.state)} onClick={()=>perform(newRun)}>Chuẩn bị lượt mới</button>
        {pending&&<button className="secondary" disabled={!canControl||busy||!description} onClick={()=>perform(start)}>Tra cứu trước khi thử lại</button>}
      </div>
    </>}
    {pending&&<p role="status">Yêu cầu trước chưa có kết quả. Sẽ tra lịch sử và giữ nguyên mã yêu cầu khi thử lại; không tự chạy lại.</p>}
    {run&&<div role="status"><strong>{run.scenario?`${run.scenario} · `:''}{states[run.state]||'Chưa xác định kết quả'}</strong><p>Bước {run.progress?.index??run.index??0}/{run.progress?.total??run.total??0}</p><small>{run.runId||run.jobId}</small>{(!run.quiescent&&['unknown','stopping','cancelled'].includes(run.state))&&<p>Chưa xác nhận tác vụ đã dừng. Chờ xác nhận tại máy chạy trước khi chuyển quyền hoặc chạy lượt mới.</p>}{run.paused&&<p>Đang chờ xác nhận nội dung tại dashboard local trên máy chạy. Mở dashboard ở chính máy đó; địa chỉ loopback trên điện thoại không dẫn đến máy chạy.</p>}</div>}
    {device.workflowSupported&&history.length>0&&<label>Lượt gần đây<select aria-label="Lượt gần đây" value={run?.runId||''} disabled={!canControl||busy} onChange={e=>{const runId=e.target.value;if(runId)perform(async()=>{const result=await call('status',{runId});commit(()=>setRun(result))})}}><option value="">Chọn lượt để theo dõi</option>{history.map(item=><option key={item.runId} value={item.runId}>{item.scenario} · {states[item.state]||'Chưa xác định'}</option>)}</select></label>}
    {error&&<p className="alert" role="alert">{error}</p>}
  </section>;
}

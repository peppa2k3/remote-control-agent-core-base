import React,{useCallback,useEffect,useRef,useState} from 'react';

export default function WorkflowPanel({device,sessionId,connected,request}) {
  const [profiles,setProfiles]=useState([]),[names,setNames]=useState([]),[profile,setProfile]=useState(''),[scenario,setScenario]=useState('');
  const [variables,setVariables]=useState('{}'),[run,setRun]=useState(null),[history,setHistory]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const retry=useRef(null),generation=useRef(0);
  const canControl=connected&&device.runnerStatus==='online'&&device.workflowSupported&&device.role!=='viewer'&&sessionId&&device.session?.id===sessionId&&device.session.state==='active';
  const call=useCallback((operation,params={},requestId)=>request({deviceId:device.id,sessionId,operation,params,...(requestId?{requestId}:{})}),[request,device.id,sessionId]);
  useEffect(()=>{generation.current++;setBusy(false);setProfiles([]);setNames([]);setHistory([]);setRun(null);setError('');retry.current=null;},[sessionId,device.id]);
  useEffect(()=>{
    if(!canControl||run?.state!=='running')return;
    let stopped=false,inFlight=false;
    const timer=setInterval(async()=>{if(inFlight)return;inFlight=true;try{const result=await call('status',{runId:run.runId});if(!stopped){setRun(result);setError('');}}catch(e){if(!stopped)setError(e.message)}finally{inFlight=false}},2000);
    return()=>{stopped=true;clearInterval(timer)};
  },[canControl,run?.runId,run?.state,call]);
  async function perform(action) {
    const current=generation.current;setBusy(true);setError('');
    try { await action(result=>{if(current===generation.current)result()}); }
    catch(e){if(current===generation.current)setError(e.message)}
    finally{if(current===generation.current)setBusy(false)}
  }
  async function load(commit) {
    const [p,s,h]=await Promise.all([call('profiles'),call('scenarios'),call('runs')]);
    commit(()=>{setProfiles(p.profiles||[]);setNames(s.names||[]);setProfile(value=>p.profiles?.some(p=>p.directory===value)?value:p.profiles?.[0]?.directory||'');setScenario(value=>s.names?.includes(value)?value:s.names?.[0]||'');setHistory(h.runs||[]);});
  }
  async function start(commit) {
    const values=JSON.parse(variables);
    if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Biến phải là object JSON');
    const params={profile,scenario,variables:values},fingerprint=JSON.stringify(params);
    if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,requestId:crypto.randomUUID()};
    const result=await call('run',params,retry.current.requestId);
    commit(()=>{setRun(result);retry.current=null;});
  }
  const health=device.workflowHealth;
  const labels={configured:'Đã cấu hình',starting:'Đang khởi động',ready:'Engine sẵn sàng',degraded:'Cần kiểm tra',stopping:'Đang dừng',failed:'Lỗi',unconfigured:'Chưa sẵn sàng'};
  const healthNote=<div className="workflow-note" role="status"><p>Workflow: {device.runnerStatus!=='online'?'Runner offline':health?labels[health.state]||'Chưa xác định':'Chưa có health engine'}{health?.supervisor?` · ${health.supervisor.mode}`:''}{health?.reasonCode?` · ${health.reasonCode}`:''}</p><small>Engine sẵn sàng chưa xác nhận phiên Windows tương tác, Chrome hoặc extension sẵn sàng.</small></div>;
  if(!device.workflowSupported)return healthNote;
  return <section className="workflow-panel" aria-label="Kịch bản tự động">
    <h3>Kịch bản tự động</h3>
    {healthNote}
    {!canControl&&<p>Yêu cầu phiên điều khiển để chọn và chạy kịch bản.</p>}
    <button className="secondary" disabled={!canControl||busy} onClick={()=>perform(load)}>Tải danh sách kịch bản</button>
    <div className="workflow-fields">
      <label>Chrome profile<select aria-label="Chrome profile" value={profile} onChange={e=>setProfile(e.target.value)} disabled={!canControl||busy}><option value="">Chọn profile</option>{profiles.map(p=><option key={p.directory} value={p.directory}>{p.name||p.directory} ({p.directory}){p.extensionConnected?' · sẵn sàng':''}</option>)}</select></label>
      <label>Kịch bản<select aria-label="Kịch bản" value={scenario} onChange={e=>setScenario(e.target.value)} disabled={!canControl||busy}><option value="">Chọn kịch bản</option>{names.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
      <label>Biến ghi đè (JSON)<textarea aria-label="Biến ghi đè (JSON)" rows={3} value={variables} onChange={e=>setVariables(e.target.value)} disabled={!canControl||busy}/></label>
    </div>
    <div className="actions"><button className="secondary" disabled={!canControl||busy||!scenario} onClick={()=>perform(async commit=>{const result=await call('describe',{scenario});commit(()=>setVariables(JSON.stringify(result.variables||{},null,2)));})}>Xem biến mặc định</button><button disabled={!canControl||busy||!profile||!scenario} onClick={()=>perform(start)}>Chạy kịch bản</button><button className="warn" disabled={!canControl||busy||run?.state!=='running'} onClick={()=>perform(async commit=>{const result=await call('stop',{runId:run.runId});commit(()=>setRun(result));})}>Dừng lượt chạy</button></div>
    {run&&<div role="status"><strong>{run.scenario} · {run.state}</strong><p>Bước {Math.min((run.index||0)+1,run.total||0)}/{run.total||0} · {run.stepLabel||run.action||''}</p><small>{run.runId}</small>{(run.error||run.confirmation?.message)&&<p>{run.error||run.confirmation.message}</p>}</div>}
    {history.length>0&&<label>Lượt gần đây<select aria-label="Lượt gần đây" value={run?.runId||''} disabled={!canControl||busy} onChange={e=>{const runId=e.target.value;if(runId)perform(async commit=>{const result=await call('status',{runId});commit(()=>setRun(result));});}}><option value="">Chọn lượt để theo dõi</option>{history.map(item=><option key={item.runId} value={item.runId}>{item.scenario} · {item.profile} · {item.state}</option>)}</select></label>}
    {error&&<p className="alert" role="alert">{error}</p>}
  </section>;
}

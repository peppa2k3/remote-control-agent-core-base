import React,{useEffect,useRef,useState} from 'react';

export default function WorkflowJobs({deviceId,connected,refreshKey}){
  const [open,setOpen]=useState(false),[jobs,setJobs]=useState([]),[error,setError]=useState('');
  const active=useRef(false);
  useEffect(()=>{
    if(!open||!connected)return;
    const controller=new AbortController();let pending=false;
    async function load(){if(pending)return;pending=true;try{
      const r=await fetch(`/api/devices/${encodeURIComponent(deviceId)}/workflow/jobs`,{credentials:'include',signal:controller.signal});
      if(!r.ok)throw Error('HISTORY_UNAVAILABLE');const data=await r.json();
      if(!controller.signal.aborted){setJobs(data.jobs||[]);active.current=data.jobs?.some(j=>['queued','dispatched','running','stopping','unknown'].includes(j.state));setError('');}
    }catch{if(!controller.signal.aborted){setJobs([]);setError('Không tải được lịch sử jobs. Kiểm tra kết nối và quyền hiện tại.');}}finally{pending=false;}}
    void load();const timer=setInterval(()=>{if(active.current)void load();},5000);
    return()=>{controller.abort();clearInterval(timer);};
  },[open,connected,deviceId,refreshKey]);
  return <details className="workflow-note" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Lịch sử jobs trên VPS</summary>
    {!connected&&<p>Mất kết nối VPS; dữ liệu đã nhận chưa được cập nhật.</p>}
    {error&&<p role="alert">{error}</p>}
    {jobs.length?<ul>{jobs.map(j=><li key={j.jobId}>{j.operation} · {j.state} · {j.progress?.index||0}/{j.progress?.total||0}<br/><small>{j.jobId}{j.quiescent?' · đã xác nhận dừng':''}</small></li>)}</ul>:<p>Chưa có job trong lịch sử được lưu trên VPS.</p>}
    <small>20 job gần nhất; metadata 30 ngày, khóa chống trùng tối thiểu 90 ngày. Job chưa xác định không tự chạy lại.</small>
  </details>;
}

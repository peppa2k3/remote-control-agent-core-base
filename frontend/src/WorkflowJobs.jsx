import React,{useEffect,useState} from 'react';
const labels={queued:'Đang chờ',dispatched:'Đã gửi',running:'Đang chạy',stopping:'Chờ xác nhận dừng',unknown:'Chưa xác định',succeeded:'Hoàn thành',failed:'Không hoàn thành',cancelled:'Đã hủy',expired:'Hết hạn',rejected:'Bị từ chối'};
export default function WorkflowJobs({deviceId,connected,canPoll=false,refreshKey,onSelect}){
  const [open,setOpen]=useState(false),[jobs,setJobs]=useState([]),[error,setError]=useState(''),[cursor,setCursor]=useState(''),[next,setNext]=useState(null),[reload,setReload]=useState(0);
  useEffect(()=>{setJobs([]);setCursor('');setNext(null)},[deviceId]);
  useEffect(()=>{
    if(!open||!connected)return;
    const controller=new AbortController();let timer,failures=0;
    async function load(){try{
      const r=await fetch(`/api/devices/${encodeURIComponent(deviceId)}/workflow/jobs${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{credentials:'include',signal:controller.signal});
      if(!r.ok)throw Error('HISTORY_UNAVAILABLE');const data=await r.json();
      if(!controller.signal.aborted){setJobs(data.jobs||[]);setNext(data.cursor);setError('');failures=0;}
    }catch{if(!controller.signal.aborted){failures++;setJobs([]);setError('Không tải được lịch sử jobs. Kiểm tra kết nối và quyền hiện tại.');}}
    finally{if(!controller.signal.aborted&&canPoll&&!cursor)timer=setTimeout(load,Math.min(30000,5000*2**failures));}}
    void load();return()=>{controller.abort();clearTimeout(timer)};
  },[open,connected,canPoll,deviceId,refreshKey,cursor,reload]);
  return <details className="workflow-note" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Lịch sử jobs trên VPS</summary>
    {!connected&&<p>Mất kết nối VPS; trạng thái hiện chưa xác định.</p>}
    {error&&<p role="alert">{error}</p>}
    {jobs.length?<ul className="workflow-jobs">{jobs.map(j=><li key={j.jobId}><button className="secondary" disabled={!connected} onClick={()=>onSelect?.(j)} aria-label={`Theo dõi job ${j.jobId}`}>{({run:'Chạy kịch bản',stop:'Dừng lượt chạy',openProfile:'Mở Chrome'})[j.operation]||'Tác vụ'} · {labels[j.state]||'Chưa xác định'}</button><br/><small>{j.jobId}{j.quiescent?' · đã xác nhận kết thúc':''}</small></li>)}</ul>:<p>Chưa có job trong lịch sử được lưu trên VPS.</p>}
    <div className="actions"><button className="secondary" disabled={!connected} onClick={()=>{setCursor('');setReload(x=>x+1)}}>Làm mới lịch sử</button><button className="secondary" disabled={!connected||!next} onClick={()=>setCursor(next)}>Xem các job cũ hơn</button></div>
    <small>Mỗi trang tối đa 20 job. Job chưa xác định không tự chạy lại.</small>
  </details>;
}

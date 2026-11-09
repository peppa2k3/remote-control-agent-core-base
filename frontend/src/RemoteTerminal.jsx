import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {WebLinksAddon} from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const MAX_CHUNK_BYTES=4096;
function splitInput(value){const chunks=[];let chunk='',bytes=0;for(const character of value){const size=new TextEncoder().encode(character).length;if(bytes+size>MAX_CHUNK_BYTES){chunks.push(chunk);chunk='';bytes=0}chunk+=character;bytes+=size}if(chunk)chunks.push(chunk);return chunks}

export default function RemoteTerminal({device,sessionId,connected,canControl,blocked,event,terminalSessions,setTerminalSessions,targets,onDismiss}){
 const [shell,setShell]=useState(device.terminalShells?.[0]||'cmd');
 const [hasSelection,setHasSelection]=useState(false),[clipboardMessage,setClipboardMessage]=useState('');
 const entry=terminalSessions[device.id],container=useRef(null),terminalRef=useRef(null),timer=useRef(null),inputBuffer=useRef(''),sentSize=useRef({cols:0,rows:0});
 const ownLease=canControl&&!!sessionId&&device.session?.id===sessionId&&device.session.state==='active';
 const canOpen=connected&&device.runnerStatus==='online'&&device.terminalSupported&&ownLease&&!blocked&&!device.terminal&&!entry;

 useEffect(()=>{
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const onKeyDown=event=>{if(event.key==='Escape')onDismiss()};
  window.addEventListener('keydown',onKeyDown);
  return()=>{document.body.style.overflow=previousOverflow;window.removeEventListener('keydown',onKeyDown)};
 },[onDismiss]);

 useEffect(()=>{
  if(!entry?.terminalId||entry.state==='closed'||!container.current)return;
  const terminal=new Terminal({cursorBlink:true,scrollback:10000,fontSize:14,convertEol:true,theme:{background:'#08111e',foreground:'#dbe7f8',cursor:'#68c8ec',selectionBackground:'#35516c'}});
  const fit=new FitAddon();terminal.loadAddon(fit);terminal.loadAddon(new WebLinksAddon());terminal.open(container.current);terminalRef.current=terminal;
  const target={write:text=>terminal.write(text)};targets.current.set(device.id,target);
  for(const text of targets.current.pending?.get(device.id)||[])terminal.write(text);
  targets.current.pending?.delete(device.id);
  const fitTerminal=()=>{try{fit.fit();const {cols,rows}=terminal;if(cols!==sentSize.current.cols||rows!==sentSize.current.rows){sentSize.current={cols,rows};if(entry.state==='connected')event('terminal:resize',{deviceId:device.id,terminalId:entry.terminalId,sessionId:entry.sessionId,cols,rows})}}catch{}};
  let resizeTimer;const observer=new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(fitTerminal,120)});observer.observe(container.current);fitTerminal();terminal.focus();
  terminal.onData(data=>{inputBuffer.current+=data;if(!timer.current)timer.current=setTimeout(()=>{timer.current=null;const chunks=splitInput(inputBuffer.current);inputBuffer.current='';for(const chunk of chunks)event('terminal:input',{deviceId:device.id,terminalId:entry.terminalId,sessionId:entry.sessionId,data:chunk})},25)});
  terminal.onSelectionChange(()=>setHasSelection(terminal.hasSelection()));
  return()=>{observer.disconnect();clearTimeout(resizeTimer);clearTimeout(timer.current);timer.current=null;inputBuffer.current='';targets.current.delete(device.id);terminal.dispose();terminalRef.current=null;sentSize.current={cols:0,rows:0}};
 },[device.id,entry?.terminalId,entry?.state==='closed']);

 function open(){
  if(!canOpen)return;
  setTerminalSessions(previous=>({...previous,[device.id]:{state:'requesting',terminalId:null,sessionId}}));
  event('terminal:open',{deviceId:device.id,sessionId,shell,cols:100,rows:30},result=>setTerminalSessions(previous=>{const current=previous[device.id];if(!current||(current.terminalId&&current.terminalId!==result.terminalId))return previous;return {...previous,[device.id]:{...current,terminalId:result.terminalId,sessionId,state:current.state==='connected'?'connected':'connecting'}}}));
 }
 function close(){if(!entry?.terminalId)return;setTerminalSessions(previous=>({...previous,[device.id]:{...previous[device.id],state:'closing'}}));event('terminal:close',{deviceId:device.id,terminalId:entry.terminalId,sessionId:entry.sessionId})}
 async function copySelection(){try{const value=terminalRef.current?.getSelection()||'';if(value)await navigator.clipboard.writeText(value);setClipboardMessage(value?'Đã sao chép':'Chọn nội dung cần sao chép trước')}catch{setClipboardMessage('Trình duyệt chưa cấp quyền clipboard')}}
 async function pasteClipboard(){try{const value=await navigator.clipboard.readText();terminalRef.current?.paste(value);setClipboardMessage('Đã dán nội dung')}catch{setClipboardMessage('Trình duyệt chưa cấp quyền clipboard')}}

 return createPortal(<div className="terminal-backdrop" onClick={event=>{if(event.target===event.currentTarget)onDismiss()}}>
  <section className="remote-terminal remote-terminal--modal" role="dialog" aria-modal="true" aria-labelledby="remote-terminal-title">
   <div className="terminal-heading">
    <div className="terminal-title"><h2 id="remote-terminal-title">Remote Terminal</h2><small>{device.name}</small></div>
    <span className={'terminal-state '+(entry?.state==='connected'?'connected':'')}>{entry?.state||device.terminal?.state||'Đã đóng'}</span>
    <button className="secondary terminal-exit" title="Thoát cửa sổ; phiên terminal vẫn tiếp tục" onClick={onDismiss}><span aria-hidden="true">×</span> Thoát popup</button>
   </div>
   {!entry?.terminalId&&device.terminal&&<p className="terminal-note">Máy đang có Terminal session. Chỉ một người điều khiển được mở mỗi lần.</p>}
   {!entry&&<div className="terminal-controls"><label>Shell<select value={shell} onChange={e=>setShell(e.target.value)} disabled={!canOpen}>{(device.terminalShells||[]).map(item=><option value={item} key={item}>{item==='cmd'?'CMD':'PowerShell'}</option>)}</select></label><button disabled={!canOpen} onClick={open}>Mở Terminal</button></div>}
   {entry?.state==='requesting'&&<p className="terminal-note">Đang kết nối Local Agent…</p>}
   {entry?.terminalId&&<><div className="terminal-controls"><span>{entry.shell==='powershell'?'PowerShell':'CMD'} · {entry.state==='connected'?'đã kết nối':entry.state}</span><div className="terminal-actions"><button className="secondary" disabled={!hasSelection} onClick={copySelection}>Sao chép</button><button className="secondary" onClick={pasteClipboard}>Dán</button><button className="warn" disabled={entry.state==='closing'} onClick={close}>Đóng Terminal</button></div></div>{clipboardMessage&&<small className="terminal-note" role="status">{clipboardMessage}</small>}<div className="terminal-screen" ref={container} role="application" aria-label="Remote terminal; nhấn để nhập lệnh" onClick={()=>terminalRef.current?.focus()}/></>}
   {!device.terminalSupported&&<p className="terminal-note">Terminal chỉ có trên Windows Local Agent.</p>}
   {device.terminalSupported&&!ownLease&&device.role!=='viewer'&&<p className="terminal-note">Yêu cầu và xác nhận phiên điều khiển trước khi mở Terminal.</p>}
   {blocked&&<p className="terminal-note">Dừng script đang chạy trước khi mở Terminal.</p>}
   {entry?.terminalId&&<small className="terminal-footer-note">Thoát popup chỉ ẩn cửa sổ; phiên tiếp tục chạy. Chọn “Đóng Terminal” để kết thúc phiên.</small>}
  </section>
 </div>,document.body);
}

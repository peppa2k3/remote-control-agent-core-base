const portInput=document.getElementById('port');portInput.disabled=true;document.getElementById('discover').disabled=true;
function endpoint(){const port=Number(portInput.value);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');return `http://127.0.0.1:${port}`;}
const select = document.getElementById('profile');
const message = document.getElementById('message');
async function request(path, body) {
  const response = await fetch(endpoint() + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  const data = await response.json();
  if (!response.ok) {
    if (path === '/api/profiles' && [400, 401, 404].includes(response.status)) throw new Error('Agent đang chạy bản cũ. Khởi động lại node index.js rồi mở lại Extension options');
    throw new Error(data.error || `Agent HTTP ${response.status}`);
  }
  return data;
}
async function load() {
  // A cross-origin GET can omit Origin and be treated as an unauthenticated API
  // client. POST remains read-only here and carries Chrome's extension origin.
  const data = await request('/extension/profiles', {});
  for(const link of document.querySelectorAll('a[href^="http://127.0.0.1:"]'))link.href=endpoint()+new URL(link.href).pathname;
  const config = await chrome.storage.local.get(['profile']);
  select.replaceChildren(new Option('Choose profile',''));
  for (const item of data.profiles) {
    const option = document.createElement('option');
    option.value = item.directory; option.textContent = `${item.name} (${item.directory})`;
    select.append(option);
  }
  select.value = config.profile || '';
}
document.getElementById('save').onclick = async () => {
  try {
    if (!select.value) throw new Error('Hãy chọn profile của cửa sổ Chrome này');
    const result=await chrome.runtime.sendMessage({type:'configureProfile',profile:select.value,port:Number(portInput.value)});
    if(!result?.ok)throw Error(result?.error||'Extension worker unavailable');
    message.textContent = 'Đã lưu. Extension sẽ kết nối agent trong vài giây.';
  } catch (error) { message.textContent = error.message; }
};
document.getElementById('discover').onclick=()=>load().catch(e=>message.textContent=e.message);
chrome.storage.local.get(['port']).then(c=>{portInput.value=c.port||34719;portInput.disabled=false;document.getElementById('discover').disabled=false;if(c.port)return load();}).catch(error => { message.textContent = `${error.message}. Chạy node index.js rồi mở lại trang này.`; });

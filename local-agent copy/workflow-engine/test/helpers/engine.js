const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');

function temporary(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function removeTemporary(directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir())) throw new Error('Refusing cleanup outside a direct temporary child');
  fs.rmSync(resolved, { recursive: true, force: true });
}
async function startEngine({ entry = path.resolve(__dirname, '../../index.js'), directory = temporary('core-workflow-'), token = randomBytes(32).toString('hex'), daemon = true, configure = () => ({}) } = {}) {
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const data = path.join(directory, 'activity'), scenarios = path.join(directory, 'scenarios');
  fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(scenarios, { recursive: true });
  fs.writeFileSync(path.join(directory, 'Local State'), JSON.stringify({profile:{info_cache:{Default:{name:'Fixture'}}}}));
  fs.writeFileSync(path.join(scenarios, 'wait.json'), JSON.stringify({ variables:{delay:20}, steps:[{action:'wait',ms:'{{delay}}'}] }));
  // A malformed legacy credential file must never be read by core's distribution.
  fs.writeFileSync(path.join(data, 'remote.json'), 'invalid JSON - dummy legacy credential fixture');
  const env = {};
  for (const key of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','COMSPEC','PATHEXT']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { LOCAL_AGENT_ENV_FILE:path.join(directory,'missing.env'), MONGODB_URI:'', LOCAL_AGENT_API_TOKEN:token, LOCAL_AGENT_PORT:String(port), LOCAL_AGENT_DATA_DIR:data, LOCAL_AGENT_SCENARIOS_DIR:scenarios, CHROME_USER_DATA_DIR:directory, CHROME_PROFILE:'Default' });
  Object.assign(env,configure({directory,data,scenarios}));
  const child = spawn(process.execPath, [entry, ...(daemon ? ['--daemon'] : [])], { cwd:directory, env, stdio:['pipe','pipe','pipe'], windowsHide:true });
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  const base = `http://127.0.0.1:${port}`;
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const done = once(child, 'close');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await done; } finally { clearTimeout(timer); }
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(base, {signal:AbortSignal.timeout(300)}); if (response.ok) return { child,base,token,env,directory,data,scenarios,close }; } catch {}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  await close(); throw new Error('Fixture engine failed to start: ' + logs.replaceAll(token || 'NOT_A_TOKEN', '[redacted]'));
}
module.exports = { temporary, removeTemporary, startEngine };

import {createWorkflowGrantRelay} from './workflow-grants.js';
const operations = Object.freeze({profiles: [], scenarios: [], describe: ['scenario'], runs: ['profile'], status: ['runId'], stop: ['runId'], run: ['scenario', 'profile', 'variables', 'timeoutMs']});
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function fail(status, message) { throw Object.assign(new Error(message), {status}); }

export function createWorkflowRelay({agents, db, authenticate, broadcast}) {
  const v2=createWorkflowGrantRelay({agents,db,authenticate,broadcast});
  const capabilities = new Map();
  function bindAgent(socket, deviceId) {
    v2.bindAgent(socket,deviceId);
    capabilities.delete(deviceId);
    socket.on('agent:workflow-capabilities', (payload, ack) => {
      if (agents.get(deviceId)?.socket !== socket) return;
      try {
        if (!object(payload) || Object.keys(payload).some(key => !['version', 'configured', 'operations', 'error'].includes(key)) || payload.version !== 1 || typeof payload.configured !== 'boolean' || !Array.isArray(payload.operations) || payload.operations.length > 7 || payload.operations.some(name => !Object.hasOwn(operations, name))) fail(400, 'Workflow capabilities không hợp lệ');
        capabilities.set(deviceId, {configured: payload.configured, operations: [...new Set(payload.operations)]});
        ack?.({ok: true}); broadcast();
      } catch (error) { capabilities.delete(deviceId); ack?.({error: error.message, status: error.status || 400}); }
    });
    socket.on('disconnect', () => { if (!agents.has(deviceId) || agents.get(deviceId)?.socket === socket) capabilities.delete(deviceId); });
  }
  function bindBrowser(socket, userId) {
    v2.bindBrowser(socket,userId);
    let count = 0, started = Date.now(), pending = 0;
    function authorized(deviceId, sessionId, expectedAgent) {
      if (!socket.connected || authenticate(socket.request) !== userId) fail(401, 'Phiên đăng nhập hết hạn');
      if (db.role(deviceId, userId) === 'viewer') fail(403, 'Viewer không được điều khiển workflow');
      const agent = agents.get(deviceId), lease = db.lease(deviceId);
      if (!agent || (expectedAgent && agent !== expectedAgent) || Date.now() - agent.seen >= 25000) fail(409, 'Local Runner offline hoặc đã kết nối lại');
      if (!lease || lease.state !== 'active' || lease.id !== sessionId || lease.userId !== userId || lease.browserId !== socket.id) fail(403, 'Cần active lease trên đúng browser');
      return agent;
    }
    socket.on('workflow:request', async (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (v2.handles(payload?.deviceId)) return v2.request(socket,userId,payload,ack);
      let reserved = false;
      try {
        if (Date.now() - started > 10000) { started = Date.now(); count = 0; }
        if (++count > 40 || pending >= 4) fail(429, 'Quá nhiều yêu cầu workflow');
        if (!object(payload) || Object.keys(payload).some(key => !['deviceId', 'sessionId', 'operation', 'params', 'requestId'].includes(key))) fail(400, 'Yêu cầu workflow không hợp lệ');
        const {deviceId, sessionId, operation, params = {}, requestId} = payload;
        if (typeof deviceId !== 'string' || typeof sessionId !== 'string' || !Object.hasOwn(operations, operation) || !object(params) || Object.keys(params).some(key => !operations[operation].includes(key))) fail(400, 'Tham số workflow không hợp lệ');
        if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId))) fail(400, 'requestId không hợp lệ');
        if (operation === 'run' && !requestId) fail(400, 'run cần requestId để thử lại an toàn');
        if (Buffer.byteLength(JSON.stringify(params)) > 12000) fail(413, 'Tham số workflow quá lớn');
        const agent = authorized(deviceId, sessionId);
        const capability = capabilities.get(deviceId);
        if (!capability?.configured || !capability.operations.includes(operation)) fail(409, 'Local Agent chưa cấu hình workflow API');
        pending++; reserved = true;
        const response = await agent.socket.timeout(12000).emitWithAck('workflow:request', {sessionId, operation, params, requestId});
        authorized(deviceId, sessionId, agent);
        if (!object(response) || response.requestId !== requestId || typeof response.ok !== 'boolean' || Buffer.byteLength(JSON.stringify(response)) > 512000) fail(502, 'Workflow response không hợp lệ hoặc quá lớn');
        if (!response.ok) fail(Number.isInteger(response.status) && response.status >= 400 && response.status <= 599 ? response.status : 502, typeof response.error === 'string' ? response.error.slice(0, 500) : 'Workflow API lỗi');
        if (['run', 'stop'].includes(operation)) db.audit(userId, deviceId, 'workflow.' + operation);
        ack({ok: true, requestId, data: response.data});
      } catch (error) {
        ack({ok: false, error: error.status ? error.message : 'Local Agent không phản hồi; kiểm tra lịch sử trước khi chạy lại', status: error.status || 504});
      } finally { if (reserved) pending--; }
    });
  }
  return {bindAgent, bindBrowser,blocked:v2.blocked,revoke:v2.revoke,renew:v2.renew,tick:v2.tick,close:v2.close,supported(deviceId) { return v2.handles(deviceId)?v2.supported(deviceId):capabilities.get(deviceId)?.configured === true; }};
}

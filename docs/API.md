# HTTP và realtime

## Workflow engine bridge

`agent:workflow-capabilities` từ runner: `{version:1,configured,operations}`.
`workflowSupported` được thêm vào device snapshot khi runner online và cấu hình
hợp lệ. Không quảng bá token hoặc đường dẫn file cấu hình.

Browser gửi `workflow:request` với `{deviceId,sessionId,operation,params,requestId?}`.
Operations: `profiles`, `scenarios`, `describe` (`scenario`), `runs` (`profile?`),
`status`/`stop` (`runId`), `run` (`scenario,profile,variables?,timeoutMs?`).
`run` cần requestId ổn định. Backend yêu cầu owner/operator giữ active lease đúng
browser, heartbeat còn mới, giới hạn schema/tần suất rồi relay sang runner bỏ
deviceId. Runner gọi API local với token của máy. ACK về browser:
`{ok:true,requestId,data}` hoặc `{ok:false,error,status}`. Revoke trong khi đợi
response từ chối trả data cho browser cũ. Socket payload tối đa 512KiB; từng
event vẫn có giới hạn riêng (terminal 4KiB, workflow params 12KB).
Runner cũng áp dụng giới hạn params 12KB và hủy HTTP đang chờ khi lease local
hết hạn, bị thay thế, revoke hoặc socket disconnect. Gia hạn cùng session giữ
request đang chờ tới expiry mới. Kết quả tới sau khi hủy không được relay.

Xem [cấu hình, ví dụ và vòng đời workflow](WORKFLOW.md).
HTTP app cùng origin frontend; mọi mutation của user yêu cầu Origin = PUBLIC_ORIGIN. Cookie rca HttpOnly, SameSite=Strict, Secure trên HTTPS. Body JSON tối đa 16KiB. Error {error}; HTTP 400/401/403/404/409/500.

| Method/path | Input | Quyền/kết quả |
|---|---|---|
| GET /api/health | — | Public, status ok + at |
| POST /api/auth/login | email,password | Cookie 8h; user id/email/name |
| GET /api/auth/me | — | User hiện tại |
| POST /api/auth/logout | {} | Xóa cookie/session và disconnect socket của session đó |
| POST /api/pairing | name | Auth user; code + expiresIn:300 |
| POST /api/agents/enroll | code | Một lần; deviceId + credential; console local cho phép trước khi gọi |
| GET /api/devices | — | Chỉ máy có quyền; runnerStatus, meshStatus, status CPU/RAM/mạng, `terminalSupported`/`terminalShells`, terminal state không có terminalId/browserId, session không có nonce/browserId |
| GET /api/devices/:id/members | — | Owner |
| POST /api/devices/:id/members | email,role viewer/operator | Owner; user phải được seed trước |
| DELETE /api/devices/:id/members/:userId | — | Owner; revoke lease người bị gỡ |
| DELETE /api/devices/:id | — | Owner; thu hồi credential và mọi phiên |
| GET /api/devices/:id/audit | — | Owner; 100 event mới nhất |

Socket.IO path /socket.io. Browser dùng cookie, agent dùng auth {kind:'agent',credential}; server lấy deviceId từ DB, không tin deviceId tự khai.
| Event | Hướng | Payload |
|---|---|---|
| devices:snapshot | VPS → browser | danh sách máy đã lọc quyền |
| agent:ready | VPS → runner | deviceId |
| agent:heartbeat | runner → VPS | {}, ack {ok,at} |
| agent:status | runner → VPS | `{cpuPercent,ramUsedBytes,ramTotalBytes,networkRxBytesPerSecond,networkTxBytesPerSecond,uptimeSeconds}`; ack `{ok,at}` hoặc `{error,status}`. Runner credential xác định thiết bị; server kiểm tra giá trị và giới hạn tối đa 1 report/giây. |
| agent:terminal-capabilities | runner → VPS | `{platform,shells}`; chỉ `win32` cùng shell `cmd`/`powershell` mới được công bố. |
| agent:terminal-state | runner → VPS | Danh sách terminalId/sessionId còn sống sau reconnect; backend xóa trạng thái cũ khi agent xác nhận process đã dừng. |
| terminal:open | browser → VPS → runner | `{deviceId,sessionId,shell,cols,rows}`; owner/operator phải giữ active lease trên đúng browser socket. Mỗi device tối đa một terminal. |
| terminal:opened | runner → VPS → browser | `{terminalId,sessionId,shell,startedAt}`; chỉ browser đã mở session nhận. |
| terminal:input | browser → VPS → runner | `{deviceId,terminalId,sessionId,data}`; tối đa 4KiB mỗi gói và 1MiB mỗi phiên; cần lease còn hiệu lực. Input không được lưu/log. |
| terminal:output | runner → VPS → browser | `{terminalId,sessionId,text}`; tối đa 4KiB mỗi gói, 4MiB mỗi phiên; chỉ browser sở hữu terminal nhận, không persist. |
| terminal:resize | browser → VPS → runner | `{deviceId,terminalId,sessionId,cols,rows}`; cols 20–300, rows 5–120. |
| terminal:close | browser → VPS → runner | `{deviceId,terminalId,sessionId}`; dừng shell, trạng thái giữ đến khi agent báo `terminal:exited`. Revoke, timeout/offline, disconnect và owner takeover cũng yêu cầu đóng. |
| terminal:exited / terminal:error | runner → VPS → browser | Kết quả đóng hoặc lỗi chỉ có metadata; audit không chứa command/output. |
| status trong devices:snapshot | VPS → browser | Cùng sáu trường trên + `updatedAt` (epoch ms), hoặc `null` khi runner offline/chưa báo cáo hay báo cáo cũ hơn 3 phút. Status chỉ lưu trong memory, không persist. |
| session:request | browser → VPS | deviceId, force?; ack pending/sessionId hoặc error/status. Nếu terminal cũ đang dừng, owner cần thử lại sau khi runner xác nhận kết thúc. |
| session:offer | VPS → runner | sessionId,nonce,userId,userName,owner,expires |
| session:ack | runner → VPS | sessionId,nonce,accept:boolean |
| session:active | VPS → browser/runner | sessionId,expires; browser thêm deviceId |
| session:renew | browser → VPS | deviceId,sessionId |
| session:release | browser → VPS | deviceId |
| session:revoked | VPS → browser/runner | sessionId,reason; browser thêm deviceId |

Core không có protocol để chạy script đã cấu hình trên Local Runner. Remote Terminal là luồng riêng qua active lease, giới hạn thời gian/kích thước và chỉ chạy CMD/PowerShell trên Windows bằng quyền OS của Local Runner.
# Engine workflow đóng gói WFI-02

`local-agent/workflow-engine/` phục vụ HTTP loopback API v1 trên máy local,
không là endpoint HTTP công khai mới của backend. Hợp đồng v1 và schema ở
[AUTOMATION_API](../local-agent/workflow-engine/docs/AUTOMATION_API.md), cấu hình
bridge ở [WORKFLOW](WORKFLOW.md). Token chỉ ở local; frontend dùng relay đã có.

Các operation hiện có giữ nguyên: profiles/scenarios/describe/runs/status/run/stop.
Bootstrap bản core không khởi tạo remote-client HTTP cũ hoặc đọc remote.json;
GET `/api/remote/status` sau auth dashboard trả enabled=false, POST `/api/remote/*`
sau auth trả 410. `/remote` là trang thông tin; không có pairing control-server.
Không thêm health/grant/profile-open API v2 ở WFI-02. V1 Idempotency-Key ở RAM,
HTTP 202 chỉ accepted và hủy HTTP không dừng workflow đã nhận.
# WFI-03 integrated API và grant

Mode integrated (engine 0.4.0) implement HTTP loopback mới với Bearer local:
GET `/api/v2/health`; PUT/GET `/api/v2/grants/:grantId`; POST
`/api/v2/grants/:grantId/revoke`; GET profiles/scenarios/describe/runs/status,
POST runs và runs/:runId/stop dưới `/api/v2`. Catalog/run/status/stop cần headers
X-Workflow-Grant, X-Workflow-Fence, X-Workflow-Engine-Instance; mutation cần JSON,
run/stop cần Idempotency-Key. Body/schema và giới hạn theo contract subset:
[WORKFLOW_GRANTS](WORKFLOW_GRANTS.md).

Socket mới: workflow:v2:capabilities, workflow:v2:grant, workflow:v2:revoke,
workflow:v2:dispatch và workflow:v2:request. Event workflow:request cũ được route
v2 khi agent advertise v2; FE không gửi grant/fence/user/browser/expiry. Backend
derive job correlation ID cho retry run, stop cũ được thêm key phía server.
Takeover trả 409 khi barrier chưa quiescent. Agent disconnect không tự clear DB
barrier; counter/barrier tồn tại qua backend restart, leases không phục hồi.

API v1 và Bearer token trên API dashboard cũ bị chặn trong integrated mode;
dashboard session local và extension protocol vẫn riêng. Extension 4.3.0 gửi
settlementVersion=1 và settled receipt; thiếu/false không advance, không nhả khóa.
HTTP JSON engine chặn duplicate/prototype keys. Chưa implement openProfile,
GET jobs, report/reconcile/queue/retention toàn tuyến.

WFI-04: `GET /api/v2/health` thêm `lifecycleVersion:1`; vẫn yêu cầu Bearer token
loopback. Response gồm engineVersion/engineInstanceId, operations, policyRevision,
health state/reasonCode/checkedAt. Managed còn kiểm tra instance qua IPC của child.
Không có HTTP endpoint cấu hình/start supervisor từ frontend.

`workflow:v2:capabilities` thêm metadata `supervisor:{mode,owned,restarts}`.
Backend chỉ giữ các trường được chọn, reason thuộc allowlist, version dạng semver,
policyRevision là integer; bỏ nested path/token và dùng thời gian nhận tại server.
`devices:snapshot[].workflowHealth` gồm state, reasonCode, checkedAt, engineVersion,
engineInstanceId, supervisor; chỉ trả trong snapshot đã lọc membership. Offline
trả null; quá 15 giây không có health thì degraded/STALE và workflowSupported=false.
Runner heartbeat không gia hạn health. Refresh cùng instance/policy ready không
thu hồi grant hiện hành; đổi instance/policy hoặc mất ready thu hồi grant.
Các state: configured/starting/ready/degraded/stopping/failed/unconfigured.

## WFI-05 — Chrome profile (engine 0.4.0 / extension 4.4.0)

Capability protocol 2 có operation thứ tám `openProfile` khi engine hỗ trợ.
Backend/runner kiểm tra owner/operator + active lease như run, chỉ nhận
`params:{profile}`. Route `POST /api/v2/profiles/open`, body `{profile}` cần
Bearer + X-Workflow-Grant/Fence/Engine-Instance và local policy allowOpen.
Không nhận URL/path/flags/env. Response `{profile,state,reasonCode}`; trạng thái
được poll qua catalog `GET /api/v2/profiles`, mỗi item thêm allowOpen/readiness.
`workflowHealth.operations` trong device snapshot dùng để bật nút theo capability.

Extension local có `POST /extension/profiles` và `/extension/bind`, chỉ dành cho
Origin extension; discovery trả profile IDs policy cho phép, không storage/token.
Bind nhận profile/clientId/workerId/readinessVersion=1/settlementVersion=1, trả
connectionId nonce local. Integrated state/next/result/picker kiểm tra binding;
nonce/client không chuyển lên VPS. Heartbeat hết 10 giây mất readiness, worker
restart không nhận lại step ambiguous. Port mặc định 34719, Options hỗ trợ đổi
port loopback 1024–65535 cùng engine. Web start và từng bước kiểm tra readiness;
local-only không cần extension. Xem [WORKFLOW_CHROME](WORKFLOW_CHROME.md).

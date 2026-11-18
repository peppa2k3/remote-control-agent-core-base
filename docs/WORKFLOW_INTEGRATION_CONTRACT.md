# Contract workflow integrated v2 — thiết kế WFI-01

Trạng thái: **contract tổng thể, WFI-03 đã implement subset policy/grant**.
Xem [phạm vi thực và cấu hình](WORKFLOW_GRANTS.md). Đã có health/grants/catalog/
run/status/stop và Socket.IO grant/revoke/dispatch; panel cũ route v2 theo runner.
WFI-06 đã triển khai GET jobs, durable intent/receipts và retention 30/90 ngày.
Wire thực tế: [WORKFLOW_JOBS](WORKFLOW_JOBS.md). Reconcile dùng engine GET jobs
phân trang và workflow:v2:report + ACK, không có event reconcile riêng. Cursor
là job UUID; progress chỉ index/total, action=null. Không persist payload để replay
queue sau crash; grant gốc bất biến. Engine hiện tại 0.5.0, schema 2.
WFI-05 đã thêm openProfile và readiness: [WORKFLOW_CHROME](WORKFLOW_CHROME.md).
WFI-04 đã thêm supervisor và health, xem
[phạm vi triển khai](WORKFLOW_SUPERVISOR.md). Các yêu cầu ở những phần planned
chưa được bảo đảm bởi WFI-03/04.

Điều chỉnh đã implement: grant wire gồm agentInstanceId/engineInstanceId; policy
có thêm urlOrigins/fileRoots tùy chọn và không cho override URL/path/locator/action.
Extension 4.3.0 dùng settlementVersion=1/settled receipt; mất port không phải
quiescent. Guard journal giới hạn 2000 records mỗi loại, không auto purge unknown.
Duplicate JSON keys bị chặn ở HTTP engine; Socket.IO kiểm tra object đã decode.

## Identity và message chung

`protocolVersion: 2`; ID do server/engine tạo là UUID v4 lowercase; `requestId`
do client tạo theo regex `[A-Za-z0-9_-]{1,128}`. Scenario ID theo regex
`[a-z0-9][a-z0-9_-]{0,63}`. Profile ID phải thuộc catalog/policy local, giai đoạn
đầu chỉ `Default` hoặc `Profile N` hợp lệ; không nhận path. Integer phải safe,
nonnegative, thời điểm Unix ms; bộ đếm seq bắt đầu 1. Unknown field, duplicate
JSON key trong ingress mới, kiểu sai, NaN/Infinity/prototype keys bị từ chối.

Giữ cookie/Origin, pairing và pending ACK nonce của core. Browser không gửi
userId/browserId/agentInstanceId/grantId/fence hoặc expiry như bằng chứng quyền.
Backend lấy user từ auth, browserId từ socket.id và device từ membership/agent.
Mọi command được kiểm tra trước dispatch và khi trả kết quả. Agent reconnect
không phục hồi lease; cùng user khác browser phải xin lease mới.

### Socket mới

| Event / hướng | Payload cố định |
| --- | --- |
| `workflow:v2:capabilities` agent → VPS | `{protocolVersion, agentInstanceId, engineInstanceId, engineVersion, mode, operations, policyRevision, health}` |
| `workflow:v2:request` browser → VPS | `{deviceId, sessionId, operation, params, requestId?}` |
| `workflow:v2:dispatch` VPS → agent | `{protocolVersion, agentInstanceId, engineInstanceId, grantId, sessionId, fence, jobId?, requestId?, operation, params, deadline}` |
| `workflow:v2:grant` VPS → agent | `{protocolVersion, grantId, sessionId, deviceId, userId, browserId, fence, seq, issuedAt, expiresAt}` |
| `workflow:v2:revoke` VPS → agent | `{protocolVersion, grantId, fence, reason}` |
| `workflow:v2:report` agent → VPS | `{protocolVersion, agentInstanceId, engineInstanceId, jobId, grantId, fence, seq, state, runId, progress, quiescent, reasonCode}` |
| `workflow:v2:reconcile` agent → VPS | `{protocolVersion, agentInstanceId, engineInstanceId, reports, cursor}` |

Instance IDs đổi mỗi process start. Capability không cấp quyền; chưa probe engine
thì health không được ready. Agent xác minh grant/session từ message server đã
auth, so với lease local đang active; browser không có event để tự cấp grant.
Reconcile reports không mang params, token hoặc policy đầy đủ. Response command:
`{ok:true, requestId?, data}` hoặc `{ok:false, requestId?, status, code}`; UI map
code sang thông báo, không relay raw engine error. ACK report `{jobId,seq}` chỉ
sau commit transaction. Không dùng ACK transport làm bằng chứng run thành công.

`operations` là tập con không trùng của 9 operation trong bảng dưới; `mode` là
`integrated` hoặc `standalone`; `policyRevision` safe integer ≥1 hoặc null khi
chưa cấu hình. `health` object chỉ có `{state,reasonCode,checkedAt}`, state thuộc
enum health phía dưới. `progress` chỉ có `{index,total,action}`; index/total là
integer 0–10000, index ≤ total, action là enum action engine đã negotiate hoặc
null; không nhận label tùy ý. `runId` null trước accepted. `quiescent` boolean
do engine xác minh, default false. Cursor opaque ASCII ≤128 ký tự, bị ràng buộc
device và query, không là SQL/path; invalid cursor 400. `reason` là enum
release/logout/expired/offline/takeover/policy_changed/shutdown, không free text.
Engine/build version string ASCII ≤64; catalog labels ≤100 ký tự qua sanitize.

### Operation và quyền

| Operation | params | Ai được gọi trong integrated v2 |
| --- | --- | --- |
| `health` | `{}` | Member xem health tối giản từ snapshot; probe HTTP do agent, không mở grant cho viewer |
| `profiles`, `scenarios` | `{}` | Owner/operator có active lease; catalog đã lọc local policy |
| `describe` | `{scenario}` | Cùng quyền; chỉ schema/default được đánh dấu public |
| `runs` | `{profile?,cursor?}` | Cùng quyền; tối đa 50 mục/trang remote history |
| `status` | `{runId}` | Cùng quyền và run remote thuộc device/policy hiện tại |
| `openProfile` | `{profile}` | Cùng quyền, local policy có `allowOpen`; luôn requestId |
| `run` | `{scenario,profile,variables?,timeoutMs?}` | Cùng quyền và policy; luôn requestId |
| `stop` | `{runId}` | Cùng quyền; luôn requestId, dừng đúng run remote, không dừng theo profile chung |

Sau takeover, lease mới có thể đọc/dừng run remote cũ cùng device nếu policy cho
phép; không được resume hoặc đổi grant cho job cũ. Stop của hệ thống khi revoke
không cần user lease còn sống, nhưng phải target đúng grant/run do nó sở hữu.
Viewer không xem scenario vars/raw history hoặc gọi HTTP engine qua VPS.
Local admin có dashboard session riêng; run local không có grant web, không
bị dừng bởi revoke web. Remote không đọc/dừng history local không thuộc remote.

## HTTP engine mới

Base cố định `http://127.0.0.1:34719/api/v2`. Tất cả route dưới cần Bearer local
token, Host đúng, cấm browser Origin và redirects; token không rời máy. Engine
integrated mode bắt buộc token hợp lệ. JSON Content-Type cho POST/PUT; body chỉ
nhận field được liệt kê. Route v1 native token bị chặn trong integrated mode để
không bypass grant; local dashboard thao tác qua session riêng, không bằng token
v1. Standalone giữ v1 như cũ. Extension `/next`, `/result`, `/state`, `/pick/*`
tiếp tục qua engine nhưng không có quyền tạo grant/run tùy ý.

| Method/path mới | Nội dung / kết quả |
| --- | --- |
| GET `/health` | Không cần grant; `{protocolVersion:2,engineVersion,engineInstanceId,mode,health,capabilities,policyRevision}` |
| PUT `/grants/:grantId` | Grant fields như socket + engineInstanceId; nhận mới/renew có fencing; ACK `{grantId,fence,seq,state,expiresAt}` |
| POST `/grants/:grantId/revoke` | `{engineInstanceId,fence,reason}`; immediate disable, trả `{state:'stopping'|'revoked',quiescent}`; retry an toàn |
| GET `/grants/:grantId` | Grant state/quiescent; không chứa token hoặc vars |
| GET `/profiles`, `/scenarios`, `/scenarios/:name` | Header grant/fence/engine-instance; kết quả đã lọc policy |
| POST `/profiles/:profile/open` | `{}` + headers grant; profile URL-encoded duy nhất; trả readiness, không khẳng định extension đã cài |
| POST `/runs` | `{jobId,scenario,profile,variables?,timeoutMs?}` + grant headers + Idempotency-Key=requestId; 202 accepted hoặc 200 duplicate |
| GET `/runs?cursor=&profile=` và `/runs/:runId` | Grant headers; chỉ remote runs được quyền đọc; metadata đã sanitize |
| POST `/runs/:runId/stop` | `{jobId}` + grant headers + Idempotency-Key; 202 stopping hoặc 200 nếu đã quiescent |
| GET `/jobs/:jobId` | Adapter reconciliation bằng Bearer; không cần grant active để đọc receipt/stop cleanup; không tạo/renew/run |

Headers grant cố định: `X-Workflow-Grant`, `X-Workflow-Fence`,
`X-Workflow-Engine-Instance`. Không cho client chọn origin/path API. Profile open
không nhận URL/flags; Chrome executable, user-data và landing URL nằm local.
Engine cấp runId UUID riêng; jobId không tự đồng nhất runId như executor ref.
Receipt GET jobs chỉ trả jobId/runId/grant/fence/state/seq/quiescent/reasonCode,
không trả request body. Health reason enum: `starting`, `ready`, `degraded`,
`stopping`, `failed`, `incompatible`, `unconfigured`; reasonCode tối đa 64 ASCII.

Giới hạn: params 12.000 byte UTF-8, response data 500.000 byte, envelope tối đa
512.000 byte; 4 pending/browser và agent, 40 requests/10 giây/browser như v1.
HTTP command timeout 10 giây, relay 12 giây; workflow budget default 3.600.000,
tối đa 86.400.000 ms và bị grant expiry cắt sớm. Report batch tối đa 20 mục,
60.000 byte; retry báo cáo 3 giây → tối đa 60 giây có jitter, không retry execute.
Health poll 5 giây; snapshot quá 15 giây thành unknown, offline xóa live health.
Open readiness timeout 15 giây trả trạng thái chờ/thất bại; không giữ HTTP tới
khi Chrome sẵn sàng. Error codes chuẩn: CONFIG/INCOMPATIBLE/POLICY_DENIED/
LEASE_REQUIRED/STALE_INSTANCE/STALE_FENCE/BUSY/UNKNOWN_OUTCOME/UNAVAILABLE;
HTTP tương ứng 503/409/403/403/409/409/409/409/503. Malformed 400, auth 401,
not found 404, key conflict 409, too large 413, content type 415, rate 429.

## Policy local schema 1

File cấu hình tin cậy do local admin duyệt, không mutation từ web VPS:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "profiles": [{"id":"Profile 1","allowOpen":true}],
  "scenarios": [{
    "id":"fixture-wait",
    "sha256":"<64 lowercase hex of scenario bytes>",
    "profiles":["Profile 1"],
    "variables":{"delay":{"type":"integer","minimum":1,"maximum":1000}},
    "publicDefaults":["delay"]
  }]
}
```

Mặc định profiles/scenarios rỗng; thiếu/bad file deny. Revision tăng khi thay
policy, thay nội dung scenario phải duyệt lại hash; kiểm tra trước start mỗi run,
không chỉ khi publish catalog. Không tự bổ sung mọi biến của scenario vào quyền.
Biến schema hỗ trợ string với maxLength ≤4096 và enum tối đa 100 giá trị;
number/integer finite có min/max bắt buộc; boolean. Không null/object/array hoặc
runtime keys `download_*` dành riêng. Unknown variable từ chối. Đối với text tự
do, local admin phải xác nhận không nội suy vào URL/path/locator/action nhạy cảm;
không phân tích được an toàn thì chỉ enum hoặc không cho remote override.

URL chỉ https, origin trong danh sách local, không credentials, không tự cho
loopback/private network từ biến remote. Path chỉ logical enum mapping local;
FE không được gửi absolute/relative filesystem path. Tải/upload dùng path đã lưu
và engine validate realpath/root/file/hash. Template resolution phải kiểm tra
giá trị cuối, tránh một biến an toàn tham chiếu biến khác để vượt policy.
Policy thay đổi revoke grant/run remote bị ảnh hưởng trước cấp grant mới.
Tối đa 100 profiles/200 scenarios/100 vars mỗi scenario, policy file 64KB.

## Grant, fencing và quiescence

1. Sau pending local nonce ACK và lease active, backend tạo grant UUID ngẫu nhiên,
   gắn đúng device/user/browser/session/agent instance. Fence là counter persistent
   theo device trong SQLite, tăng mỗi grant; không reset khi backend restart.
2. Agent probe đúng engine integrated v2, đưa grant tới engine. Engine lưu high
   watermark fence và revoked tombstone bền vững, ACK trước advertise ready.
   Fence bằng chỉ hợp lệ cho cùng grant và instance đã ghi; fence thấp bị từ chối.
   Engine restart đổi instance; mọi grant cũ bị vô hiệu, không cấp lại theo replay.
3. Renew từ backend chỉ sau lease renew thật; seq tăng và expiry không quá lease.
   Adapter không tự kéo dài lease bằng heartbeat. Message seq cũ/issuedAt quá cũ,
   expiry vượt 45 giây, clock bất thường hoặc instance sai bị từ chối.
4. Backend/agent cùng máy khác clock: mỗi control message có issuedAt/expiresAt;
   agent trừ tuổi message và skew budget 2 giây khỏi remaining TTL, clamp ≤45s,
   tính deadline monotonic. Skew quá budget fail closed. Khi gọi engine cùng máy,
   truyền expiry đã clamp; engine cũng dùng monotonic watchdog và không tăng
   deadline nếu wall clock lùi. Watchdog ≤1 giây; kiểm tra deadline trước mỗi
   dispatch bước và khi nhận ACK. Không gia hạn grant đã hết hạn/revoked.
5. Revoke/expiry lập tức chặn start/next step, abort request/local action có thể
   hủy; engine đi stopping. ACK trễ không advance. Heartbeat extension bị thiếu
   không là bằng chứng action dừng. Extension cần cancel ACK theo execution/step,
   child process cần exit thật để coi quiescent. Side effect website đã xảy ra
   không rollback được. Không xác minh được cleanup → unknown/quiescent=false.
6. Backend takeover revoke grant cũ trước, giữ device workflow barrier đến receipt
   quiescent từ instance/fence hợp lệ; owner nhận 409 khi còn dừng. Sau đó mới tạo
   offer mới và local nonce ACK mới. Không “force” bỏ barrier. Offline/restart
   cũng không tự giải phóng barrier theo timeout; reconcile hoặc local admin
   xác minh quiescence có audit. Không kill Chrome người dùng làm bằng chứng.

## Jobs, lưu trữ và báo cáo

Backend SQLite schema migration mới: workflow_jobs (jobId PK, deviceId,
requestedBy, browserId, sessionId, grantId, fence, requestId, operation,
fingerprint, state, runId?, reportSeq, timestamps, deadline, quiescent, reasonCode),
workflow_device_state (deviceId PK, nextFence, barrier), idempotency tombstones.
Unique `(deviceId,requestedBy,requestId)` cho toàn bộ command; canonical body sắp
key recursively, SHA-256 của operation/params/device. Cùng key/body trả receipt
cũ sau auth lại; không rebind grant/job. Khác body 409, kể cả operation khác.

Không persist raw vars/payload trong VPS: command dispatch ngay dưới lease live,
queued chỉ là hàng chờ RAM ngắn tối đa 4/device; DB ghi intent/fingerprint trước
dispatch. Backend restart hủy queued chưa dispatch và đánh dispatched/running
unknown đến reconcile, không dựng lại body hoặc tự gửi lần nữa. Local engine
journal giữ job/request key/fingerprint/grant/fence/runId và phase trước side
effect, cùng receipt sau start; body cần thiết chỉ local có ACL, không log.
Engine phải hỗ trợ durable job lookup, không chỉ RAM idempotency API v1.

States: queued → dispatched → running → succeeded/failed; queued → cancelled/
expired; dispatched/running → stopping → cancelled hoặc unknown. Local validation
rejected. Process restart interrupted chỉ nếu đã chứng minh không còn action/
process; nếu chưa thì unknown. Unknown là trạng thái cần reconcile, không là
quiescent. Terminal states chỉ nhận duplicate cùng nội dung; receipt mâu thuẫn
quarantine, không sửa outcome âm thầm. Unknown có thể được giải quyết bằng receipt
hoặc local audit, không bằng replay. Stop có job riêng và target runId rõ ràng;
cancel-before-delivery ghi tombstone khiến execute muộn bị chặn.

Report seq persistent per job, tăng khi snapshot đổi; backend commit seq mới
hơn và ACK, ignore duplicate/out-of-order, reject instance/fence sai. Sau restart
agent gửi tối đa 20 receipts/batch theo cursor; server chỉ merge, không resume
execution. Stop cleanup có thể retry đúng grant/run sau revoke, không start lại.
RunId được ghi durable trước side effect và receipt lookup luôn tra được jobId
khi POST response mất; crash không xác định vẫn unknown, không hứa exactly-once.

Retention mặc định mới: job metadata 30 ngày, idempotency tombstones 90 ngày cả
VPS và local; không purge unresolved/barrier/unacked receipts. Tombstone không có
body/vars. Lịch sử engine local theo chính sách local riêng, UI không giả 30 ngày
remote là toàn bộ history. Sau 90 ngày key đã purge có thể tạo job mới: client
không tự retry key cũ, bắt đầu run mới có chủ đích. Outbox có cap 10.000 receipts
chưa ACK hoặc 50MB: ngừng nhận remote jobs, vẫn cho stop/revoke/reconcile; không
xóa bằng chứng để nhường chỗ. Giới hạn cần test ở WFI-06, chưa có trong runtime.

Remote projection whitelist: IDs, scenario/profile ID, enum state/action, step
index/total, timestamps, health flags, fixed reasonCode. Không raw errors, label
do user nhập, variables/default riêng, URLs/download paths, page text, cookies,
Chrome user data, video bytes, MongoDB URI, token/pairing code. Full history/media
ở engine local; MongoDB outbox nghiệp vụ riêng, không đồng bộ sang DB auth core.
VPS audit chỉ metadata tên operation/jobId/outcome, không command hay response.

## Failure matrix bắt buộc

| Tình huống | Hành vi cần test | Gate |
| --- | --- | --- |
| Viewer/cùng user khác browser | 403 trước dispatch, không lộ catalog/vars | WFI-03/07 |
| Nonce cũ/pending ACK sai device | Không active, không grant | Core + WFI-03 |
| Grant renew seq trễ/revoke rồi renew | Không tăng deadline/khôi phục quyền | WFI-03 |
| Browser logout/disconnect/membership/device revoke | Revoke grant, stop remote run; barrier đến quiescent | WFI-03 |
| Mất VPS/adapter crash | Engine watchdog hết hạn, chặn bước mới; local run độc lập giữ nguyên | WFI-03/04 |
| Owner takeover/stop ACK trễ | Không run mới đến quiescent và handshake mới | WFI-03 |
| Lost POST response sau accepted | Tra receipt jobId, không key mới/re-execute | WFI-06 |
| Crash journal-before-start/start-before-receipt | Không replay, reconcile hoặc unknown | WFI-06 |
| Backend restart | Lease cũ xóa, fence không lùi, giữ barrier và unknown | WFI-06 |
| Engine restart/occupied port | Instance mới, grant cũ invalid, không kill engine ngoài ownership | WFI-04/06 |
| Duplicate/out-of-order receipt/terminal progress | Seq không lùi/outcome không regress | WFI-06 |
| Stop trước run delivery | Tombstone chặn execute run đến muộn | WFI-06 |
| Policy/scenario đổi giữa catalog và start | Hash/revision kiểm tra lại, deny/revoke | WFI-03 |
| Extension missing/wrong client/worker sleep | Không giả ready, timeout có trạng thái; stale ACK không advance | WFI-05 |
| GUI picker giữa profiles/local user | Resource lock; không tuyên bố độc quyền OS | WFI-05/08 |
| UI đổi máy/lease/reconnect | Bỏ stale response; history theo auth hiện tại | WFI-07 |

Giới hạn còn phải chứng minh: cancellation Chrome debugger/DOM đang thực thi,
process-tree download, NTFS ACL, interactive task, WAN và VPS thật. Contract này
không đánh các trường hợp đó pass và không tạo env example cho tính năng chưa có.

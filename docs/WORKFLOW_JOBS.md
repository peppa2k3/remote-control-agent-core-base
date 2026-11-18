# Jobs và đồng bộ local–VPS — WFI-06

Engine **0.5.0**, adapter protocol 2 + `jobsVersion:1`; extension giữ **4.4.0**.
Port ý tưởng journal/seq/ACK từ remote-executor/control-server tham chiếu, giữ
auth/pairing/membership/lease Socket.IO core. Không bật `/device/exchange` hoặc
control-server thứ hai. Không copy/sửa installation `local-agent copy/`.

## Chạy và nâng cấp

- Cài source chính theo workspace hiện tại, giữ cấu hình supervisor/Chrome từ
  [WORKFLOW_SUPERVISOR](WORKFLOW_SUPERVISOR.md) và [WORKFLOW_CHROME](WORKFLOW_CHROME.md).
  Không có env mới để bật queue chạy qua lease. Protocol 2 trong `local-agent/src/index.js`
  tự tạo `workflow-journal.sqlite` cạnh file `CREDENTIALS_PATH`; đường dẫn chỉ do
  cấu hình local chọn. Giữ file/journal/runtime trong thư mục riêng có ACL NTFS
  cho user chạy runner, SYSTEM/Administrators hoặc POSIX permissions tương ứng.
- Backend tự migration SQLite khi startup, không xóa dữ liệu core. Engine đổi
  `workflow-grants.json` schema 1 → 2, tạo backup `.v1-backup.json` nếu chưa tồn
  tại, giữ runs/fence/grants, bổ sung jobs. File được atomic replace + fsync trước
  side effect. Không tự reset journal/machine/device identity.
- Adapter quảng bá jobsVersion=1 chỉ khi có journal và engine hỗ trợ. Backend
  lưu durable jobs cho capability này; v1/adapter cũ vẫn là legacy bridge, không
  được coi là có chống replay/sync toàn tuyến. Nâng source đồng bộ trước dùng;
  history VPS không tự nhập toàn bộ history của các installation cũ.

## Đường đi một command

1. Frontend gửi operation/params đã giới hạn + requestId. Với durable capability,
   run/stop/openProfile đều cần key. Backend xác thực user, membership, browser
   socket, active lease, runner và engine; không nhận bằng chứng grant từ frontend.
2. SQLite `BEGIN IMMEDIATE` ghi intent queued và fingerprint canonical SHA-256
   của operation/params, unique `(deviceId,requestedBy,requestId)`; không lưu raw
   params/variables trên VPS. Hàng chờ chỉ là promise/RAM ngắn trong lease hiện
   tại, tối đa các request đang được giới hạn; DB không chứa body để replay.
3. Sau grant ACK, backend kiểm tra lại lease, deadline và cancellation rồi commit
   dispatched với grant/fence/originEngineInstanceId trước emit. Adapter ghi
   intent vào SQLite journal synchronous FULL trước HTTP. Job không đổi grant.
4. `POST /api/v2/jobs` ghi jobId ↔ runId và phase trước gọi workflows.start. RunId
   được engine cấp sẵn và ghi trong cùng journal với run record trước side effect.
   Nếu response mất, lookup bằng jobId; không phát requestId mới hoặc POST lại.
5. Engine tăng seq khi snapshot đổi, adapter lưu report + seq/ACK bền vững. Sync
   poll 2 giây, page/batch tối đa 20; lỗi network backoff 1/2/4… tối đa 30 giây.
   VPS kiểm tra socket/instance/grant/fence/job, schema/size/rate, commit receipt
   rồi mới ACK `{jobId,seq}`. Adapter ACK engine rồi commit ACK local. Mất bất kỳ
   ACK nào chỉ retry metadata, không retry execution.

Fingerprint sắp key object đệ quy; thứ tự array vẫn có ý nghĩa. Cùng key/body trả
receipt cũ sau kiểm tra quyền; đổi body hoặc operation trả 409. Scope user/device
không bao gồm session mới: takeover/restart không làm key cũ thành command mới.
Frontend giữ key khi lỗi và chỉ phát key mới cho ý định mới sau receipt thành công.
Key legacy đã có run ở engine không được chuyển thành job mới để chạy lại.

## State, stop và crash

| State | Ý nghĩa |
| --- | --- |
| queued | Intent đã lưu, chưa dispatch; không sống qua lease/restart |
| dispatched | Đã pin grant/instance và có thể đã tới local |
| running | Engine có receipt run đang chạy |
| stopping | Đã yêu cầu dừng đúng job/run, chưa có quiescence |
| succeeded/failed/rejected/cancelled/expired | Outcome; chỉ coi cleanup xong khi quiescent=true |
| unknown | Chưa đủ chứng cứ outcome/cleanup; không replay, không purge |

Backend restart hủy queued, đổi dispatched/running/stopping thành unknown và xóa
lease cũ theo core. Engine restart đổi instance, revoke grant, giữ interrupted
job/run unknown. Outcome terminal đã biết không bị report progress trễ ghi lùi;
receipt mâu thuẫn bị từ chối/giữ unacked để review. Timestamp nhận tại VPS là
thời gian authoritative; observedAt chỉ metadata, không cấp quyền hay kéo lease.

`workflow:v2:cancel` cần active lease và owner/operator hiện tại, target jobId
thuộc device. Cancel queued ngăn dispatch. Local cancel có đường ưu tiên riêng,
không xếp sau start: ghi tombstone trước delivery, stop đúng runId nếu đã có.
Revoke/expiry/offline vẫn dừng mọi run remote trong grant theo WFI-03, không kill
Chrome hoặc local run ngoài grant. Barrier chỉ nhả khi engine xác nhận cleanup;
unknown trong jobs cũng tham gia barrier, không chỉ runs.

Nếu adapter restart ở giữa commit journal và HTTP, recovery chỉ lookup. Nếu
engine chưa có job, ghi cancel tombstone bằng identity/fingerprint cũ để delivery
muộn cũng không execute; không suy đoán rồi POST start. Nếu có job chưa xác định,
giữ unknown. Không hứa exactly-once cho side effect website hoặc power-loss/
backup không nhất quán. Local admin phải kiểm tra external effects khi unknown;
WFI-06 không có nút force-clear hoặc tự bỏ barrier.

## API/event mới, đã implement hai đầu

| Interface | Quyền / nội dung |
| --- | --- |
| `GET /api/devices/:id/workflow/jobs?cursor=&limit=20` | Cookie + membership hiện tại; limit 1–50, opaque UUID cursor ràng buộc device; version/time/jobs/cursor |
| `GET /api/devices/:id/workflow/jobs/:jobId` | Cookie + membership; job phải thuộc device |
| `workflow:v2:report` agent → VPS | protocolVersion/agentInstanceId/current engineInstanceId/observedAt/report; ACK chỉ sau commit |
| `workflow:v2:cancel` browser → VPS | `{deviceId,sessionId,jobId}`; active browser lease, owner/operator |
| `workflow:v2:cancel-job` VPS → adapter | Immutable command identity/grant/fingerprint; chỉ giảm quyền, không execute |
| Engine `POST /api/v2/jobs` | Bearer + active grant/instance/fence, `{jobId,requestId,operation,params}` |
| Engine `GET /api/v2/jobs?cursor=` / `/jobs/:id` | Bearer local, không browser Origin; readonly reconcile, không cần lease còn sống |
| Engine `POST /jobs/:id/cancel` | Bearer, pin device/identity/grant/fence; durable cancellation tombstone |
| Engine `POST /jobs/:id/ack` | Bearer + `{seq}`, chỉ ACK metadata; không cấp execution |

Report: jobId/grantId/fence/originEngineInstanceId/seq/state/runId/progress/
quiescent/reasonCode. Progress chỉ index/total (0–10000), action=null ở phiên bản
này. Không gửi variables, labels, raw errors, path, token, cookies hoặc media.
Outer report ≤16KB, tối đa 40 report/giây/device; batch ≤20, HTTP body giới hạn.
Catalog/health vẫn là API policy-filtered có instance/version/time của WFI-04/05.

UI có mục **Lịch sử jobs trên VPS**, đọc metadata ngay cả khi runner offline,
theo cookie/membership hiện tại; mất VPS ghi rõ dữ liệu chưa cập nhật. Không trả
requestedBy/browserId/fingerprint hoặc payload trong public job projection.
History local và history metadata VPS là hai tập dữ liệu khác nhau.

## Retention và rollback

- VPS metadata terminal + quiescent: 30 ngày; key/fingerprint tombstones: tối
  thiểu 90 ngày. Sau metadata expiry, retry vẫn trả receipt expired/retained,
  không execute. Sau key bị purge 90 ngày, cùng key có thể là ý định mới: client
  không tự retry ngoài retention và nên tạo UUID requestId cho mỗi ý định mới.
- Engine compact history đã ACK sau 30 ngày, giữ receipt/key tối thiểu 90 ngày;
  adapter compact ACKed terminal report sau 30 ngày và giữ key đến 90 ngày.
  Không purge unknown, nonquiescent, unacked hoặc barrier. Cleanup theo chu kỳ;
  khi cap 2000 engine jobs/10000 backend jobs mỗi device hoặc local journal đầy,
  từ chối RETENTION_REQUIRED thay vì xóa unresolved. High watermark fence không
  reset khi prune revoked grants. Legacy local history theo policy riêng.
- `migrateWorkflowJobs(db,{rollback:true})` là API quản trị source/test, không
  public endpoint. Từ chối nếu còn unresolved/nonquiescent; rollback bảng metadata
  vẫn giữ key tombstones, không đụng users/devices/members/leases. Sao lưu offline
  DB + WAL và journal đúng quy trình trước thay version. Engine schema 2 không
  tương thích engine 0.4; không restore backup schema 1 sau các job mới để bỏ guard.
  Không tự thực hiện rollback/deploy trên máy người dùng.

Kết quả kiểm tra và phần chưa nghiệm thu ở [VALIDATION](VALIDATION.md).

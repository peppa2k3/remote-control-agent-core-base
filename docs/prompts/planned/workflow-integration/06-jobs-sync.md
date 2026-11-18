# WFI-06 — Jobs bền vững và đồng bộ local–VPS

Trạng thái: **Completed — triển khai và kiểm thử local ngày 2026-11-18**.
Giữ đường dẫn prompt để tương thích liên kết. Phạm vi, protocol, schema,
retention và rollback: [WORKFLOW_JOBS](../../../WORKFLOW_JOBS.md).
Bằng chứng và giới hạn nghiệm thu: [VALIDATION](../../../VALIDATION.md).
WFI-08 vẫn cần nghiệm thu VPS/WAN, desktop và website đăng nhập thật; kết quả
local không khẳng định exactly-once cho side effect trên website bên ngoài.

Đọc README chung; phụ thuộc WFI-05. Port ý tưởng từ control-server commands/store
và remote-client/executor, không bê auth/ownership hoặc `/device/exchange` vào core.

## Thực hiện

1. Thêm migration SQLite core cho workflow jobs/receipts phù hợp members; mọi API
   query/mutation kiểm tra user/device và quyền tại thời điểm thực hiện. Các trạng
   thái queued/dispatched/running/stopping/terminal/unknown theo ADR, mapping engine
   rõ ràng. Không dùng queue để giữ quyền thực thi qua lease đã hết.
2. Scope idempotency bằng identity/thiết bị và requestId, fingerprint canonical
   của command. Cùng key/cùng body trả job cũ; khác body 409; không chuyển một
   command cũ sang grant mới để chạy lại. Định nghĩa retention khi key đã hết hạn.
3. Ghi journal local bền vững trước side effect, report seq và ACK, retry báo cáo
   bằng backoff. Không lùi terminal state do progress trễ; stop ưu tiên, tombstone
   khi cancel trước delivery. Không tự replay nếu crash giữa start và receipt.
4. Đóng khoảng trống bridge HTTP: journal wrapper đơn thuần quanh POST chưa đủ.
   Engine cần idempotency bền vững/correlation theo ADR hoặc protocol chấp nhận
   trước execute để reconcile được jobId ↔ runId sau restart/lost response.
   Chưa xác định outcome thì unknown; không tự phát requestId mới để chạy lại.
5. Report/catalog/snapshot có version/instance/time/sequence, chống stale reconnect,
   membership-filter, size/rate cap, retention. Sync metadata allowlist, health,
   run progress/history đã sanitize; không gửi token, biến bí mật, absolute path,
   bytes video, Chrome cookies hay raw action errors lên VPS.
6. Chỉ dispatch dưới active grant hợp lệ; disconnect/revoke/expiry/takeover xử lý
   theo WFI-03. Chặn job mới khi run cũ chưa quiescent; concurrency per profile
   và khóa tài nguyên GUI được giữ. Backend restart không phục hồi lease cũ.

## Acceptance

- Test transaction cạnh tranh requestId, delivered-ACK-lost, duplicate/out-of-order
  reports, restart backend/adapter/engine tại các điểm crash và cancel-before-run.
- Cùng key không gây execution mới trong phạm vi retention, unknown không replay;
  history đọc lại được sau reconnect theo quyền hiện tại và không lộ dữ liệu user khác.
- Mất mạng/lease không để queue cũ chạy dưới người nhận takeover mới; stop đúng run.
- Migration có test upgrade/rollback dữ liệu phù hợp; vẫn SQLite một process,
  không thêm Redis/cluster. Test/build và docs/API/schema/retention pass.

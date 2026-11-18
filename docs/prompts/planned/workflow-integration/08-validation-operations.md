# WFI-08 — Nghiệm thu và vận hành

Trạng thái: **Planned — phần tự động local và runbook đã triển khai 2026-11-18**.
E2E toàn tuyến: `npm run test:workflow:e2e`. Kết quả, phạm vi fixture và gate
chưa đạt: [VALIDATION](../../../VALIDATION.md). Cài/nâng cấp/backup/rollback:
[WORKFLOW_OPERATIONS](../../../WORKFLOW_OPERATIONS.md).
Chưa nghiệm thu VPS/WAN và Windows interactive/máy sạch; không đánh dấu completed.

Đọc README chung; phụ thuộc tất cả WFI trước. Coding và test local không tự cho
phép deploy VPS, restart runner thật hoặc cài Windows Scheduled Task.

## Thực hiện

1. Tạo E2E harness tách biệt: backend SQLite temp + local-agent + engine managed
   hoặc attach test + extension thật/profile Chrome test + website fixture.
   Chạy cả flow pairing → local ACK → lease → health → mở profile → run → ACK
   từng bước → history → stop/release. Không fake thành công browser action.
2. Ma trận failure: viewer/foreign browser, expired session/nonce/grant, membership
   revoke, device revoke, owner takeover, mất browser/VPS/runner/engine, restart,
   crash sau journal, duplicate report, stale action ACK và profile contention.
3. Verify data boundary/log redaction, ACL Windows, zero public local ports,
   integrated-mode legacy path disabled. Test không post/upload nội dung thật;
   media/file picker dùng fixture temp và khóa GUI phù hợp.
4. Tài liệu cài local mới, attach dữ liệu cũ, chuyển managed, cài extension thủ
   công, cấp local policy, startup interactive Windows, cập nhật version, restore
   history/journal, rollback package/schema. Không hướng dẫn copy credential
   giữa máy hoặc mở cổng 34719 qua router/proxy.
5. Tài liệu deploy VPS theo pipeline hiện có; chỉ backend/frontend vào app image,
   engine/Chrome/tools/user data ở local. Check health/compatibility và backup DB
   trước rollout; không tự rollout trong prompt này.
6. Viết bảng evidence trong VALIDATION và cập nhật PROGRESS/WORKFLOW/API/env
   examples. Phân biệt pass tự động, pass thủ công thật, blocked và chưa chạy.
   WAN/VPS thật nếu chưa được thực hiện vẫn là tiêu chí chưa xác minh.

## Acceptance

- `npm test`, `npm run build`, suite engine và extension E2E có output/exit status
  thật; tổng hợp failure matrix không lấy source existence làm bằng chứng pass.
- Managed/attach không phá installation khác; revoke/expiry thực sự kết thúc run
  remote, không ACK bước mới sau hủy; unknown không tự replay.
- Runbook cài/upgrade/rollback có thể theo trên máy sạch; không secret/runtime
  artifacts trong diff và package.
- Chỉ đánh dấu completed khi toàn bộ môi trường/acceptance của bước đã đạt;
  chưa test VPS/Windows interactive thì ghi rõ và giữ planned.

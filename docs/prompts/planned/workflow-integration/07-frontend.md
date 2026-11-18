# WFI-07 — Giao diện workflow thống nhất

Trạng thái: **Completed — source và fixture local, 2026-11-18**.
Phạm vi: [WORKFLOW_FRONTEND](../../../WORKFLOW_FRONTEND.md).
Bằng chứng và giới hạn: [VALIDATION](../../../VALIDATION.md).
Không thay thế nghiệm thu VPS/desktop/website thật của WFI-08.

Đọc README chung; phụ thuộc WFI-06. Mở rộng WorkflowPanel hiện tại, không tạo panel
thứ hai hoặc nhúng web control-server có auth riêng.

## Thực hiện

1. Hiển thị riêng kết nối web–VPS, runner online, engine health/version, Chrome
   profile/extension readiness và lease. VPS disconnect đưa snapshot về unknown;
   engine down không biến cả máy thành offline.
2. Catalog chỉ gồm policy cho phép; chọn profile/scenario, mở Chrome, xem biến
   được phép sửa, validation có thông báo rõ, chạy/dừng/theo dõi đúng runId.
   FE không cung cấp trường executable/path/flags/token/steps/API URL.
3. Trạng thái run accepted/running/stopping/terminal/unknown, xác nhận kết quả qua
   receipt, không báo thành công theo HTTP 202. Media confirmation local hướng dẫn
   đúng dashboard local; không mở link 127.0.0.1 trên điện thoại như máy runner.
4. Lưu/recover requestId và jobId theo contract, tra history trước retry mơ hồ.
   Đổi device/lease/logout/unmount hủy pending UI; response cũ không thay state
   mới. Giới hạn poll/subscription, backoff khi offline, không gọi chồng vô hạn.
5. Viewer chỉ thấy metadata đã được server cho phép; owner/operator mất lease
   không có action. Takeover đợi quiescent, hiển thị lý do chờ/dừng chưa xác nhận.
   Quyền server vẫn bắt buộc khi người dùng gọi socket ngoài UI.
6. UI dùng được mobile/keyboard, có nhãn/status/error dễ hiểu; không hiển thị
   implementation details hoặc credential trong luồng sử dụng thường ngày.

## Acceptance

- UI fixture tests gồm happy path, missing extension, engine down, viewer,
  wrong browser, revoke giữa run, stale ACK, reconnect/history và unknown retry.
- Kiểm tra browser desktop/mobile với fixture, không dùng profile đã đăng nhập.
- Poll dừng sau unmount/offline/lease loss, không render dữ liệu thiết bị trước.
- Integration test server chặn thao tác giả ngoài UI; `npm test`/build pass.

# WFI-04 — Supervisor và health của engine local

Đọc README chung; phụ thuộc WFI-03.

## Thực hiện

1. Tạo supervisor module trong `local-agent/src/`; attach là mode hỗ trợ engine
   đang chạy, managed dùng Node executable tin cậy và entrypoint package cố định.
   Cwd tuyệt đối, argv không shell; không nhận path/args/env từ web.
2. Bổ sung readiness/version/capability API theo ADR (API mới, implement engine
   trước). Xác minh auth/version/instance thay vì chỉ kiểm tra port đang mở.
   Capability hiện tại chỉ chứng minh config hợp lệ: phân biệt configured,
   starting, ready, degraded, stopping, failed và reason đã redact.
3. Khởi động managed daemon có startup deadline, backoff/cap restart, xử lý
   EADDRINUSE và hai runner tranh start. Không kill process đang giữ port nếu
   chưa chứng minh ownership; attach engine không tương thích thì báo lỗi.
4. Lọc env process con, tránh truyền device credential hoặc env backend. Token
   local đọc đúng path tin cậy, bảo vệ ACL; không sửa token engine đang chạy.
5. Shutdown managed chỉ process do supervisor sở hữu và đợi cleanup; attach chỉ
   revoke grant do adapter sở hữu, không tắt engine. Engine crash/restart phải
   đổi instance và reconcile run cũ, không tự replay.
6. Báo health vào snapshot đã lọc membership; runner online không đồng nghĩa
   engine ready hoặc interactive Windows session sẵn sàng. Tài liệu hướng dẫn
   attach installation cũ trước khi chuyển managed có chủ đích.

## Acceptance

- Test cold start, attach, occupied port, wrong token/version, concurrent start,
  engine crash, shutdown timeout, restart cap; không có engine thứ hai.
- Token/secret không có trong argv/log/response; Windows ACL và env filter có
  test/kiểm chứng phù hợp, ghi phần cần máy thật.
- Backend/frontend nhận health mới không lộ path/secret; agent offline xóa hoặc
  đánh stale, không giữ ready cũ. Full tests/build pass.

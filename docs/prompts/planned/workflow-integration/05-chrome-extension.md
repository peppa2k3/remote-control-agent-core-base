# WFI-05 — Mở Chrome profile và readiness extension

Trạng thái: **Completed (source + acceptance local, 2026-11-12)**.
Engine 0.4.0 / extension 4.4.0. Operation mới dùng **API v2 có grant** theo
contract hiện tại; dòng v1 bên dưới là yêu cầu lịch sử, không mở bypass v1.
Hướng dẫn: [WORKFLOW_CHROME](../../../WORKFLOW_CHROME.md).
Bằng chứng Chromium unpacked extension thật/profile tạm, quyền, ACK/cancel,
worker reconnect và disable/enable: [VALIDATION](../../../VALIDATION.md).
Chưa deploy VPS, dùng profile đăng nhập hoặc cài startup task thật.

Đọc README chung; phụ thuộc WFI-04. Đọc engine profile helper/main, extension
manifest/background/options/content và file-picker trước sửa.

## Thực hiện

1. Đóng gói extension riêng, hướng dẫn cài/enable và chọn profile tại Options.
   Không coi spawn Chrome là cài extension; không sửa Preferences/Secure
   Preferences hoặc tự chèn extension vào profile người dùng.
2. Thêm operation mở profile theo contract mới, dùng API v1 có auth/policy/grant.
   API cũ `/api/profiles/open` là tham chiếu; không relay API dashboard tùy ý.
   FE chỉ gửi profile ID từ catalog local allowlist; chromePath/userDataDir,
   URL khởi động và flags cố định tại local; spawn argv không shell.
3. Luồng engine ready → open profile → chờ extension heartbeat đúng profile và
   clientId → ready hoặc deadline/missing-extension/wrong-profile/busy. Không
   chạy bước web trước readiness; scenario thuần local giữ khả năng không cần
   extension. Mở lại profile không tạo workflow trùng.
4. Giữ loopback 34719 nhất quán giữa engine và extension; nếu hỗ trợ cấu hình
   port khác phải implement/version hai đầu và test, không chỉ đổi env engine.
5. Xử lý MV3 worker sleep/reconnect, hai client cùng profile, Chrome đã mở,
   đường dẫn có khoảng trắng/Unicode, interactive session khác Windows service.
   Không hứa GUI hoạt động trong Session 0; startup task cần user interactive.
6. Kiểm tra file picker/foreground locking giữa profile; bảo toàn selector legacy,
   ACK bước và cancel. Giữ broad extension permissions ở mức được giải thích,
   không cấp quyền thêm khi chưa cần.

## Acceptance

- Unit/integration test chặn profile/path/flags/URL tùy ý, traversal, unknown key,
  viewer và wrong lease; mở Chrome dùng argv cố định có test.
- E2E extension thật trên profile test riêng: discovery → bind → heartbeat →
  openUrl/click/type trên fixture local → ACK → stop; không post/upload website thật.
- Thiếu/disable extension, wrong profile/client và worker reconnect có trạng thái
  đúng; không ghi nhận ready từ cấu hình hoặc chỉ vì Chrome process tồn tại.
- Không kill Chrome người dùng khi mất lease; chỉ dừng run/quyền do hệ tích hợp sở hữu.
- Test/build pass; nếu môi trường chưa chạy được Chrome thật thì giữ prompt planned.

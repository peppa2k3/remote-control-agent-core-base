# Các prompt chạy tuần tự
Mở repo bằng VS Code/Codex; gọi prompt phù hợp, xem kết quả/test/commit rồi mới tiếp tục. Không dán nhiều prompt cùng lượt.

| Thứ tự | File trong docs/prompts/planned | Mục tiêu |
|---|---|---|
| 001 | 001-core-base.md | Hoàn thiện và xác minh kết nối FE ↔ VPS ↔ local |
| 002 | 002-device-user-management.md | Quản lý nhiều user/máy và vòng đời credential |
| 003 | 003-meshcentral-integration.md | Mesh presence, mapping, remote desktop policy |
| 005 | 005-job-workflow.md | Điều phối jobs, logs, cancel/retry/idempotency |
| 006 | 006-dashboard.md | Dashboard sử dụng hằng ngày |
| 007 | 007-production-cicd.md | Production hardening/backup/CI-CD |
| 008 | 008-natural-language.md | Tạo kế hoạch từ câu nói ở giai đoạn sau |

Câu lệnh gửi AI:
> Đọc AGENTS.md và docs/AI_CONTEXT.md. Thực hiện docs/prompts/planned/001-core-base.md trên source hiện tại. Không khởi tạo lại repo. Kiểm tra code, sửa các thiếu sót, chạy test/build, cập nhật docs/PROGRESS.md; báo rõ phần nào cần môi trường VPS thật.

Thay tên file cho bước tiếp theo. Nếu thiếu domain/IP/key thật, AI hoàn thiện code/env examples/local tests trước và ghi rõ input còn thiếu; không bịa credential hoặc kết quả triển khai. Prompt completed là kết quả của acceptance criteria, không phải tự động khi tạo file.

## Prompt bổ sung

| Trạng thái | File | Mục tiêu |
|---|---|---|
| Completed | [002-device-status.md](prompts/completed/002-device-status.md) | Báo CPU/RAM/network từ Local Runner và hiển thị theo quyền trên dashboard |
| Removed | [003-send-commandline.md](prompts/planned/003-send-commandline.md) | Không dùng trong core theo yêu cầu ngày 2026-11-09 |
| Planned | [004- Remote Terminal – CMD.md](<prompts/planned/004- Remote Terminal – CMD.md>) | Terminal tương tác CMD/PowerShell trên Windows, ràng buộc active lease |

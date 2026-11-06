# 008 — Câu nói → kế hoạch kịch bản
## Mục tiêu
Câu nói → kế hoạch kịch bản trên core hiện có.
## Phạm vi
/backend/planner, /frontend input, local allowlist
## Thực hiện
Thêm text trước, voice STT tùy chọn sau. LLM chỉ parse intent thành JSON scriptId/params/deviceId; validate theo catalog/schema/policy và hiển thị kế hoạch cho user duyệt. Chỉ gửi jobs sau auth/RBAC/lease/local consent; không sinh shell/code chạy trực tiếp. Xử lý ambiguity hỏi lại, prompt injection trong web content không vượt policy. Plan preview và execution tách riêng, cần idempotency, chi phí/timeout config.
## Tiêu chí hoàn tất
LLM output sai/unknown script/domain/file path bị chặn; không execute trước user duyệt; plan không cấp quyền; lease expired phải handshake lại; test prompt injection và intent mơ hồ; không lộ provider secrets FE.
## Kết quả
Source + tests + docs/progress + evidence thực tế; báo rõ limitations.

## Quy tắc chung
Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md và docs/PROGRESS.md. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint hay test result. Không thêm stack nặng nếu chưa cần. Cập nhật env examples/API/docs/test đúng thay đổi; không chạm secrets thật. Chạy npm test + npm run build. Báo changed files, validation và phần chưa kiểm tra; cập nhật tiến độ. Chỉ chuyển prompt vào completed khi mọi tiêu chí hoàn tất và ghi commit nếu được phép commit.

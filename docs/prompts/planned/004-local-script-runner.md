# 004 — Executor cho kịch bản có sẵn
## Mục tiêu
Executor cho kịch bản có sẵn trên core hiện có.
## Phạm vi
/local-agent/scripts, /local-agent/src, /backend protocol
## Thực hiện
Tạo manifest local scriptId/version/params JSON schema và allowlist directories. Hai kịch bản đầu an toàn: system-info và Playwright mở/test một URL domain đã allowlist. VPS chỉ gửi scriptId+params+jobId+leaseId+fencing token+TTL. Local validate active lease hiện tại, session/fence/params, concurrency=1; spawn không shell, không eval/command từ FE; giới hạn timeout/output. Không nhận đường dẫn script từ web. Owner takeover/cancel phải dừng process tree cũ, local xác nhận quiescent trước job mới. Giải quyết Windows interactive desktop khác service session.
## Tiêu chí hoàn tất
Job từ lease cũ/replay/expired bị chặn; script ngoài allowlist, URL/file path ngoài policy bị chặn; timeout/cancel thực sự dừng child/process tree; mất VPS không để quyền cũ chạy vô hạn; audit đầy đủ và test sandbox thực.
## Kết quả
Source + tests + docs/progress + evidence thực tế; báo rõ limitations.

## Quy tắc chung
Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md và docs/PROGRESS.md. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint hay test result. Không thêm stack nặng nếu chưa cần. Cập nhật env examples/API/docs/test đúng thay đổi; không chạm secrets thật. Chạy npm test + npm run build. Báo changed files, validation và phần chưa kiểm tra; cập nhật tiến độ. Chỉ chuyển prompt vào completed khi mọi tiêu chí hoàn tất và ghi commit nếu được phép commit.

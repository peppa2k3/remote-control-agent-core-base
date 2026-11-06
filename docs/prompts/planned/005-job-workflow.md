# 005 — Jobs, queue và lịch sử
## Mục tiêu
Jobs, queue và lịch sử trên core hiện có.
## Phạm vi
/backend/jobs, DB migrations, /local-agent, /frontend
## Thực hiện
State machine queued/dispatching/running/succeeded/failed/cancelled/unknown. Idempotency key, ACK delivery, output bounded/redacted, cursor logs, per-device concurrency=1, retries chỉ cho job safe/idempotent. Mất kết nối giữa execution không đoán job success; unknown rồi reconcile. Không retry tác vụ thay đổi dữ liệu mù. Queue/job bắt buộc lease/fence; scheduler unattended cần explicit policy riêng, không giả user online.
## Tiêu chí hoàn tất
Test reconnect không execute job hai lần; takeover hủy job cũ và chờ local stop; backend crash có recovery đúng; queue không bypass RBAC/lease; history chỉ membership đúng, bounded logs và TTL cleanup.
## Kết quả
Source + tests + docs/progress + evidence thực tế; báo rõ limitations.

## Quy tắc chung
Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md và docs/PROGRESS.md. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint hay test result. Không thêm stack nặng nếu chưa cần. Cập nhật env examples/API/docs/test đúng thay đổi; không chạm secrets thật. Chạy npm test + npm run build. Báo changed files, validation và phần chưa kiểm tra; cập nhật tiến độ. Chỉ chuyển prompt vào completed khi mọi tiêu chí hoàn tất và ghi commit nếu được phép commit.

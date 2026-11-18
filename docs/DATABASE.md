# Data model
| Bảng | Nội dung và ràng buộc |
|---|---|
| users | id UUID, email UNIQUE lowercase, name, scrypt salted password |
| logins | SHA256 session secret, userId, expires 8h |
| devices | id UUID, name, ownerId FK, credentialHash UNIQUE, revoked |
| members | composite PK deviceId/userId; role viewer/operator; owner suy ra devices.ownerId |
| pairs | hash secret PK, ownerId, name, expires 5 phút; consume trong transaction |
| leases | deviceId PK: chỉ một pending/active mỗi máy; id UNIQUE, userId, browserId, nonce, state, expires |
| audit | UUID, at epoch ms, userId, deviceId, event; không secret |

Dữ liệu user/device/member/audit persist; online/presence, status và trạng thái Terminal nằm trong memory. Status được gửi lại khi runner reconnect; trạng thái terminal không được phục hồi sau disconnect/restart. Audit Terminal chỉ lưu event metadata, không lưu command/output. Hiện lastSeen chỉ có trong memory, về null khi mất socket; Step quản lý device sau này mới bổ sung lastSeen persistent, hostname/OS thông tin tối thiểu và migration versioned. Lease cũ xóa khi boot để fail closed.

Không hỗ trợ owner transfer hoặc xóa user ở core; thêm migration/API riêng nếu cần. Không thêm MongoDB 4.0 chỉ để giữ stack cũ: SQLite phù hợp quy mô starter, PostgreSQL là hướng scale.
## Migration WFI-06 — durable workflow jobs

Migration 1 trong workflow_migrations thêm workflow_jobs, workflow_receipts và
workflow_job_keys. Không thay core users/devices/members hoặc auth; SQLite một
backend process, transaction BEGIN IMMEDIATE và synchronous FULL.

| Bảng | Nội dung |
| --- | --- |
| workflow_jobs | jobId PK, deviceId/user FK, browser/session/requestId, operation/fingerprint, immutable grant/fence/origin engine, state/runId/seq/quiescent/reason/progress, timestamps/deadline/cancelled |
| workflow_job_keys | unique deviceId/requestedBy/requestId, jobId/fingerprint/expiry; không body, giữ tối thiểu 90 ngày |
| workflow_receipts | jobId PK/FK cascade, seq/digest/receivedAt; ACK sau commit |
| workflow_migrations | version PK, appliedAt; migration idempotent |

Metadata terminal quiescent 30 ngày; unresolved/unacked không auto purge. Queued
không khôi phục sau restart; dispatched/running/stopping chuyển unknown, lease
cũ vẫn bị xóa. Không lưu raw params/vars/path/error hoặc media trên VPS.
Rollback migration bị chặn khi còn unresolved; rollback metadata giữ key
tombstones và core records. Chỉ dùng trong quy trình quản trị có backup/review.

Adapter có workflow-journal.sqlite cạnh CREDENTIALS_PATH; engine journal schema 2
trong workflow-grants.json có correlation trước execute và backup schema 1.
Chi tiết schema wire, migration/retention/rollback: [WORKFLOW_JOBS](WORKFLOW_JOBS.md).

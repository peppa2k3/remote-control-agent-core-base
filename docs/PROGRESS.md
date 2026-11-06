# Tiến độ
| Bước | Trạng thái | Kết quả |
|---|---|---|
| 001 Core | Source và test loopback đạt trên Windows Node 24; cần nghiệm thu VPS/local thật | Auth, pairing, realtime runner, RBAC, lease, ACK, owner takeover; sửa test runner Windows và trạng thái FE khi mất VPS |
| 002 Quản lý user/device | Planned | Invite, MFA, rotation, lastSeen persistent, migrations |
| 003 MeshCentral adapter | Planned | Mapping, realtime Mesh presence, enforce remote desktop lease |
| 004 Script runner | Planned | Allowlist, params schema, safe execution/cancel/fencing |
| 005 Jobs/queue/history | Planned | Retry/idempotency/logs/concurrency=1 |
| 006 Dashboard | Planned | Management/history/notifications/mobile/theme |
| 007 Production/CI/CD | Planned | Hardening, deploy pipeline, backups, rollback |
| 008 Natural language | Planned | Input → validated plan → confirmation → allowed jobs |

Không chuyển prompt 001 sang completed chỉ vì source tồn tại: cần đạt toàn bộ tiêu chí trên VPS thật, Windows/Linux target và cơ chế unattended mong muốn. Các bước tiếp theo không đồng nghĩa đã implement.

2026-10-15: Đã cài CodeGraph v1.6.2 trên máy phát triển, lập chỉ mục source và cấu hình Codex cho repo. Tối ưu truy vấn snapshot presence theo user; chưa nghiệm thu VPS/local thật.

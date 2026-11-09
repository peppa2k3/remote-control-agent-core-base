# Tiến độ
| Bước | Trạng thái | Kết quả |
|---|---|---|
| 001 Core | Source và test loopback đạt trên Windows Node 24; cần nghiệm thu VPS/local thật | Auth, pairing, realtime runner, RBAC, lease, ACK, owner takeover; sửa test runner Windows và trạng thái FE khi mất VPS |
| Device status (`002-device-status`) | Source + unit/integration tests + build; chưa nghiệm thu trên máy nhà thật | Runner gửi CPU/RAM/network theo chu kỳ cấu hình, backend kiểm tra/giới hạn, dashboard hiển thị cho user có quyền; status chỉ trong memory |
| Script options (`003-send-commandline`) | Removed from core per request 2026-11-09 | Dashboard, protocol, Local Runner executor, manifest mẫu và tests cho phép chạy script local đã được gỡ. |
| Remote Terminal (`004- Remote Terminal – CMD`) | Source + realtime tests + Windows PTY test; cần review browser và VPS/máy nhà thật | Windows CMD/PowerShell qua node-pty, xterm.js, một terminal/device, lease-bound input/output, cleanup và audit metadata. Commands/output không lưu. |
| 002 Quản lý user/device | Planned | Invite, MFA, rotation, lastSeen persistent, migrations |
| 003 MeshCentral adapter | Planned | Mapping, realtime Mesh presence, enforce remote desktop lease |
| 004 Script runner nâng cao | Removed from core | Không mở rộng tính năng chạy script local đã được loại khỏi core theo yêu cầu ngày 2026-11-09. |
| 005 Jobs/queue/history | Planned | Retry/idempotency/logs/concurrency=1 |
| 006 Dashboard | Planned | Management/history/notifications/mobile/theme |
| 007 Production/CI/CD | Partial | CI kiểm tra/test/build; GitHub Actions build một image GHCR theo commit SHA, deploy qua SSH, kiểm tra health HTTPS và rollback image. Còn nghiệm thu VPS thật, backup/restore và hardening production. |
| 008 Natural language | Planned | Input → validated plan → confirmation → allowed jobs |

Không chuyển prompt 001 sang completed chỉ vì source tồn tại: cần đạt toàn bộ tiêu chí trên VPS thật, Windows/Linux target và cơ chế unattended mong muốn. Các bước tiếp theo không đồng nghĩa đã implement.

2026-10-15: Đã cài CodeGraph v1.6.2 trên máy phát triển, lập chỉ mục source và cấu hình Codex cho repo. Tối ưu truy vấn snapshot presence theo user; chưa nghiệm thu VPS/local thật.

2026-11-06: Bổ sung CI/CD starter trong `.github/workflows`, Compose production một app dùng SQLite volume và script deploy có health verification/rollback. Chưa chạy trên VPS thật; hướng dẫn secrets tại `docs/CICD_DEPLOY.md`.

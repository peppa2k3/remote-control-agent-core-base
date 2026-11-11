# Tiến độ

2026-11-11: Thiết lập CodeGraph cho repo. Máy đã có npm global v1.6.2 (trùng
latest npm khi kiểm tra); cấu hình Codex MCP global và khởi tạo `.codegraph/`.
Thêm `codegraph.json` loại secrets/runtime/ref/bản sao agent; telemetry giữ
disabled. Index 24 files, 328 nodes, 1.061 edges; status up-to-date và explore
thành công. MCP stdio initialize/tools-list pass, có codegraph_explore; cần
restart Codex/IDE để nạp cấu hình vào session mới. `npm test` exit 0 (5 backend,
13 local-agent), `npm run build` exit 0. Hướng dẫn tại [CODEGRAPH](CODEGRAPH.md).
Không thay runtime app, `.env` hoặc deploy VPS.

2026-11-11: Khảo sát source `ref/local_workflow_agent-dev-remote/` và workflow
bridge hiện có; thêm [kế hoạch tích hợp](WORKFLOW_INTEGRATION_PLAN.md) và bộ
[8 prompt WFI](prompts/planned/workflow-integration/README.md). Đề xuất giữ
pairing/RBAC/lease Socket.IO core, engine local riêng, policy/grant/watchdog,
supervisor, Chrome profile/extension readiness và journal/jobs đồng bộ; không
chạy control-server HTTP như đường điều khiển thứ hai ở integrated mode.
Đây chỉ là tài liệu chuẩn bị, toàn bộ WFI còn planned; chưa đổi runtime/env,
chưa deploy hoặc khởi động engine/Chrome. Baseline thực chạy: `npm test` exit 0
(backend 5/5, local-agent 13/13, gồm Windows PTY); `npm run build` exit 0.
Chưa chạy test repo ref, Chrome extension E2E, MongoDB/video hoặc WAN/VPS.

2026-11-11: Rà soát và củng cố workflow bridge. Runner hủy HTTP đang chờ ngay
khi lease local hết hạn (không chờ revoke từ VPS), thay session, revoke,
disconnect hoặc shutdown; gia hạn cùng session giữ request hợp lệ, kết quả tới
muộn sau hủy bị chặn. Params 12KB được kiểm tra thêm tại runner. CLI in
requestId ra stderr trước POST run để giữ key khi mất response. Bổ sung test
expiry/gia hạn/hủy/late response/giới hạn params/CLI retry key và kiểm tra lease
hết hạn tại backend. `npm test`: backend 5/5 và local-agent 13/13 đạt;
`npm run build` đạt. Chi tiết ở [VALIDATION.md](VALIDATION.md). Chưa triển khai
VPS, restart runner hay chạy scenario thật; không thay `.env`, credentials,
source runner bản sao hoặc trạng thái completed của prompt.

2026-11-10: Bổ sung workflow engine bridge qua HTTP loopback và Socket.IO active
lease. Backend kiểm tra RBAC/user/browser/device/session, local kiểm tra lease,
frontend có panel catalog/profile/biến/run/status/history/stop. Generic script
runner cũ không được khôi phục. `npm test` repo và local-agent đạt, frontend
`npm run build` đạt; UI fixture Chrome desktop/mobile chạy login → lease →
catalog → biến → run → stop không lỗi runtime. Repo workflow riêng có test engine
thật với scenario wait tách biệt; engine người dùng chỉ được đọc metadata.
Source bản `local-agent copy` cũng đã cập nhật tại máy phát triển. `.env` và
credentials không đổi; chưa deploy VPS hoặc restart runner đang chạy. Cấu hình
cho runner ngoài repo workflow ở [WORKFLOW.md](WORKFLOW.md).
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

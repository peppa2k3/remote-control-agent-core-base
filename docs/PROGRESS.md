# Tiến độ

2026-11-12: Hoàn thành WFI-03 policy/grant subset. Engine 0.2.0 integrated mode
deny-by-default theo local policy/hash/schema/realpath, grant/seq/fencing và
monotonic watchdog; standalone v1 giữ riêng. Backend workflow_control lưu fence
và barrier bền vững, runner protocol 2 relay; panel cũ route v2 theo capability.
Revoke/expiry dừng cả HTTP pending và accepted run khi mất response, takeover
chờ proof quiescent. Extension 4.3.0 có settlement receipt/content idle probe;
lỗi port/parent chết không giả settled, ACK trễ không advance. Local dashboard
run giữ độc lập; không claim sandbox/desktop độc quyền đối với quyền OS/terminal.
`npm test` exit 0: backend 7/7, runner 13/13, engine 25/25; browser fixtures 3/3,
build đạt. Windows child+grandchild cancellation, parser, standalone integrated
install/run/revoke và syntax checks đạt. Test executable runner được cô lập bằng
source-only temp copy để không đọc cấu hình checkout. Không sửa env thật/ref,
restart installation hoặc deploy. Chưa full extension worker E2E/WAN/VPS/Linux
tree/startup; unknown/barrier recovery, supervisor/openProfile/jobs/report/retention
còn các bước sau. Xem [WORKFLOW_GRANTS](WORKFLOW_GRANTS.md).

2026-11-11: Hoàn thành WFI-02 package/source. Nhập engine CommonJS workspace
`local-agent/workflow-engine/`, extension MV3 4.2.2 riêng, root lock pin MongoDB
7.7.0 runtime/Playwright 1.64.0 dev; provenance 58 file nguồn. Bootstrap không
tạo HTTP polling client cũ/đọc remote.json, mutation cũ trả 410. Thêm exporter
standalone allowlist + lock runtime và tests engine API thật/core adapter,
legacy paths/migration temp/ZIP. Root test suites đạt backend 5, runner 13,
engine 17; 2 browser content/media fixture tests và build đạt. npm ci ở workspace
temp sạch cùng lock và standalone runtime install/run đạt. Checkout npm ci gặp
EPERM do native Rolldown bị giữ; npm install đã khôi phục dependency, không dừng
tiến trình người dùng. Docker build chưa chạy vì daemon không hoạt động.
Chưa triển khai grant v2/supervisor/jobs/extension E2E/VPS; không thay .env thật,
credentials, ref hoặc installation đang chạy. Xem [WORKFLOW](WORKFLOW.md) và
[VALIDATION](VALIDATION.md). WFI-03–08 còn planned.

2026-11-11: Hoàn thành thiết kế WFI-01 theo prompt contract/layout: thêm
[ADR-001](adr/001-workflow-integration.md), [contract v2](WORKFLOW_INTEGRATION_CONTRACT.md),
[inventory import/test](WORKFLOW_IMPORT_INVENTORY.md) và manifest SHA-256 29 file
nguồn chọn lọc. Chốt package engine CommonJS/workspace, extension riêng, local
policy/grant/fencing/quiescence, job/report retention, migration/rollback và
failure matrix. Ref không có upstream commit/license được xác minh; không lấy
HEAD core làm provenance. Phát hiện test layout ref có nhánh recursive copy chưa
lọc đủ runtime, cần port an toàn trước chạy. `npm test` exit 0: backend 5/5,
local-agent 13/13 (Windows PTY Node v24.16.0); `npm run build` exit 0. WFI-01
completed chỉ phần tài liệu; WFI-02–08 planned, chưa copy/đổi runtime, chưa chạy
engine/extension/ref suite hoặc VPS. Không sửa `.env`, không commit/deploy.

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
## 2026-11-12 — WFI-04 supervisor và health

Đã tích hợp daemon logic từ source tham chiếu vào supervisor của Local Runner:
attach mặc định, managed opt-in với Node/entrypoint/cwd cố định, env allowlist,
private token file ACL, IPC ownership, startup deadline/backoff/restart cap.
Engine 0.3.0 thêm lifecycleVersion=1, khóa data directory và graceful drain;
crash giữ unknown, đổi instance và không replay. Backend/frontend nhận health
đã lọc membership, stale độc lập heartbeat; refresh healthy không revoke grant.

Acceptance local Windows đã có test process thật, concurrent controller/data
lock, crash đang chạy, wrong auth/version, timeout/cap và NTFS ACL thật. Full
test/build và Chrome fixture được ghi tại [VALIDATION](VALIDATION.md).
Hướng dẫn [attach → managed](WORKFLOW_SUPERVISOR.md). Không sửa env thật, deploy
VPS, cài task hoặc restart engine/runner người dùng. WFI-05–08 còn planned.
## 2026-11-12 — WFI-05 Chrome profile/extension

Engine 0.4.0 + extension 4.4.0: openProfile v2 theo active lease/grant/policy,
fixed argv/local paths/env filter; bind client/worker/nonce, heartbeat expiry,
Options profile discovery + port loopback. Không cài extension tự động. Integrated
browser workflow/picker giữ foreground đến quiescence; revoke không kill Chrome.
Sửa debugger ownership khi target đã attached bởi DevTools; không coi attached
là quyền của extension. Source từ ref giữ selector/ACK/cancel và không sửa ref.

Real unpacked MV3 E2E trên Chromium/profile Unicode tạm: Options → bind →
openUrl/type/click qua debugger → ACK, stop active action → settled, worker
stop/reconnect và disable/enable. Full tests/build/Chrome UI được ghi tại
[VALIDATION](VALIDATION.md). Hướng dẫn [WORKFLOW_CHROME](WORKFLOW_CHROME.md).
Không thay env/profile thật, cài task, restart installation hoặc deploy VPS.
WFI-06–08 còn planned tại thời điểm WFI-05; chưa nghiệm thu Session 0/desktop login/website thật trên target.

## 2026-11-18 — WFI-06 jobs/sync

Đã triển khai intent/receipts SQLite VPS, journal adapter và correlation engine
0.5.0 trước side effect. Retry giữ requestId, fingerprint và grant gốc; restart
chỉ reconcile, không phục hồi lease hoặc replay. Cancel ưu tiên có tombstone;
unknown giữ quiescence barrier. History metadata đọc theo membership hiện tại,
retention metadata 30 ngày/key 90 ngày. Xem [WORKFLOW_JOBS](WORKFLOW_JOBS.md)
và [VALIDATION](VALIDATION.md). WFI-07–08 còn planned; chưa nghiệm thu VPS/WAN,
desktop/website đăng nhập thật. Không thay env/credentials/profile hoặc installation
người dùng; thư mục local-agent copy không thuộc thay đổi WFI-06.

## 2026-11-18 — WFI-07 frontend

Đã thống nhất WorkflowPanel: trạng thái kết nối riêng, schema biến theo policy,
requestId/jobId recovery qua lookup riêng user/device, receipt không đồng nghĩa
thành công, history phân trang, cancel UI và polling theo scope/lease. Fixture
Chromium desktop 1280px/mobile 390px kiểm tra validation, run/stop, missing
extension, viewer/wrong browser, revoke/stale ACK, reload/history/unknown và
keyboard/overflow. Xem [WORKFLOW_FRONTEND](WORKFLOW_FRONTEND.md),
[VALIDATION](VALIDATION.md). WFI-08 còn planned. Không deploy hoặc sửa env thật.

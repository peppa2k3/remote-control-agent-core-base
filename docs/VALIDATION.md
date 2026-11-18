# Validation — 2026-10-14 (Asia/Saigon)

## Workflow bridge — rà soát 2026-11-11 (Asia/Bangkok)
- `npm test`: backend 5/5 và Local Runner 13/13 đạt trên Windows 10.0.19045, Node v24.16.0. `npm run build` đạt (Vite 8.3.4, 54 modules).
- Test Socket.IO + HTTP loopback xác nhận browser khác/viewer bị chặn, request run giữ idempotency header, shell/uploadPath bị chặn, revoke không trả data đang chờ và lease hết hạn không gọi engine. Sau điều chỉnh test expiry, chạy riêng `node --test backend/test/workflow.test.js` đạt.
- Test đồng hồ giả xác nhận HTTP pending bị abort tại expiry local khi không có VPS revoke; gia hạn cùng session vượt deadline cũ không bị hủy và request hoàn tất được dọn timer.
- Test hủy do thay session/revoke/disconnect/shutdown xác nhận AbortSignal bị hủy và response đến muộn không được relay, kể cả client giả lập bỏ qua abort. Params quá 12KB bị chặn trước khi gọi HTTP client.
- Test CLI mô phỏng mất response sau khi engine nhận run: requestId đã được xuất trước request, thử lại với `--request-id` giữ nguyên key và body. Đây là kiểm tra key phía bridge, không chứng minh cơ chế deduplicate của engine thật.
- Các kiểm tra engine dùng HTTP fixture; chưa chạy scenario/Chrome extension thật, UI browser mới, VPS/domain hay kết nối Internet. Không deploy, restart runner, sửa secret hoặc cập nhật source trong `local-agent copy`. Workflow đã được engine nhận có thể tiếp tục sau mất lease; abort HTTP không phải rollback/stop workflow.

## Remote Terminal CMD/PowerShell — 2026-11-08 (Asia/Bangkok)
- `npm test`: backend 4/4 pass; Local Runner 11/11 pass.
- Windows PTY integration chạy trên Windows 10.0.19045, Node v24.16.0. Đã mở CMD/PowerShell, chạy `hostname`, `ipconfig`, `ping -t 127.0.0.1`, gửi Ctrl+C và xác nhận `ping.exe` không còn sau khi đóng terminal.
- Backend realtime test xác nhận viewer bị chặn, terminal bind vào đúng user/browser/device/session lease, chỉ browser mở nhận output, một terminal mỗi máy, giới hạn input/output và dừng terminal khi lease release. Audit chỉ có sự kiện metadata.
- `npm run build`: Vite 8.3.4 thành công; xterm tải tách riêng khi người dùng mở Remote Terminal, initial JS 277KiB.
- Chưa kiểm tra giao diện qua browser/VPS/domain, clipboard trong browser HTTPS thật, Windows Server/Windows build khác, hoặc runner đăng nhập bằng tài khoản không phải Administrator. Prompt 004 còn Planned tới khi hoàn tất các kiểm tra máy thật này.

## Loại bỏ script allowlist — 2026-11-09 (Asia/Bangkok)
- Đã gỡ màn hình “Kịch bản trên máy”, protocol script, executor Local Runner, manifest và cấu hình `SCRIPTS_PATH`.
- Remote Terminal/PTY vẫn được giữ; các test backend và Windows PTY vẫn chạy trong bộ kiểm tra.
- `npm test`: backend 4/4 pass; Local Runner 7/7 pass. Integration test xác nhận runner khởi động không cần cấu hình script và snapshot không có catalog `scripts`.
- `npm run build`: Vite 8.3.4 thành công, 52 modules.

## Device status — 2026-11-07 (Asia/Bangkok)
- `npm test`: backend 3/3 pass; Local Runner status 4/4 pass. Integration test chạy Local Runner thật trên Windows Node 24.16.0, nhận CPU/RAM/network status qua Socket.IO và `Get-NetAdapterStatistics`, đồng thời xác nhận status biến mất khi runner disconnect.
- Backend realtime test xác nhận status chỉ hiển thị với owner/operator có quyền; outsider không thấy máy, schema sai và report dày hơn 1/giây bị từ chối.
- `npm run build`: Vite 8.3.4 thành công (44 modules).
- Linux `/proc/net/dev` parser và bộ tính sample được kiểm tra bằng fixture; chưa chạy Local Runner trên máy Linux thật. Chưa nghiệm thu dashboard qua VPS/domain hoặc máy nhà thật; status hiện chỉ trong memory backend và mất sau restart.

## Kiểm tra bổ sung 2026-10-15 (Asia/Bangkok)
- Windows, Node v24.16.0: `npm ci` thành công, 0 vulnerabilities theo npm audit trong quá trình cài.
- `npm test`: 3/3 pass. Sửa đường dẫn khi spawn Local Runner bằng `fileURLToPath` và dọn tiến trình con theo `signalCode` trên Windows.
- `npm run build`: Vite 8.3.4 build thành công (44 modules).
- UI hiển thị trạng thái máy là chưa xác định khi browser mất kết nối realtime VPS.
- Chưa có VPS/domain/máy local thật để nghiệm thu đường truyền Internet, stop mạng, hoặc service reboot. Step 001 vẫn chưa completed.

## CodeGraph và tối ưu snapshot — 2026-10-15
- Cài `@colbymchenry/codegraph` v1.6.2 tại `D:\CODE_DND\codegraph-tools` vì ổ C hết dung lượng; thêm thư mục này vào User PATH. Tắt telemetry. `codegraph init --yes` lập chỉ mục 8 file, 108 nodes, 368 edges; `codegraph status` báo index cập nhật.
- Cấu hình MCP Codex ở `.codex/config.toml`; cần mở lại Codex và trust project để nạp MCP. Chưa xác minh MCP trong phiên Codex hiện tại; CLI `codegraph explore` đã chạy được.
- Snapshot thiết bị dùng một truy vấn SQL JOIN cho mỗi user thay vì truy vấn thêm role và lease cho từng máy. Broadcast tái sử dụng snapshot giữa các tab của cùng user. Điều này giảm số truy vấn khi nhiều máy/tab; chưa đo benchmark tải thực tế.
- Sau thay đổi: `npm test` 3/3 pass và `npm run build` pass trên Windows Node 24.16.0.
Runtime kiểm tra: Linux, Node v24.19.0, npm 11.9.0.

## Đã chạy và đạt
- npm install: lockfile tạo đủ các workspaces; dependencies pin version.
- npm test: 3 test cases tổng hợp đều PASS.
  1. Store/transaction: mã pairing dùng một lần và hết hạn, user không quyền, viewer bị chặn, pending không renew, sai nonce/cross-device/replay ACK bị chặn, khóa độc quyền, owner takeover, lease expiry.
  2. HTTP + Socket.IO trên loopback: đăng nhập/cookie, Origin sai bị chặn, enrollment, membership privacy, handshake active, conflict, takeover/revoke, stale renew bị chặn, runner offline, credential sai và device revoke, audit.
  3. Khởi động chính executable Local Runner với credential đã enroll: outbound connect, heartbeat online, auto-approve offer từ server, lease active, SIGTERM làm revoke.
- npm run build: Vite 8.3.4 build thành công (44 modules).
- npm audit --json: 0 vulnerabilities trong workspace dependencies tại thời điểm chạy. Không bao gồm MeshCentral cài trong Dockerfile riêng.
- node --check: backend server và local runner hợp lệ cú pháp.

## Chưa kiểm tra
- Không có Docker binary ở môi trường này: chưa build image, chưa chạy compose/Traefik/MeshCentral thật.
- Chưa có VPS/domain/key của người dùng: không deploy hay kiểm tra nhà ↔ VPS qua Internet.
- Chưa chạy Windows Task Scheduler/Linux systemd thật, interactive console pairing thực hoặc UI browser visual QA.
- MeshCentral adapter, script executor, jobs và desktop lease enforcement chưa implement; không có test giả cho các phần đó.

## Checklist nghiệm thu Step 001 trên máy thật
1. npm ci trên máy sạch Node 24, seed owner, khởi chạy FE/BE.
2. Login đúng/sai, tạo pairing, local gõ YES, thử replay/expired code.
3. Chạy trên HTTPS VPS và máy nhà: socket online, tắt runner/mạng → offline ≤27s khi mất heartbeat; stop process có thể nhanh hơn.
4. Tạo operator/viewer và browser profiles khác nhau; thử xin quyền đồng thời.
5. User local xác nhận → active; không xác nhận → timeout 20s. Với unattended test AUTO_APPROVE_SESSIONS=true riêng.
6. Owner force takeover: browser cũ bị revoke, ACK/renew session cũ bị chặn; owner qua handshake mới.
7. Logout/revoke member/device/offline/restart VPS đều hủy lease; reconnect nhận snapshot mới, không revive session cũ.
8. Test riêng MeshCentral install/reconnect/reboot; FE hiện not_integrated cho Mesh đến Step 003.
# WFI-02 — package/source, 2026-11-11

- Root `npm test`: backend 5/5, local-agent 13/13, engine 17/17; engine tests dùng
  temp env/data/scenarios/profile, bao gồm auth Host/Origin/token, run/stop/history
  sau restart, idempotency v1, core adapter thật và legacy HTTP disabled.
- Windows ZIP test: đúng 5 runtime entries. Migration fixture: port guard,
  collision trước move và giữ machine identity. Không chạy migration người dùng.
- `npm run test:browser -w @rca/workflow-engine`: 2/2 content/media UI tests bằng
  Chrome headless contexts riêng; MongoDB memory fixture, không website thật.
- `npm run build`: frontend build exit 0. `node --check`: 45 file JS mới/import;
  PowerShell parser: scripts/extension/file-picker syntax đạt.
- Fresh workspace manifests + root lock trong temp: `npm ci` exit 0 (133 packages).
  Standalone exporter trong temp + `npm ci --omit=dev --ignore-scripts`: exit 0
  (12 runtime packages), chạy engine độc lập và workflow wait đến succeeded đạt.
  Không dùng ref/node_modules checkout để chạy artifact standalone.
- Checkout `npm ci` từng lỗi EPERM ở native Rolldown đang được giữ. `npm install
  --ignore-scripts` khôi phục exit 0 (có cleanup warning file bị giữ); test/build
  sau đó đạt. Không kill process người dùng hoặc xóa cưỡng bức native binding.
- Docker daemon không chạy nên chưa build image; Dockerfile chỉ thêm workspace
  manifest, final image vẫn backend/frontend. Chưa chạy extension execution E2E,
  real MongoDB/video, startup service, WAN/VPS hoặc chứng minh grant v2 enforcement.
# WFI-03 — policy/grants, 2026-11-12

- `npm test`: backend 7/7, local-agent 13/13, engine 25/25, không skip trên Windows.
  Backend/Socket.IO/engine thật: viewer/cùng user browser khác, allowlist/biến,
  hidden defaults, retry key, lost POST response, lease renew/expiry trước sweep,
  takeover barrier chờ web receipt, membership/device revoke, browser/agent
  disconnect/reconnect, backend restart giữ fence/barrier nhưng bỏ lease.
- Engine tests: token/Origin/v1 bypass, deny-by-default/hash/alias override,
  symlink escape, strict JSON duplicate/prototype keys, grant replay/revoke-before-
  grant/restart, late ACK sai client/không settled không nhả barrier, local run
  độc lập, renewal qua deadline cũ và clock rollback bằng fake monotonic unit test.
- Process thật: abort Node child và Windows parent+grandchild, chờ taskkill/close;
  secret env không truyền xuống child. Parent fail bất thường giữ cleanup unknown.
- `npm run test:browser -w @rca/workflow-engine`: 3/3 bằng Chrome test contexts,
  gồm content script thật báo busy cho đến khi cancellation hoàn tất. Worker
  settlement transport/input proof được test VM; chưa full worker/CDP/engine E2E.
- `npm run build`: exit 0. `node --check`: 59 files source/test liên quan đạt.
- Standalone 0.2.0 export + fresh runtime `npm ci --omit=dev --ignore-scripts`
  exit 0; integrated auth/policy/grant/run/confirmed revoke thực đạt ở temp độc lập.
- Chưa deploy/restart installation thật, real MongoDB/download/FFmpeg, VPS/WAN,
  full extension worker/profile người dùng, Linux tree E2E hoặc startup. Bản này
  giữ unknown/barrier khi thiếu proof, không tự recovery hoặc replay. Không có
  openProfile/GET jobs/report seq/queue/retention 30/90 ngày toàn tuyến.
## WFI-04 — 2026-11-12, Windows 10.0.19045 / Node 24.16.0

- `npm test`: exit 0, **52/52** (backend 8, Local Runner 19, engine 25).
- `npm run build`: exit 0. `node --check`: 14 changed/new JavaScript files, exit 0.
- `npm run test:browser -w @rca/workflow-engine`: exit 0, **3/3**, Chrome contexts
  riêng, giữ các ca content/catalog/cancellation của source đã nhập.
- `node --test backend/test/browser/workflow-health.test.js`: exit 0, **1/1**,
  dashboard dist thật + core/Socket.IO + agent fixture: starting/ready/failed/
  offline, controls không có lease bị khóa, không hiện path/token, không pageerror.
- `node --test local-agent/test/workflow-supervisor.test.js`: exit 0, **6/6**,
  process engine thật, fixed argv/cwd/env; managed cold start/owned IPC shutdown;
  concurrent controller theo URL canonical; engine khác port nhưng chung data bị
  chặn trước khi ghi runtime; attach không kill engine; occupied port không spawn;
  wrong token/version/protocol không ready; deadline/cap/timeout có fault child
  thật không trả lời IPC. Không dùng timer giả để khẳng định process đã exit.
- NTFS thật: fixture env bỏ inheritance, current-user-only được chấp nhận; cấp
  Everyone Read bị Get-Acl kiểm tra SID từ chối, không spawn. Env filter không
  truyền device/backend credential/NODE_OPTIONS; token không có trong argv/snapshot.
- Crash giữa lượt wait được engine chấp nhận: supervisor spawn instance mới,
  journal giữ đúng một run unknown, grant cũ revoked, không replay và không báo
  cleanup thành công. Deadline dùng monotonic clock, timeout HTTP làm tròn ms.
- Backend integration thật + supervisor attach + engine: heartbeat health cùng
  instance không revoke grant, RBAC/lease/takeover/revoke vẫn qua. Health bỏ nested
  path/token, chỉ member thấy, timestamp do server nhận; runner vẫn heartbeat
  nhưng health quá 15 giây chuyển STALE, offline trả null.

Toàn bộ dùng temp runtime và token fixture; không đọc/sửa env/credentials/profile
người dùng, không cài startup task, restart installation thật hoặc deploy VPS.
Chưa nghiệm thu VPS/network thật, unattended Windows interactive session, profile
đăng nhập/extension thực hiện website side effect, hoặc parent crash khi external
Chrome đang thực hiện input. Các trường hợp đó tiếp tục cần WFI-05–08; engine
health ready không chứng minh các điều kiện đó. ACL test chỉ chứng minh file
fixture; người vận hành vẫn phải bảo vệ thư mục cài đặt/runtime tại máy đích.
## WFI-05 — 2026-11-12, Windows / Node 24.16.0

- `npm test`: exit 0, **58/58**: backend 8, Local Runner 19, engine 31.
- `npm run build`: exit 0. 15 changed/new JavaScript files checked with `node --check`, exit 0.
- `npm run test:browser -w @rca/workflow-engine`: **4/4**, gồm unpacked MV3
  extension 4.4.0 thật, Chromium Playwright bundled + persistent temp profile
  có path Unicode/khoảng trắng, engine 0.4.0 và HTTPS fixture loopback.
- E2E Options chọn port random thật → discovery → bind/heartbeat Default;
  Profile 1 không bind không ready; mở lại Default đã mở không tạo run; extension
  thực hiện openUrl/type/click bằng content script + chrome.debugger, ACK settled.
  Stop khi waitFor đang active: nhận cancellation receipt/quiescent. Stop worker
  bằng CDP, hết heartbeat mất ready, wake/bind lại; disable/enable extension thật
  qua chrome://extensions cũng mất/khôi phục ready. Revoke grant không kill Chrome.
- `node --test backend/test/browser/workflow-health.test.js`: **1/1**, dashboard
  dist + backend/Socket.IO: chưa lease khóa nút, xin lease → tải catalog → mở Chrome
  profile → starting/ready qua poll, lỗi health/offline và không lộ path/token.
- Unit/integration: allowOpen và grant bắt buộc, viewer/wrong browser lease bị
  chặn; traversal/unknown profile/extra URL/path/flags/env bị từ chối. Fixed argv,
  cwd/env/Unicode, launch deadline, hai opens đồng thời không spawn trùng; wrong
  client/nonce và worker khác không thay binding fresh/busy. Foreground lock giữ
  qua cancellation đến matching late ACK, chặn profile khác/native/selector picker.
- Debugger regression test: target attached bởi CDP khác vẫn phải attach/prove
  session của extension; ownership proof thất bại không gửi input. Giữ selector,
  file picker/cancel, content/media/pipeline suites và ZIP allowlist 5 runtime files.

Tất cả dùng runtime/token/cert/profile tạm. Không sửa ref, env/Preferences/Secure
Preferences/profile người dùng; không cài task, post/upload website thật hoặc
deploy VPS. Chưa nghiệm thu GUI unattended/locked desktop/Session 0 trên máy nhà,
Chrome stable do người dùng cài, website đăng nhập và WAN/VPS thật. Test sideload
dùng Chromium theo hướng dẫn chính thức Playwright; flags TLS/host mapping/extension
chỉ ở fixture, không đi vào production spawn. Hướng dẫn tại
[WORKFLOW_CHROME](WORKFLOW_CHROME.md).

WFI-05 readiness regression: bind alone does not mark ready; a nonce-echo heartbeat is required. Matching cleanup receipts remain admissible after local policy removes a profile, without refreshing readiness or admitting new work. Wrong nonce/client remains rejected.

## WFI-06 — 2026-11-18, Windows 10.0.19045 / Node 24.16.0

- `npm test`: backend 13, Local Runner 20, engine 33; kết quả toàn bộ ở lượt chạy lại: 66/66.
- `npm run build`: exit 0. `node --test backend/test/browser/workflow-health.test.js`:
  1/1; dashboard đã build hiển thị metadata history, quyền và trạng thái lease.
- `npm run test:browser -w @rca/workflow-engine`: 4/4, bao gồm extension MV3
  unpacked thật trong Chromium/profile tạm. `node --check`: 20 file JS thay đổi
  thuộc backend/local-agent; `git diff --check` cho phạm vi WFI-06 không có lỗi.
- Pipeline thật core → adapter → engine: mất HTTP response sau khi nhận job,
  mất report ACK sau commit, retry cùng key không thêm execution; body khác 409.
  Cancel trước delivery ghi tombstone; restart adapter/backend không replay.
- Kill process backend sau commit dispatched: restart thành unknown, lease bị
  xóa, không dispatch lại. Kill/restart engine giữ correlation jobId/runId,
  migration schema 1 → 2 có backup; không chạy thêm run cho cùng key.
- SQLite kiểm tra cạnh tranh requestId/canonical body, report duplicate/out-of-order,
  terminal không lùi, retention 30/90 ngày, unknown không purge; rollback từ chối
  unresolved và giữ key tombstones. History bị chặn ngay khi membership bị thu hồi;
  projection không chứa variables/token/path/raw errors.

Lượt full test đầu có một timeout ở fixture đọc trạng thái Windows (không phải
jobs/sync); test đó đạt khi chạy riêng và trong lượt full chạy lại. Không thay
timeout hoặc bỏ test để vượt qua lỗi. Lệnh browser backend không có npm script;
đã chạy trực tiếp file test như trên.

Chưa nghiệm thu VPS/WAN/power loss thực, desktop bị khóa/Session 0, profile hoặc
website đăng nhập thật. Không có cam kết exactly-once cho side effect bên ngoài;
unknown giữ barrier và cần kiểm tra local, không có force-clear tự động. Không
deploy, restart installation người dùng hoặc thay env/credentials/profile thật.
WFI-07–08 vẫn planned; hướng dẫn schema/protocol/retention/rollback tại
[WORKFLOW_JOBS](WORKFLOW_JOBS.md).

## WFI-07 — 2026-11-18, Windows / Node 24.16.0

- `npm test`: exit 0, **66/66** (backend 13, Local Runner 20, engine 33).
  Thêm assertions lookup request của chính user, current membership, schema
  describe/public defaults; giữ các test server chặn giả mạo lease/viewer.
  Sau khi giới hạn schema không gửi enum riêng tư, chạy lại policy/grants:
  **7/7**, bao gồm assertion giá trị enum không public không xuất hiện trong response.
- `npm run build`: exit 0. `node --test --test-concurrency=1
  backend/test/browser/*.test.js`: exit 0, **3/3**.
- Chromium fixture viewport desktop **1280×900** và mobile **390×844**: catalog,
  schema/validation trước dispatch, missing extension → mở profile → readiness,
  run/stop và terminal receipt. Viewer và browser khác không có quyền thao tác;
  forged Socket.IO request bị backend từ chối, lookup không lộ key user khác.
- Revoke khi đang chờ ACK, reload/lost response khôi phục run từ requestId,
  ACK cũ không render; không thêm execution. Unknown/history không tự retry.
  Đếm request chứng minh status/profile polling dừng sau mất lease; kiểm tra
  keyboard Enter và không tràn ngang trên mobile. Không có pageerror.
- Fixture chỉ dùng user/device/engine metadata và Chromium profile tạm, không
  mở profile Chrome đã đăng nhập hoặc website side effect thật. Không deploy,
  sửa env thật hoặc restart installation người dùng.

WFI-07 hoàn tất source/fixture; VPS/WAN, desktop tương tác và website đăng nhập
thật vẫn cần WFI-08. Hướng dẫn vận hành UI/API bổ sung tại
[WORKFLOW_FRONTEND](WORKFLOW_FRONTEND.md).

## WFI-08 — evidence 2026-11-18, Windows 10.0.19045 / Node 24.16.0

**WFI-08 vẫn Planned.** Bảng này chỉ ghi kết quả thực chạy, không dùng source
existence để đánh dấu pass. Không có pass thủ công trên production trong phiên này.

| Kiểm tra thực chạy | Kết quả | Phạm vi bằng chứng |
| --- | --- | --- |
| `npm test` | Exit 0, 66/66: backend 13, runner 20, engine 33 | Protocol, DB, real process crash/restart, ACL env, packaging fixtures |
| `npm run build` | Exit 0 | Vite frontend production bundle |
| `npm run test:browser -w @rca/workflow-engine` | Exit 0, 4/4 | Unpacked MV3/Options/real DOM/CDP, worker reconnect, content settlement, fixture content/media UI |
| `node --test --test-concurrency=1 backend/test/browser/*.test.js` | Exit 0, 3/3 | Dashboard health, desktop/mobile, current browser authority, stale UI ACK/recovery |
| `npm run test:workflow:e2e` | Exit 0, 1/1 sau sửa synchronization fixture | Backend SQLite temp → runner process → engine attach → MV3 thật → HTTPS fixture |
| Git Bash `bash -n scripts/deploy.sh`, `bash -n scripts/test-deploy.sh` | Exit 0 | Syntax scripts hiện có |
| Git Bash `bash scripts/test-deploy.sh` | Exit 0 | Compose layout/immutable release/HTTPS promotion/rollback bằng command stubs, không gọi VPS |
| `docker info --format '{{.ServerVersion}}'` | Exit 1, **blocked** | Pipe dockerDesktopLinuxEngine không tồn tại; không build/inspect image hoặc Compose runtime thật |

Harness mới ở `backend/test/e2e/workflow-stack.test.js`. Lượt trực tiếp Node đầu
đạt 1/1; lượt chạy alias đầu phát hiện giả định test không đúng: sau stop, grant
scoped status có thể trả 503 khi browser còn settling/health degraded. Harness
đã chuyển sang chờ readonly VPS receipt terminal + quiescent, đúng contract;
không retry mutation, không bỏ kiểm tra settled receipt/DOM hoặc nới quyền.
Lượt alias tiếp phát hiện fixture xin lease trước khi snapshot offline/new runner
và old-grant drain hoàn tất. Đã chờ offline thực rồi health mới + barrier clear
trước lease mới, không bypass nonce/grant/barrier. Lượt alias cuối **exit 0, 1/1**.
Chạy lại alias sau sửa synchronization cũng **exit 0, 1/1** (hai lượt liên tiếp).
Không tính các lần chạy lặp thành thêm test hoặc coi fixture HTTPS là WAN/TLS production.

### Failure matrix và giới hạn evidence

| Tình huống | Evidence local tự động | Còn phải nghiệm thu |
| --- | --- | --- |
| Pairing một lần, local consent/nonce ACK | Core tests + stack harness dùng console YES, runner thật gửi ACK; code dùng lại bị 401 | Pairing thủ công user thật trên máy sạch |
| Expired pairing/nonce/session, viewer/foreign browser | `core.test.js`, adapter/grants tests; dashboard fixture + stack foreign browser bị chặn | Browser/WAN đa thiết bị thật |
| Lease/grant expiry, policy/membership revoke, owner takeover | `workflow-grants.test.js`, `policy-grants.test.js`: expiry/watchdog, barrier, không cấp grant trước proof | Toàn ma trận khi Chrome GUI thật đang thao tác |
| Device revoke | Core HTTP/realtime test thu hồi máy/quyền/lease | Device revoke giữa action extension thật chưa E2E toàn tuyến |
| Browser disconnect/VPS restart | Grants/jobs/crash tests: lease mất, dispatched thành unknown, không replay | Mất WAN/proxy/TLS thật |
| Runner mất/restart | Stack harness kill/restart runner sau job thành công, attach engine còn sống, retry cùng key không thêm action | Runner crash giữa GUI input trên target |
| Engine crash/restart/managed ownership | Supervisor tests và jobs test kill engine thật; unknown giữ barrier, child riêng, không kill chủ port | Managed launcher GUI và child ngoài process trên target |
| Crash sau journal, HTTP response lost, committed report ACK lost | Jobs-sync/journal/engine jobs tests, temp SQLite/process thật; cùng key không tạo execution mới | Power loss/storage failure thật |
| Duplicate/out-of-order/stale reports và ACK | Workflow-jobs/policy/grants/extension settlement tests + stale UI ACK fixture | Transport WAN thật |
| Profile/foreground contention, stop và bước sau hủy | Stack MV3 thật trả BUSY; pending waitFor có settled cancellation, click kế tiếp không xảy ra; profile-bridge tests | Hai profile GUI thật, khóa desktop/RDP |
| Data boundary/logs/legacy bypass | Stack kiểm tra logs/history không token/credential/pair code/absolute temp path/typed content; legacy control không 200; grants tests lọc metadata | Audit installation/image production |
| ACL Windows và local listener | Supervisor fixture kiểm tra allow/deny ACL token; stack Get-NetTCPConnection xác nhận engine bind 127.0.0.1 thật | ACL toàn runtime/credentials trên máy đích; firewall/proxy target |
| Artifact/package boundary | Engine standalone export allowlist/runtime-only lock, secret/traversal rejection; extension ZIP đúng 5 files, tất cả tạo temp | Image thật blocked Docker daemon; release trên máy sạch chưa chạy |
| Media/file picker | Fixture media UI/unit logic; file-picker dùng fake process, không phải dialog Windows thật | Picker/media GUI thật chưa chạy, không post/upload nội dung thật |
| Backup/restore/rollback | Migration upgrade/rollback fixtures; deploy rollback command stubs | Full restore drill DB/journal/history và image/schema trên target chưa chạy |

### Gate production còn mở

VPS/WAN/HTTPS/Socket.IO proxy, Docker build+inspect, Windows interactive/Chrome
launch bằng production launcher, startup task/reboot/lock/unlock/RDP, ACL toàn
runtime, máy sạch, full backup/restore và rollback schema/package trên target:
**chưa chạy** (Docker riêng là blocked). Runbook đã viết nhưng chưa chứng nhận
thực hiện thành công trên máy sạch. Không tự deploy/restart/cài task hoặc dùng
profile đã đăng nhập. Không có cam kết exactly-once cho website bên ngoài.
Quy trình và mẫu evidence operator: [WORKFLOW_OPERATIONS](WORKFLOW_OPERATIONS.md).

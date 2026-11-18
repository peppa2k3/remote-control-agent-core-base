# Vận hành workflow tích hợp — WFI-08

Trạng thái: **nghiệm thu local tự động đã chạy; target production chưa nghiệm thu**.
WFI-08 giữ planned cho tới khi đạt cả VPS/WAN, Windows interactive và máy sạch.
Không deploy, cài Scheduled Task hoặc restart installation thật trong bước coding.

## Kiểm tra trên checkout tách biệt

Dùng Node 24 theo engines của workspace, npm ci tại root. Browser tests cần
Playwright Chromium bundled đã cài (`npx playwright install chromium` trên máy
test), Chrome channel cho fixture dashboard, OpenSSL (Windows fixture dùng
Git for Windows tại `C:/Program Files/Git/usr/bin/openssl.exe`) và PowerShell.
Node-pty cần môi trường native phù hợp; không bỏ test vì thiếu prerequisite.

```sh
npm test
npm run build
npm run test:browser -w @rca/workflow-engine
node --test --test-concurrency=1 backend/test/browser/*.test.js
npm run test:workflow:e2e
```

Suite cuối dùng SQLite/temp data, HTTPS website fixture, Local Runner process
thật và engine attach process riêng, extension MV3 thật trong Chromium profile
tạm. Console pairing gửi YES chỉ trong fixture, ACK lease do runner thật trả.
Không mock thành công action Chrome: kiểm tra DOM và từng settled receipt,
cancel waitFor không chạy click kế tiếp; restart runner giữ receipt không replay.
Các flags load-extension/ignore-certificate/host mapping chỉ dùng fixture loopback,
không đưa vào launcher production. Không dùng profile hoặc credential thật.
Cleanup chỉ process/thư mục fixture do test tạo. Thất bại trả exit khác 0.

## Cài mới local, thao tác bởi người vận hành

1. Chọn thư mục cài đặt và runtime riêng của user Windows sẽ chạy Chrome; Node
   24, Chrome và các video tools cần thiết cài local. Chạy npm ci từ root checkout
   sạch. VPS chỉ giữ backend/frontend; local giữ engine/Chrome/tools/user data.
2. Tạo env local-agent và engine từ `.env.example` **chỉ khi file đích chưa có**;
   không ghi đè env cũ. Chọn đường dẫn runtime/scenarios/profile tuyệt đối riêng.
   Engine đặt `LOCAL_AGENT_MODE=integrated`; tạo token ngẫu nhiên mạnh 32–256
   ASCII tại local và lưu riêng trong engine env, không gửi lên VPS/web/log.
   Runner chọn protocol 2, cùng loopback URL/port và env file. Mặc định attach.
3. Cấp NTFS ACL cho env, credentials, journal, data/profile và thư mục cha: chỉ
   user chạy, SYSTEM/Administrators cần thiết; tắt inheritance rộng, bỏ quyền
   read/write/delete/change-permissions của nhóm khác. Properties → Security →
   Advanced cho phép kiểm tra trước khi sửa. chmod 600 không đủ trên Windows.
   Supervisor chỉ kiểm tra env token; không coi kiểm tra này là chứng nhận mọi
   thư mục runtime. Trên POSIX file secret 600 và thư mục runtime riêng 700.
4. Duyệt scenario local, pin SHA-256 chính xác và policy profiles/scenarios/
   variables/publicDefaults, URL origins/file roots nếu cần. Không cho override
   steps/locator/path/URL/action từ web. Xem [WORKFLOW_GRANTS](WORKFLOW_GRANTS.md).
5. Attach: khởi động engine đã chọn bằng quy trình local, rồi runner. Managed:
   dừng engine cũ có chủ đích, chọn engine env và managed, chỉ khởi động runner;
   không khởi động thêm engine/task độc lập. Xem [WORKFLOW_SUPERVISOR](WORKFLOW_SUPERVISOR.md).
6. Backend owner tạo pairing code; tại console runner xác nhận YES với đúng VPS
   HTTPS, để runner tự ghi credentials của máy này. Xóa PAIR_CODE sau enrollment.
   Giữ AUTO_APPROVE_SESSIONS=false cho quy trình cần xác nhận từng lease.
   Không copy credentials giữa máy; máy mới phải pairing riêng.
7. Cài/enable extension 4.4.0 thủ công trong đúng profile, Options chọn đúng port/
   profile rồi chờ heartbeat ready. Xem [WORKFLOW_CHROME](WORKFLOW_CHROME.md).
   Không port-forward/proxy engine port 34719; local service chỉ bind loopback.
8. Xin lease bằng browser sẽ dùng; local ACK nonce phải hoàn tất. Kiểm tra health
   engine 0.5.0/jobsVersion=1, readiness rồi dùng scenario fixture không side effect
   thật. Kiểm tra history VPS, stop/release và quiescence trước dùng dữ liệu thật.

## Attach dữ liệu cũ, nâng cấp và Windows startup

Inventory installation/task/port/data/profile đang chạy tại local trước khi đổi.
Không chạy hai engine cùng data hoặc hai controller cùng endpoint. Attach chỉ
probe/revoke grant của adapter; không kill process đang giữ port. Token cũ không
bị rotate tự động. Engine standalone/v1 phải được chuyển integrated có policy
đúng; đổi protocol một mình không làm v1 trở thành grant v2.

Nâng đồng bộ backend/frontend/runner/engine; extension giữ 4.4.0, reload extension
và refresh tab cũ. Trước nâng: release lease, chờ toàn bộ work quiescent, dừng
runner/engine có chủ đích, backup nhất quán. Không xóa unknown để vượt barrier.
WFI-06 engine 0.5.0 nâng journal schema 1 → 2, tạo `.v1-backup.json` nếu chưa có;
backend migration jobs additive version 1. Giữ cả request keys, fence watermark
và receipts. Phiên điều khiển cũ không khôi phục sau restart.

Startup GUI phải chạy đúng user đã đăng nhập, Task Scheduler “Run only when user
is logged on”, trigger At logon, working directory local-agent và action Node
với env/entrypoint tuyệt đối. Pair thủ công trước khi cấu hình startup; không
phụ thuộc prompt stdin của task nền. Session 0/service không được coi là desktop
sẵn sàng; lock screen, RDP disconnect và sau reboot cần nghiệm thu riêng.
Managed chỉ có task runner, không task engine thứ hai. Script engine
`install-remote-startup.ps1` chỉ dành cho engine độc lập/attach đã chọn, không
phải installer core runner và không được chạy đồng thời managed. Việc đăng ký
task không được thực hiện tự động trong WFI-08.

## Backup, restore và rollback

| Thành phần | Cần giữ | Điều kiện |
| --- | --- | --- |
| Backend SQLite | Toàn DB + WAL/SHM nếu tồn tại, schema/migration, key/receipt/fence | Stop writer hoặc SQLite backup API consistent; một backend process |
| Adapter | workflow-journal.sqlite cùng WAL/SHM, credentials của chính máy | Stop runner; giữ ACL và identity cùng device, không chuyển sang máy khác |
| Engine | Activity/history, workflow-grants.json schema 2, scenarios/policy và cấu hình mapping | Stop engine, dữ liệu/identity/fence đồng bộ, không tự xóa unknown |
| Chrome | Profile/user data nếu vận hành cần backup | Đóng Chrome có chủ đích; lưu riêng local, không đưa VPS/image/Git |

Kiểm tra restore trên bản sao offline tách biệt trước production. Không copy file
SQLite đang có writer rồi coi là backup. Backup chứa dữ liệu nhạy cảm phải có
ACL/encryption và retention do operator quản lý. Không upload backup vào issue/log.

Restore không được làm mất guard của jobs đã chạy sau thời điểm backup. Không
restore journal schema 1 để bỏ request keys/fences schema 2, hoặc restore cả hai
đầu về snapshot cũ rồi retry job cũ. Nếu không chứng minh được outcome/guard đầy
đủ: giữ điều khiển offline, kiểm tra local, không replay/force-clear. Hiện không
có API sửa unknown tự động. History mất không được suy ra rằng job chưa chạy.

Rollback package chỉ tới version tương thích schema và durable keys đang giữ.
Engine 0.4 không đọc schema 2; không chạy nó trên runtime 0.5 hoặc tự lấy backup
v1 thay thế sau khi đã có job mới. Backend rollback migration từ chối unresolved,
giữ key tombstones; xem [WORKFLOW_JOBS](WORKFLOW_JOBS.md). Không drop core tables.
Rollback về attach cần dừng owned managed child hoàn toàn trước, dùng engine
tương thích và env đã chọn; không nhận ownership bằng cách kill chủ port.

## VPS theo pipeline hiện có

Thực hiện bởi operator sau các gate production, theo [CICD_DEPLOY](CICD_DEPLOY.md).
CI hiện có chạy unit/build/Compose/Docker/deploy stubs, chưa tự chạy các suite
browser/stack phía trên; cần ghi evidence riêng trước rollout, không suy từ CI xanh.
Workflow push main/workflow_dispatch main có thể publish/deploy; coding WFI-08
không kích hoạt workflow. Single app process/replica + named SQLite volume.
Dockerfile chỉ đưa backend source/frontend dist và workspace package metadata
cần npm vào runtime; không đưa engine runtime/Chrome/tools/env/credentials vào
image. Chưa build/inspect image thật khi Docker daemon không hoạt động.

Trước rollout: xác nhận immutable SHA, image/schema compatibility, current/previous
image, DNS/TLS/Origin/cookie, backup DB consistent ngoài volume đang dùng, restore
drill và các runner/engine versions tương thích. Pipeline không tự backup DB.
Không scale replicas hoặc chạy thêm backend writer cho cùng SQLite.

Sau rollout: `/api/health` HTTPS, login + Socket.IO, pairing/nonce/lease, filtered
health/version, Chrome readiness, scenario fixture/history/stop/release. Public
health chỉ chứng minh process, không chứng minh runner/desktop/extension/website.
Image rollback tự động của deploy.sh giữ SQLite volume và **không rollback DB**;
phải chọn previous image tương thích schema/keys. Nếu không tương thích, chặn
rollout trước; không coi rollback image là recovery dữ liệu. Không dùng down -v.

## Gate còn phải nghiệm thu

Máy sạch Windows interactive (đúng logged-in user, mở Chrome thật bằng launcher,
ACL runtime, reboot/startup, lock/unlock/RDP), VPS/WAN/TLS/proxy, Docker image thật,
backup/restore trên target và dữ liệu website fixture tại desktop thật cần evidence
operator riêng: ngày, version, môi trường, bước, output đã redact và kết quả.
Chưa có evidence thì để “chưa chạy/blocked”, không chuyển WFI-08 completed.
Bảng đã chạy và failure matrix: [VALIDATION](VALIDATION.md).

Mẫu ghi evidence operator (không điền secret/path profile/cookie/pairing code):

| Gate | Ngày / người kiểm tra / OS / commit và versions | Kết quả + artifact đã redact |
| --- | --- | --- |
| Cài máy sạch và ACL runtime | Chưa chạy | Chưa có |
| Interactive launcher, startup/reboot/lock/RDP | Chưa chạy | Chưa có |
| VPS/WAN/TLS/proxy + failure matrix | Chưa chạy | Chưa có |
| Docker image inspection + compatibility | Blocked local daemon | Chưa có image thật |
| Backup/restore drill và rollback target | Chưa chạy | Chưa có |

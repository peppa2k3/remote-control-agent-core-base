# Supervisor và health local — WFI-04

Engine đi kèm là **0.4.0**, protocol 2, `lifecycleVersion: 1`. Supervisor dùng lại
daemon entrypoint `index.js --daemon` của source tham chiếu, thêm ownership IPC,
giới hạn restart và health có xác thực. Không cài Scheduled Task hay deploy VPS.

## Giữ installation đang chạy bằng attach

Trong cấu hình **local-agent**, đặt `WORKFLOW_AGENT_PROTOCOL=2`,
`WORKFLOW_SUPERVISOR_MODE=attach`, URL loopback và `WORKFLOW_AGENT_ENV_FILE`
trỏ đến `.env` engine hiện có. Path tương đối tính từ thư mục `local-agent/`.
Chỉ dùng integrated engine 0.2.x, 0.3.x hoặc 0.4.x đã có policy local hợp lệ.
Standalone/v1 không đáp ứng grant v2; mode legacy protocol 1 vẫn là lựa chọn riêng.

Token phải nằm trong engine env được chọn; nếu có override từ shell/local-agent
thì phải trùng token đó. Supervisor chụp cấu hình một lần lúc runner khởi động,
không ghi/rotate token, không đọc `remote.json`, không copy runtime data.
Đổi token cần chủ động dừng/cấu hình lại engine và runner tại máy local.

Bảo vệ **file env chứa token** trước khi khởi động runner. Trên Windows dùng
Properties → Security → Advanced, tắt inheritance cho file này, chỉ giữ Allow
cho user chạy runner, SYSTEM và Administrators. Không cấp read/write/delete/
change permissions cho nhóm khác. Supervisor kiểm tra SID bằng Get-Acl thực;
`ENV_PERMISSIONS` nghĩa là cần sửa ACL tại máy local. Linux/macOS dùng mode 600.
Giữ thư mục cài đặt/runtime riêng cho cùng user và không chia sẻ quyền ghi.

Attach chỉ probe HTTP có token; không spawn, kill hoặc thay cấu hình engine.
Khi runner shutdown/disconnect, adapter thu hồi grant nó sở hữu. Engine vẫn chạy;
lượt local độc lập không bị supervisor dừng. Không sửa token engine đang chạy.

## Chuyển sang managed có chủ đích

1. Dừng runner cũ và engine cũ bằng cơ chế vận hành tại máy local. Kiểm tra các
   lượt đang chạy/unknown trước khi chuyển; không xóa journal để vượt barrier.
2. Chuẩn bị env riêng cho engine đóng gói tại `local-agent/workflow-engine/`.
   Giữ nguyên data/scenarios/policy/profile paths đã xác nhận; dùng path tuyệt đối
   khi di chuyển từ installation khác. Không chạy hai engine cùng data directory.
3. Bảo vệ ACL như trên. Đặt runner `WORKFLOW_AGENT_ENV_FILE` tới file đó và
   `WORKFLOW_SUPERVISOR_MODE=managed`, rồi khởi động runner theo cách hiện có.
   Không chạy thêm `npm run workflow:engine` đồng thời.
4. Dashboard phải báo engine sẵn sàng trước khi xin lease/chạy workflow.
   Ready chưa xác nhận interactive Windows session, Chrome, extension hay website
   đăng nhập; phần openProfile/extension readiness thuộc WFI-05.

Managed dùng đúng `process.execPath` của runner Node 24, entrypoint package cố
định, cwd tuyệt đối, `shell:false`, cửa sổ ẩn và argv chỉ chứa entrypoint/daemon.
Không nhận path/args/env/mode từ web. Child nhận OS env allowlist và các key engine
được duyệt; không nhận VPS/device/pairing credential, `NODE_OPTIONS` hoặc env
backend. Child không load lại env file; token/Mongo settings được chụp lúc start.
Child stdout/stderr bị bỏ để không đưa path/credential vào log của runner/VPS.

Supervisor giữ SQLite exclusive transaction theo user + loopback URL; OS giải
phóng khóa khi process chết. Engine giữ khóa riêng theo data directory **trước**
khi sửa activity/grant. Không dò PID rồi kill chủ port; port bận hoặc controller
khác đang giữ khóa thì fail. Nếu parent chết mà child còn drain, lần start mới
báo port bận; không nhận ownership của process cũ.

## Health, restart và shutdown

- `configured`, `starting`, `ready`, `degraded`, `stopping`, `failed`,
  `unconfigured` là các trạng thái riêng. Ready yêu cầu Bearer auth, protocol,
  mode, version tương thích, UUID instance và bảy operations v2. Managed còn
  kiểm tra lifecycleVersion và instance từ IPC nonce của chính child nó spawn.
- Startup tối đa 15 giây; probe có deadline; health mỗi khoảng 3 giây. Crash hoặc
  unresponsive kéo dài chuyển failed rồi restart, backoff 1/2/4 giây, tối đa ba
  lần trong vòng đời supervisor. Healthy trở lại không reset bộ đếm. Không replay.
- Shutdown adapter trước để revoke grant; managed gửi IPC shutdown cho owned
  child. Engine ngừng nhận việc mới, giữ đường nhận receipt/revoke và chờ drain
  tối đa 10 giây, đóng HTTP/Mongo, rồi báo quiescent qua IPC. Supervisor chờ tối
  đa 18 giây; timeout chỉ terminate child do nó tạo. Thiếu proof báo STOP_TIMEOUT,
  không khẳng định Chrome/side effect ngoài process đã dừng. Nếu child chưa exit,
  giữ ownership/khóa và không spawn child kế tiếp.
- Crash đổi engineInstanceId, revoke grant cũ, giữ run chưa xác nhận ở unknown.
  Health UNKNOWN_OUTCOME không cấp việc mới; không tự xóa barrier hay replay.
- Backend chỉ chuyển metadata được chọn trong snapshot đã lọc membership.
  Timestamp freshness do backend ghi khi nhận; sau 15 giây thiếu health báo STALE
  và chặn request mới dù runner heartbeat còn hoạt động. Agent offline xóa health.
  Refresh cùng instance/policy khỏe mạnh giữ nguyên grant; mất readiness/đổi
  instance/policy thu hồi grant và chờ quiescence.

Các reason chính: AUTH_FAILED, INCOMPATIBLE, PORT_IN_USE, CONTROLLER_BUSY,
ENV_PERMISSIONS, START_TIMEOUT, RESTART_LIMIT, STOP_TIMEOUT, UNKNOWN_OUTCOME.
Không trả env/token/path/argv ra frontend. Không có endpoint web bật managed.

Rollback vận hành: dừng runner managed và chờ child kết thúc, đổi runner về attach,
khởi động installation đã chọn bằng quy trình local rồi chạy runner. Không khởi
động bản engine không tương thích trên journal đang có unknown; cần review local.

Kiểm chứng và giới hạn thực tế: xem [VALIDATION.md](VALIDATION.md).

WFI-05 adds extension 4.4.0 binding/readiness and openProfile; see [WORKFLOW_CHROME](WORKFLOW_CHROME.md).

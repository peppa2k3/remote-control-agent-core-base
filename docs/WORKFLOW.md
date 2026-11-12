# Kết nối workflow engine trên máy local

## Integrated mode WFI-03

Engine 0.3.0 + runner WORKFLOW_AGENT_PROTOCOL=2 hỗ trợ policy/grant theo active
lease. Xem [cấu hình và phạm vi](WORKFLOW_GRANTS.md). Env examples mới opt-in;
không sửa env/installation đang chạy tự động. Protocol 1/standalone dưới đây vẫn
giữ behavior cũ. Extension integrated cần 4.3.0, reload và refresh trang cũ.

Revoke/expiry dừng run remote thuộc grant, chặn bước mới và đợi quiescence trước
takeover; HTTP pending và run đã accepted đều được xử lý, kể cả mất response POST.
Run dashboard local không thuộc grant web. Các mô tả v1 “accepted run có thể tiếp
tục” trong phần lịch sử bên dưới chỉ áp dụng standalone/protocol 1.

## Engine đi kèm source chính (WFI-02)

Không cần copy engine từ `ref/`. Root `npm ci` cài workspace
`@rca/workflow-engine`; MongoDB driver runtime pin 7.7.0, Playwright chỉ dev.
Tự tạo `local-agent/workflow-engine/.env` từ example, cấu hình API token local,
rồi chạy `npm run workflow:engine` ở root cho attach. Lệnh này chạy daemon riêng.
`npm run agent` chạy `@rca/local-agent`; WFI-04 cho phép chọn managed để runner
khởi động engine đóng gói. Không chạy cả hai cơ chế đồng thời; xem
[hướng dẫn attach → managed và ACL](WORKFLOW_SUPERVISOR.md).

Trong cấu hình runner dùng `WORKFLOW_AGENT_ENV_FILE=./workflow-engine/.env`,
resolve từ `local-agent/`. Giữ đường dẫn env engine ngoài repo nếu đang attach
installation cũ; không tự migrate hoặc đổi credential. Extension cài riêng từ
`local-agent/chrome-reels-extension/`, giữ port 34719; chưa tự mở/cài Chrome.

`npm run package:workflow -- --output THU_MUC_MOI` xuất engine với lock runtime
độc lập, chạy `npm ci --omit=dev` tại máy đích; `npm run package:extension` tạo ZIP
5 file runtime. Xem [README engine](../local-agent/workflow-engine/README.md).
Không chép env/data/tools/profile/credential vào artifact. HTTP control-server
polling cũ bị tắt trong bootstrap, kể cả khi data có remote.json cũ; không đọc
credential đó. Trang `/remote` chỉ giải thích kết nối core.

Phần WFI-02 và CLI dưới đây mô tả API/bridge v1 trong standalone/protocol 1;
accepted run có thể tiếp tục khi mất lease. Integrated v2 theo mục WFI-03 ở trên;
supervisor đã có từ WFI-04; jobs bền vững toàn tuyến còn planned.

Panel **Kịch bản tự động** gọi API của Local Workflow Agent trên cùng máy với
terminal agent. Luồng: browser → Socket.IO VPS → terminal agent → HTTP loopback
`127.0.0.1:34719/api/v1`. Không mở port mới tới máy local.

## Cấu hình máy local

1. Khởi động repo workflow bằng `node local-agent.js`. Engine cần
   `LOCAL_AGENT_API_TOKEN` trong `.env`; token đã cấu hình phải trùng token engine
   đang dùng. Thay token cần khởi động lại engine.
2. Trong `.env` của terminal agent, thêm:

```dotenv
WORKFLOW_AGENT_ENABLED=true
WORKFLOW_AGENT_URL=http://127.0.0.1:34719
WORKFLOW_AGENT_ENV_FILE=D:/CODE_DND/local-agent-work-flow/.env
```

3. Khởi động lại `npm start` trong thư mục runner đang dùng, ví dụ
   `local-agent copy`. Giữ file ghép nối/credentials hiện tại, không enroll lại.
   Cũng có thể đặt `$env:WORKFLOW_AGENT_ENV_FILE` trước `npm start`.
4. Build/deploy backend và frontend mới theo quy trình hiện có. Coding không tự
   cập nhật service VPS đang chạy. Sau đó đăng nhập web, yêu cầu điều khiển và
   xác nhận tại local như luồng terminal hiện có.
5. Trong panel, tải danh sách, chọn Chrome profile và scenario, xem biến mặc định
   nếu cần, sửa JSON rồi chạy. Trình duyệt local cần extension tương ứng profile.

Token chỉ đọc ở máy local; backend không có cấu hình hoặc bản sao token. Không
chép `.env` workflow lên VPS. `WORKFLOW_AGENT_ENV_FILE` tính từ thư mục runner,
không theo terminal cwd. Có thể đặt `WORKFLOW_AGENT_ENABLED=false` để tắt bridge.

## Terminal hiện có

Từ terminal điều khiển trên VPS, chuyển tới thư mục workflow:

```powershell
cd D:\CODE_DND\local-agent-work-flow
node local-agent/workflow.js profiles
node local-agent/workflow.js scenarios
node local-agent/workflow.js describe --scenario downl-up-khoahocgia
node local-agent/workflow.js run --scenario downl-up-khoahocgia --profile "Profile 1" --wait
node local-agent/workflow.js runs
node local-agent/workflow.js stop --run-id UUID_TRA_VE
```

Hoặc chạy `node workflow.js ...` ngay tại thư mục terminal agent đã cấu hình
`WORKFLOW_AGENT_ENV_FILE`. CLI không phụ thuộc source engine trong cùng repo.
CLI in JSON `{requestId}` ra stderr **trước khi gửi** lệnh `run`, kể cả không
dùng `--wait`. Nếu mất phản hồi, kiểm tra lịch sử; khi thử lại cùng tham số, thêm
`--request-id MA_DA_IN` để engine nhận lại đúng idempotency key. Stdout vẫn là
JSON kết quả; không tự gửi lại bằng một key mới khi chưa biết kết quả lượt cũ.

## Quyền và vòng đời

Owner/operator phải giữ active lease đúng user/browser/device/session để gọi
catalog, run, status hoặc stop. Backend kiểm tra lại sau khi nhận ACK để không
gửi kết quả cho phiên đã bị thu hồi; local cũng kiểm tra session/expiry.
Viewer và browser khác của cùng user không được điều khiển bằng sessionId cũ.

Panel poll trạng thái mỗi 2 giây khi đang chạy. Mất lease/mạng dừng quyền gửi
lệnh mới và HTTP đang chờ. Runner tự theo dõi expiry local, không cần chờ VPS
gửi revoke; gia hạn cùng lease cập nhật hạn chờ, thay session hủy request cũ.
Kết quả đến sau khi request bị hủy không được trả về browser. Tuy vậy, workflow
đã được engine nhận có thể tiếp tục.
Lấy lease mới, tải danh sách và chọn **Lượt gần đây** để tra cứu/dừng đúng runId.
Các popup xác nhận media trùng cần được xử lý trên dashboard local.

Retry cùng lệnh run phải giữ requestId và body; không tự POST lại khi timeout.
Engine giữ idempotency trong RAM, mất qua restart. Panel giữ requestId khi lỗi
và người dùng thử lại cùng tham số trong phiên UI hiện tại; sau reload hãy kiểm
tra lịch sử trước. Backend chỉ audit `workflow.run`/`workflow.stop`, không lưu
token, biến hay response. Workflow history thuộc engine local.

Bridge chỉ gọi operation cố định, scenario đã lưu và biến được engine validate;
không nhận shell/steps/API URL từ frontend. Socket không nhận uploadPath; file
upload được cấu hình trong scenario. Tham số tối đa 12KB, response relay tối đa
512KB, tối đa bốn request chờ mỗi browser/local agent. Params 12KB được kiểm tra
ở cả VPS và runner. Timeout relay 12 giây.

## Kiểm chứng

`backend/test/workflow.test.js` chạy Socket.IO thật cùng HTTP loopback fixture
để kiểm tra auth/lease, catalog, run, stop, audit và chặn shell/path/viewer/browser
khác. `local-agent/test/workflow.test.js` kiểm tra config, auth, redirect, token
redaction và abort khi revoke. `npm test` và `npm run build` là các gate của repo.
Chưa deploy VPS hoặc chạy scenario trên Chrome profile người dùng.

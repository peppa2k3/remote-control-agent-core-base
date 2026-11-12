# Workflow Engine 0.4.0 đi kèm core

WFI-03 bổ sung mode integrated với policy local/grant v2. Xem
[cấu hình integrated](docs/INTEGRATED_MODE.md). Env example chọn integrated;
standalone/v1 chỉ giữ cho cấu hình legacy có chủ đích. Extension integrated cần
4.3.0, Reload extension và refresh các trang cũ sau nâng cấp.

Engine CommonJS độc lập được nhập từ snapshot `local_workflow_agent-dev-remote`
do người dùng cung cấp. [PROVENANCE.json](PROVENANCE.json) lưu SHA-256 file nguồn
trước điều chỉnh; chưa xác định license/commit upstream, không tự gán giấy phép.
Không cần thư mục `ref/` khi cài/chạy bản này.

## Chạy từ checkout core

Tại root repo, Node.js 24:

```powershell
npm ci
```

Tự tạo `local-agent/workflow-engine/.env` từ `.env.example` trên máy local và đặt
`LOCAL_AGENT_API_TOKEN` ngẫu nhiên 32–256 ký tự ASCII không khoảng trắng. Không
đưa token vào argv/Git, không chép file này lên VPS. Sau đó:

```powershell
npm run workflow:engine
```

Dashboard: `http://127.0.0.1:34719`. Chỉ một engine giữ cổng này; nếu engine cũ
đang chạy hãy attach installation đó thay vì khởi động thêm hoặc kill nó.
`node index.js` trong package giữ chế độ console; `node index.js --daemon` không
dừng theo stdin EOF. `node index.js --help` là CLI client, không tạo server mới.

Trong `.env` của runner, cấu hình `WORKFLOW_AGENT_ENV_FILE=./workflow-engine/.env`
(resolve từ `local-agent/`) để dùng engine này. Đối với engine ngoài repo, giữ
path env hiện có. Backend không giữ token. Runner và engine vẫn khởi động riêng;
Chưa có supervisor. Với standalone/protocol 1, bridge v1 cần active lease ở core nhưng
workflow đã accepted có thể tiếp tục khi mất lease; xem [kết nối core](docs/CORE_BRIDGE.md).

API/CLI và scenario schema: [AUTOMATION_API](docs/AUTOMATION_API.md),
[SCENARIOS](docs/SCENARIOS.md). Sample `fixture-wait` chỉ đợi local; không cần
Chrome/Internet. `starter-browser` mở example.com khi được người dùng chạy.
Không nhập scenario/data/profile/credential của installation cũ vào Git.

## Chrome extension

Extension nằm ở thư mục sibling `../chrome-reels-extension/` trong checkout.
Cài/enable thủ công trong Chrome profile cần dùng, chọn đúng profile tại Options.
Engine không tự cài extension hoặc mở Chrome khi start. Giữ cổng 34719 vì
extension dùng URL loopback cố định. Chỉ test trên profile tách biệt.

## Gói engine standalone

Từ root core:

```powershell
npm run package:workflow -- --output D:/releases/workflow-engine
```

Đích phải là thư mục mới. Script chỉ xuất file trong `package-files.json`, không
quét/copy `.env`, data, tools, node_modules hoặc profile. Lockfile runtime được
trích từ root lock, không resolve phiên bản mới trên mạng, không chứa Playwright.
Ở máy đích:

```powershell
cd D:/releases/workflow-engine
npm ci --omit=dev
# Tạo .env riêng từ .env.example rồi cấu hình token tại máy này.
npm run start:daemon
```

Extension được đóng gói/phân phối riêng. MongoDB driver là dependency runtime do
module require trực tiếp; không có URI thì không kết nối MongoDB. yt-dlp/ffmpeg/
ffprobe chỉ cần cho video; cài riêng có chủ đích, không được đưa binary vào gói.
History/cache/outbox giữ tại data local theo [ACTIVITY_STORAGE](docs/ACTIVITY_STORAGE.md).

## Đường remote cũ

HTTP polling control-server cũ **bị tắt trong bản core**, cả checkout và standalone
export. Bootstrap không tạo remote client hoặc đọc `data/remote.json`; các mutation
`/api/remote/*` trả 410 sau auth dashboard. `/remote` chỉ giải thích kết nối core.
Module thuật toán cũ giữ làm source tham khảo, không được bootstrap gọi. API v1
và dashboard local giữ behavior nguồn trong standalone; integrated chặn v1 và
native Bearer trên API dashboard để bắt buộc grant. Dashboard session local là
quyền quản trị riêng, không chịu lease web.

## Kiểm tra

```powershell
npm run test:workflow
npm run test:browser -w @rca/workflow-engine
```

Lệnh đầu ở root core chạy Node-only suite với temp data; lệnh thứ hai dùng
Playwright dev và Chrome test context riêng. Extension E2E thuộc WFI-05, không
coi fixture ACK là Chrome extension thật. Không tự chạy migration/startup task.

WFI-04 adds authenticated lifecycleVersion=1 health and owned IPC shutdown. Core attach/managed instructions: `docs/WORKFLOW_SUPERVISOR.md` in the core repository. The standalone daemon still starts using `index.js --daemon`.

WFI-05: integrated openProfile requires allowOpen + grant. Extension 4.4.0 binding/readiness is required for web steps. Core guide: `docs/WORKFLOW_CHROME.md`.

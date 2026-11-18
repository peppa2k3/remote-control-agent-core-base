# Chrome profile và extension — WFI-05

Engine hiện tại **0.5.0**, extension **4.4.0** (profile bridge từ 0.4.0). Giữ logic profile cache, selector legacy,
file chooser, ACK/cancel và daemon từ source tham chiếu. WFI-05 thêm mở profile
theo grant và handshake/readiness thực; không tự cài extension hoặc sửa Chrome
Preferences/Secure Preferences. Không cần chạy control-server tham chiếu.

## Cài và kết nối tại máy local

1. Giữ supervisor attach/managed theo [WORKFLOW_SUPERVISOR](WORKFLOW_SUPERVISOR.md).
   Engine integrated dùng local policy. Trong policy, profile được mở phải có
   `allowOpen:true`; `allowOpen:false` vẫn cho chạy scenario được duyệt khi profile
   đã mở và extension đã kết nối. `CHROME_PATH`, `CHROME_USER_DATA_DIR` là path
   tuyệt đối do người vận hành cấu hình local, không do frontend gửi.
2. Trong **đúng profile Chrome**, mở `chrome://extensions`, bật Developer mode,
   Load unpacked `local-agent/chrome-reels-extension/`. Nếu dùng ZIP từ
   `npm run package:extension`, giải nén vào thư mục ổn định rồi Load unpacked.
   Sau nâng cấp: Reload extension và refresh các trang cũ. Không lưu token vào
   Options. Không coi Chrome đã spawn là extension đã được cài/enable.
3. Mở Options, chọn port engine (mặc định **34719**, hỗ trợ **1024–65535**), bấm
   **Tải danh sách profile**. Xem `chrome://version` → Profile Path để chọn đúng
   phần cuối `Default`/`Profile N`, rồi Lưu kết nối. Port Options phải trùng
   LOCAL_AGENT_PORT và WORKFLOW_AGENT_URL. Không có URL/host tùy ý ngoài loopback.
   Các link dashboard trong Options đổi theo port đã discovery.
4. Dashboard VPS: owner/operator xin active lease và được ACK local, tải catalog,
   chọn profile rồi **Mở Chrome profile**. Panel poll readiness; có thể cần enable
   hoặc sửa Options tại Chrome local. Viewer chỉ xem trạng thái thiết bị.

Mở lại profile đang ready/đang chờ không tạo workflow. Spawn chỉ dùng Chrome local,
argv `--user-data-dir=…`, `--profile-directory=…` và URL dashboard loopback cố định;
shell=false, OS env allowlist, không truyền credential/token/Mongo/NODE_OPTIONS.
Không có flags cài extension trong đường chạy production. Path có khoảng trắng/
Unicode giữ nguyên một argv. Session 0 bị từ chối trước spawn trên Windows;
session khác 0 vẫn cần desktop mở/đúng user và chính sách OS phù hợp. Scheduled
Task GUI phải chọn “Run only when user is logged on”. Không cài task tự động.

## Readiness và lỗi

Options discovery chỉ trả profile IDs được policy cho phép. Worker có clientId
bền vững trong storage và workerId mới mỗi lần MV3 khởi động. Bind trả nonce
connectionId chỉ dùng local; `/state`, `/next`, `/result`, picker phải khớp
profile/client/worker/nonce ở integrated mode. Heartbeat thực mới gia hạn 10 giây;
không báo ready từ cấu hình/Chrome PID. Worker timer/alarms/content wake reconnect
khi thức dậy; ngủ lâu/disable thì freshness hết và mất ready. Không resume/replay
action đang ambiguous sau worker restart. Client khác không được thay binding
còn fresh hoặc profile còn việc chưa xác nhận dừng.

Catalog có `readiness:{state,reasonCode}` và `allowOpen`:

| State | Ý nghĩa / xử lý |
| --- | --- |
| ready | Có heartbeat của binding đúng profile; không chứng minh website đã login |
| starting | Đã yêu cầu mở; chờ extension, deadline 30 giây |
| missing-extension | Chưa có binding hoặc hết heartbeat; kiểm tra enable/Options/port/profile |
| busy | Có workflow/chưa xác nhận quiescence; dừng và chờ receipt |
| failed | Chrome launch lỗi; kiểm tra cấu hình local, không trả path/lỗi OS lên VPS |

Bind sai profile không thuộc catalog/policy bị từ chối; sai client/worker/nonce
trả EXTENSION_BIND_REQUIRED; hai client trả PROFILE_BUSY. Bind version cũ trả
EXTENSION_UPGRADE_REQUIRED. Worker mất engine/restart cần bind lại; không thay token.
Profile do người vận hành chọn trong Options, không phải attestation tự động
đường dẫn profile OS. Local OS/admin/extension khác vẫn nằm ngoài boundary lease.

Scenario có bước web bị chặn trước start và trước mỗi bước khi thiếu readiness.
Scenario thuần local (wait/downloadVideo) không đòi extension. Integrated browser
workflow giữ một slot foreground toàn engine đến quiescence, gồm ACK muộn/cancel;
không cho browser workflow/profile khác, native file picker hoặc selector picker
tranh foreground. Selector legacy và pipeline upload/download giữ behavior cũ.
Stop/revoke chỉ dừng run/quyền sở hữu; không kill Chrome hay đóng profile người dùng.

## API và compatibility

Thao tác mới là **protocol 2** `openProfile`, params duy nhất `{profile}`,
`POST /api/v2/profiles/open` với Bearer + grant/instance/fence. Cụm “API v1” trong
prompt WFI-05 được thực hiện bằng v2 theo contract đã triển khai; không mở bypass
v1 trong integrated mode hoặc relay tùy ý `/api/profiles/open` từ web.
Engine cũ được attach theo WFI-04; chỉ engine quảng bá openProfile mới bật nút.
Extension cũ cần nâng 4.4.0 để chạy web trên engine 0.4.0; không fallback bỏ bind.
Standalone/legacy vẫn riêng, không coi là quyền remote integrated.

Permissions giữ nguyên: debugger cho input/file chooser, tabs/scripting cho tab/
DOM/selectors, storage cho profile/client/port, alarms cho MV3. HTTP/HTTPS host
permissions rộng phục vụ scenario website và loopback; không thêm permission mới.
Debugger target “attached” có thể thuộc DevTools; worker phải tự attach hoặc
chứng minh session của chính extension bằng lệnh đọc trước khi dispatch input.

## Kiểm chứng

`npm test`, `npm run build`, `npm run test:browser -w @rca/workflow-engine`,
`node --test backend/test/browser/workflow-health.test.js`.
E2E mới dùng unpacked extension thật, Chromium Playwright/persistent temp profile,
engine temp và HTTPS fixture loopback, không post/upload website thật. Chromium
được dùng cho sideload theo [Playwright](https://playwright.dev/docs/chrome-extensions).
TLS bypass/host mapping chỉ nằm trong test fixture, không vào production flags.
Test TLS fixture cần openssl (Windows: Git for Windows cung cấp).
Xem [VALIDATION](VALIDATION.md) về kết quả và phần chưa nghiệm thu tại máy nhà/VPS.

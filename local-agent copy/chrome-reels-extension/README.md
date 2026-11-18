# Chrome Workflow Bridge 4.4.0

Source extension MV3 dựa trên snapshot tham chiếu của người dùng;
provenance lưu tại `../workflow-engine/PROVENANCE.json`. Không chứa token API.

Bản 4.4.0 gửi settlementVersion=1 và chỉ báo settled khi content script hết busy,
debugger input hoàn tất. Mất port không được coi là tác vụ đã dừng. Integrated
engine từ chối bước web với extension cũ. Sau cập nhật cần Reload extension và
refresh các trang Chrome cũ; không chỉ restart engine.

1. Chạy engine trên máy local tại `http://127.0.0.1:34719`.
2. Trong profile Chrome muốn dùng, mở `chrome://extensions`, bật Developer mode,
   Load unpacked thư mục này. Không dùng profile người dùng để test tự động.
3. Mở Options, chọn đúng thư mục profile. Chờ dashboard engine báo extension
   connected; việc Chrome đang mở không chứng minh extension sẵn sàng.

Quyền: debugger (nhập/file chooser), tabs/scripting (tab và DOM), storage
(profile/clientId), alarms (poll MV3). Website permissions HTTP/HTTPS giữ theo
source, không có quyền mới trong WFI-02. Extension kết nối loopback cố định.

Đóng ZIP từ root core bằng `npm run package:extension`, hoặc tại đây:

```powershell
powershell -NoProfile -File package.ps1
```

Gói trong dist chỉ gồm manifest.json, background.js, content.js, options.html,
options.js; không tự publish/cài extension hoặc ký CRX. Cài extension thủ công là
bước riêng, chưa có Chrome supervisor trong WFI-02.

WFI-05: see `docs/WORKFLOW_CHROME.md` in the core repo. In Options, enter the engine port (default 34719), discover profiles, select the actual Chrome profile and save. 4.4.0 uses readinessVersion=1 binding and worker nonce; engine 0.4.0 requires this for integrated web runs. No API token is stored in the extension. Host/permissions remain unchanged.

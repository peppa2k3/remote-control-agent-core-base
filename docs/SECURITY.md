# Quy tắc bảo mật

WFI-07: lookup requestId bắt buộc cookie + membership hiện tại và lọc requestedBy
theo user đăng nhập; không cấp lại quyền execute. Browser chỉ lưu hash/requestId/
jobId trong sessionStorage, không payload/credential; logout xóa metadata này.
Schema biến là policy allowlist, private defaults không chuyển lên UI. Validation
UI không thay validation/RBAC/lease engine/backend. Xem [WORKFLOW_FRONTEND](WORKFLOW_FRONTEND.md).

WFI-03 integrated mode có local allowlist/hash/schema, grant pin device/user/
browser/session/instance, fence bền vững, expiry monotonic và watchdog. API v1 và
Bearer trên API dashboard không bypass grant trong mode này. HTTP polling cũ
không khởi tạo; remote.json chỉ được kiểm tra tồn tại, không đọc secret.
Takeover giữ barrier đến receipt quiescent; extension 4.3.0 xác minh content idle
và debugger inputs, không coi port lỗi là dừng. Run chưa xác minh sau restart giữ
unknown; không tự replay/nhả khóa. Source standalone/protocol 1 vẫn là legacy.
Dashboard local/Remote Terminal/quyền OS là quản trị ngoài policy, không bảo đảm
desktop hoặc mọi automation độc quyền. Xem [WORKFLOW_GRANTS](WORKFLOW_GRANTS.md).

WFI-02 đưa engine/extension vào source local; HTTP polling control-server cũ bị
ngắt tại bootstrap và không đọc credential remote cũ. Engine giữ dashboard/API
v1 local, chưa có local policy/grant/watchdog v2; không quảng bá bản đóng gói là
đã enforce dừng workflow accepted theo lease. Export chỉ đọc manifest file rõ
ràng, không quét runtime; dependency dev/Chrome/media không vào gói runtime VPS.

## Đã có trong core
- User login bằng mật khẩu scrypt salted; cookie HttpOnly + SameSite=Strict; bật Secure khi HTTPS.
- Strict Origin cho mutation và browser socket; rate limit login/pairing/general API.
- Device pairing code entropy 256-bit, TTL 5 phút, one-use transaction. Device credential opaque, hash trong DB; console local xác nhận enrollment server.
- Server kiểm tra quyền mỗi thao tác lease; ACK bắt buộc từ device socket; nonce/sessionId/TTL chống ACK cũ. Lease khóa cả pending và active.
- Token hết hạn được sweep; logout ngắt browser của login tương ứng; revoke member/device dừng phiên.
- Status thiết bị chỉ nhận trên socket runner đã xác thực credential; server xác định deviceId từ socket, kiểm tra từng giá trị và giới hạn gửi tối đa 1 lần/giây. Dữ liệu status không có command, path hay nội dung do frontend cung cấp và không được lưu/audit lâu dài.
- Core không nhận manifest hoặc code script tùy ý; workflow bridge gọi scenario đã lưu qua API engine riêng.
- Remote Terminal là luồng riêng: input CMD/PowerShell được nhận khi owner/operator giữ active lease đúng browser socket. Backend bind terminal vào userId/browserId/deviceId/sessionId, chỉ relay output về browser đó, giới hạn một PTY/device, kích thước input/output và thời lượng; command/output không persist hoặc audit. Release/revoke/expiry/offline/disconnect yêu cầu đóng PTY; slot chỉ được nhả sau xác nhận exit từ agent.
- Terminal chỉ chạy qua outbound Socket.IO agent đã pairing, không mở HTTP listener/inbound port tại máy nhà. Chạy Local Runner bằng tài khoản Windows thường để CMD/PowerShell không thừa quyền Administrator; đóng AutoRun/profile khi khởi chạy.

## Trước khi dùng với máy thật
HTTPS hợp lệ; PUBLIC_ORIGIN đúng domain; COOKIE_SECURE=true. Chỉ reverse proxy tin cậy được đi tới backend khi TRUST_PROXY=true. App không publish host port. Hạn chế quyền của mọi container trên network edge đang dùng chung.
Credential local file phải ACL chỉ tài khoản vận hành (Unix mode 600; Windows chỉnh NTFS ACL). Chạy Local Runner bằng user thường. Mất credential: owner thu hồi thiết bị, pairing lại. Không đưa .env/credentials có đường dẫn nhạy cảm vào Git.
AUTO_APPROVE_SESSIONS=true phù hợp máy unattended nhưng cần owner/operator đã duyệt; mặc định hỏi từng phiên. Không có MFA, brute-force theo tài khoản, invite email, device key rotation/mTLS ở bản core; prompt 002/007 bổ sung.

## Remote desktop không bypass
Không cấp ordinary users tài khoản MeshCentral có quyền desktop trực tiếp trước Step 03. Admin hạ tầng vẫn là break-glass ngoài policy của app; audit và mô tả rõ ngoại lệ. Muốn bảo đảm tuyệt đối với mọi tài khoản phải kiểm soát cả admin/MeshCentral relay.

## Thực thi chương trình local

Workflow bridge kiểm tra active lease ở cả backend và runner, chỉ relay operation
cố định tới HTTP loopback với token không rời máy local. Chỉ gọi scenario đã lưu;
frontend không gửi shell, steps, API URL hoặc uploadPath. Xem [WORKFLOW](WORKFLOW.md)
về retry, giới hạn và hành vi workflow sau khi mất phiên.
Không nhận code script tùy ý qua API/Socket.IO. Workflow scenario dùng bridge
giới hạn ở trên; Remote Terminal là luồng riêng, chịu các ràng buộc lease và PTY.

# WFI-04: process supervisor (2026-11-12)

Managed child chỉ được spawn bởi runner từ Node/entrypoint/cwd cố định với env
allowlist và shell=false. Token đọc từ engine env riêng, kiểm tra NTFS ACL bằng
SID (hoặc POSIX mode 600), không rotate engine đang chạy. IPC nonce + HTTP instance
phải khớp trước readiness; shutdown chỉ child sở hữu. Khóa SQLite chống hai
controller/engine ghi chung runtime, không kill chủ port không rõ ownership.
Health đến VPS chỉ gồm metadata được chọn và thời gian nhận tại server; member
filter/freshness không bị thay thế bởi runner heartbeat. Crash/thiếu receipt giữ
unknown/barrier và không replay. Engine readiness không xác nhận phiên Windows
tương tác. Xem [WORKFLOW_SUPERVISOR](WORKFLOW_SUPERVISOR.md).

## WFI-05 — Chrome

Frontend chỉ chọn profile ID trong catalog, quyền luôn kiểm tra backend + engine
grant/policy allowOpen. Executable/userDataDir/startup URL/argv/env chỉ do local
trusted config chọn; child Chrome không nhận device/token/Mongo credential.
Không tự cài extension, sửa Preferences/Secure Preferences hay kill Chrome khi
mất lease. Worker nonce pin profile/client/worker; thiếu heartbeat không ready.
Options chọn profile bằng user local, không phải OS profile attestation. Broad
HTTP/HTTPS/debugger permissions giữ nguyên và được giải thích trong hướng dẫn.
Foreground serialization không bảo đảm độc quyền desktop trước OS/terminal/local
admin/extension khác. Session 0 bị chặn khi openProfile; các session khác vẫn cần
desktop tương tác đúng user. Xem [WORKFLOW_CHROME](WORKFLOW_CHROME.md).
## WFI-06 — durable jobs

Unique device/user/requestId + canonical command fingerprint chống key reuse và
rebind sang session/grant khác. Authority kiểm tra trước dispatch và sau response;
reports không tạo execution hoặc lease. Backend chỉ nhận metadata allowlist có
instance/fence/seq/size/rate cap, không variables/path/raw errors. ACK sau commit;
terminal conflict không được ghi lùi. Cancel trước delivery là tombstone bền vững.
Không purge unknown/nonquiescent/unacked, không tự bỏ barrier hoặc replay sau
restart. Journal cạnh credential và engine runtime cần thư mục private ACL;
không lưu token/credential/payload trong ledger VPS. History dùng current
membership, không trả requestedBy/browser/fingerprint. Xem [WORKFLOW_JOBS](WORKFLOW_JOBS.md).

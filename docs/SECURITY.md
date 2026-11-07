# Quy tắc bảo mật
## Đã có trong core
- User login bằng mật khẩu scrypt salted; cookie HttpOnly + SameSite=Strict; bật Secure khi HTTPS.
- Strict Origin cho mutation và browser socket; rate limit login/pairing/general API.
- Device pairing code entropy 256-bit, TTL 5 phút, one-use transaction. Device credential opaque, hash trong DB; console local xác nhận enrollment server.
- Server kiểm tra quyền mỗi thao tác lease; ACK bắt buộc từ device socket; nonce/sessionId/TTL chống ACK cũ. Lease khóa cả pending và active.
- Token hết hạn được sweep; logout ngắt browser của login tương ứng; revoke member/device dừng phiên.
- Status thiết bị chỉ nhận trên socket runner đã xác thực credential; server xác định deviceId từ socket, kiểm tra từng giá trị và giới hạn gửi tối đa 1 lần/giây. Dữ liệu status không có command, path hay nội dung do frontend cung cấp và không được lưu/audit lâu dài.
- Không executor shell/code trong core. Local không mở HTTP listener/inbound port.

## Trước khi dùng với máy thật
HTTPS hợp lệ; PUBLIC_ORIGIN đúng domain; COOKIE_SECURE=true. Chỉ reverse proxy tin cậy được đi tới backend khi TRUST_PROXY=true. App không publish host port. Hạn chế quyền của mọi container trên network edge đang dùng chung.
Credential local file phải ACL chỉ tài khoản chạy agent (Unix mode 600; Windows chỉnh NTFS ACL). Chạy local runner bằng user thường. Mất credential: owner thu hồi thiết bị, pairing lại. Không đưa .env/credentials/data backup vào Git.
AUTO_APPROVE_SESSIONS=true phù hợp máy unattended nhưng cần owner/operator đã duyệt; mặc định hỏi từng phiên. Không có MFA, brute-force theo tài khoản, invite email, device key rotation/mTLS ở bản core; prompt 002/007 bổ sung.

## Remote desktop không bypass
Không cấp ordinary users tài khoản MeshCentral có quyền desktop trực tiếp trước Step 03. Admin hạ tầng vẫn là break-glass ngoài policy của app; audit và mô tả rõ ngoại lệ. Muốn bảo đảm tuyệt đối với mọi tài khoản phải kiểm soát cả admin/MeshCentral relay.

## Executor tương lai
Mỗi job có deviceId/sessionId/fencing token, scriptId, params theo schema, TTL và idempotency key. Runner chỉ chạy khi đúng lease active, allowlist script local, quyền/path rõ ràng. Takeover phải dừng job cũ và chờ local xác nhận đã dừng trước khi job mới bắt đầu; nếu không dừng được thì giữ máy unavailable. Giới hạn output, time, concurrency=1; không nhận command string. Job nguy hiểm cần policy riêng; không tự chạy AI-generated code.

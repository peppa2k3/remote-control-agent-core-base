# Quy tắc bảo mật
## Đã có trong core
- User login bằng mật khẩu scrypt salted; cookie HttpOnly + SameSite=Strict; bật Secure khi HTTPS.
- Strict Origin cho mutation và browser socket; rate limit login/pairing/general API.
- Device pairing code entropy 256-bit, TTL 5 phút, one-use transaction. Device credential opaque, hash trong DB; console local xác nhận enrollment server.
- Server kiểm tra quyền mỗi thao tác lease; ACK bắt buộc từ device socket; nonce/sessionId/TTL chống ACK cũ. Lease khóa cả pending và active.
- Token hết hạn được sweep; logout ngắt browser của login tương ứng; revoke member/device dừng phiên.
- Status thiết bị chỉ nhận trên socket runner đã xác thực credential; server xác định deviceId từ socket, kiểm tra từng giá trị và giới hạn gửi tối đa 1 lần/giây. Dữ liệu status không có command, path hay nội dung do frontend cung cấp và không được lưu/audit lâu dài.
- Core không nhận manifest script, catalog script, scriptId hay params để chạy chương trình trên Local Runner.
- Remote Terminal là luồng riêng: input CMD/PowerShell được nhận khi owner/operator giữ active lease đúng browser socket. Backend bind terminal vào userId/browserId/deviceId/sessionId, chỉ relay output về browser đó, giới hạn một PTY/device, kích thước input/output và thời lượng; command/output không persist hoặc audit. Release/revoke/expiry/offline/disconnect yêu cầu đóng PTY; slot chỉ được nhả sau xác nhận exit từ agent.
- Terminal chỉ chạy qua outbound Socket.IO agent đã pairing, không mở HTTP listener/inbound port tại máy nhà. Chạy Local Runner bằng tài khoản Windows thường để CMD/PowerShell không thừa quyền Administrator; đóng AutoRun/profile khi khởi chạy.

## Trước khi dùng với máy thật
HTTPS hợp lệ; PUBLIC_ORIGIN đúng domain; COOKIE_SECURE=true. Chỉ reverse proxy tin cậy được đi tới backend khi TRUST_PROXY=true. App không publish host port. Hạn chế quyền của mọi container trên network edge đang dùng chung.
Credential local file phải ACL chỉ tài khoản vận hành (Unix mode 600; Windows chỉnh NTFS ACL). Chạy Local Runner bằng user thường. Mất credential: owner thu hồi thiết bị, pairing lại. Không đưa .env/credentials có đường dẫn nhạy cảm vào Git.
AUTO_APPROVE_SESSIONS=true phù hợp máy unattended nhưng cần owner/operator đã duyệt; mặc định hỏi từng phiên. Không có MFA, brute-force theo tài khoản, invite email, device key rotation/mTLS ở bản core; prompt 002/007 bổ sung.

## Remote desktop không bypass
Không cấp ordinary users tài khoản MeshCentral có quyền desktop trực tiếp trước Step 03. Admin hạ tầng vẫn là break-glass ngoài policy của app; audit và mô tả rõ ngoại lệ. Muốn bảo đảm tuyệt đối với mọi tài khoản phải kiểm soát cả admin/MeshCentral relay.

## Thực thi chương trình local
Không có API hoặc Socket.IO event để yêu cầu Local Runner khởi chạy script. Remote Terminal là luồng riêng, chịu các ràng buộc lease và PTY ở trên.

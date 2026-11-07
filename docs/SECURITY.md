# Quy tắc bảo mật
## Đã có trong core
- User login bằng mật khẩu scrypt salted; cookie HttpOnly + SameSite=Strict; bật Secure khi HTTPS.
- Strict Origin cho mutation và browser socket; rate limit login/pairing/general API.
- Device pairing code entropy 256-bit, TTL 5 phút, one-use transaction. Device credential opaque, hash trong DB; console local xác nhận enrollment server.
- Server kiểm tra quyền mỗi thao tác lease; ACK bắt buộc từ device socket; nonce/sessionId/TTL chống ACK cũ. Lease khóa cả pending và active.
- Token hết hạn được sweep; logout ngắt browser của login tương ứng; revoke member/device dừng phiên.
- Status thiết bị chỉ nhận trên socket runner đã xác thực credential; server xác định deviceId từ socket, kiểm tra từng giá trị và giới hạn gửi tối đa 1 lần/giây. Dữ liệu status không có command, path hay nội dung do frontend cung cấp và không được lưu/audit lâu dài.
- Script chỉ chạy từ allowlist cục bộ; browser gửi `scriptId` và params theo schema, server kiểm tra owner/operator + active lease rồi runner kiểm tra lại. Runner dùng `spawn` với executable/args/cwd cấu hình local, `shell:false`, giới hạn output/thời gian và không kế thừa các biến PAIR_CODE/credential config. File param là option ID được map sang file trong cwd, không nhận path từ browser.
- Không nhận hoặc thực thi shell/code tùy ý từ frontend. Local không mở HTTP listener/inbound port.

## Trước khi dùng với máy thật
HTTPS hợp lệ; PUBLIC_ORIGIN đúng domain; COOKIE_SECURE=true. Chỉ reverse proxy tin cậy được đi tới backend khi TRUST_PROXY=true. App không publish host port. Hạn chế quyền của mọi container trên network edge đang dùng chung.
Credential local file và `data/scripts.json` phải ACL chỉ tài khoản vận hành (Unix mode 600; Windows chỉnh NTFS ACL). Chạy Local Runner bằng user thường; script chạy với đúng quyền đó. Mất credential: owner thu hồi thiết bị, pairing lại. Không đưa .env/credentials/local manifests có đường dẫn nhạy cảm vào Git.
AUTO_APPROVE_SESSIONS=true phù hợp máy unattended nhưng cần owner/operator đã duyệt; mặc định hỏi từng phiên. Không có MFA, brute-force theo tài khoản, invite email, device key rotation/mTLS ở bản core; prompt 002/007 bổ sung.

## Remote desktop không bypass
Không cấp ordinary users tài khoản MeshCentral có quyền desktop trực tiếp trước Step 03. Admin hạ tầng vẫn là break-glass ngoài policy của app; audit và mô tả rõ ngoại lệ. Muốn bảo đảm tuyệt đối với mọi tài khoản phải kiểm soát cả admin/MeshCentral relay.

## Script runner hiện tại và jobs tương lai
Script hiện tại có deviceId/sessionId/jobId, scriptId local và params theo schema; mỗi máy chạy tối đa một script, output bị giới hạn 64KiB, timeout cấu hình tối đa 1 giờ. Lease revoke/takeover/offline sẽ gửi stop và giữ job trong memory đến khi runner xác nhận đã dừng; yêu cầu lease mới bị từ chối trong lúc đó. Jobs queue/history/idempotency/fencing đầy đủ vẫn là phần sau; không nhận command string và không tự chạy AI-generated code.

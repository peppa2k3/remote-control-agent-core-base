# Remote Control Agent — Core Starter 0.1
Website điều phối các máy ở nhà qua VPS, hiển thị kết nối realtime, chia sẻ quyền và cấp phiên điều khiển độc quyền có handshake. Windows/Linux là mục tiêu local; Node.js 24 là runtime.

## Có gì trong source?
- React/Vite giao diện login, danh sách máy, online/offline Local Runner, tạo mã pairing, yêu cầu/kết thúc phiên, owner takeover, cấp viewer/operator, thu hồi thiết bị, chạy script allowlist và mở Remote Terminal.
- Express + Socket.IO: cookie HttpOnly, SQLite lưu users/devices/members/pairing/lease/audit, xác thực socket, heartbeat, ACK local, timeout, revoke.
- Local Runner kết nối outbound tới VPS, ghép cặp một lần có xác nhận console, reconnect, xác nhận yêu cầu điều khiển, gửi CPU/RAM/lưu lượng mạng và chạy script đã cấu hình cục bộ. Trên Windows, Local Runner có thể mở CMD/PowerShell PTY cho browser đang giữ active lease.
- Docker/Traefik cho app, Dockerfile + cấu hình mẫu MeshCentral độc lập, hướng dẫn cài MeshCentral Agent.
- Tài liệu kiến trúc, mô hình dữ liệu, bảo mật, API và 8 prompt phát triển tuần tự.

**Chưa có:** adapter đọc trạng thái MeshCentral vào FE, desktop nhúng và cưỡng chế lease qua MeshCentral, queue/history đầy đủ, voice/LLM, installer Windows. Script vẫn chạy theo allowlist local. Remote Terminal là phiên tương tác riêng, chỉ trên Windows, cần quyền owner/operator và active lease; lệnh chạy bằng quyền tài khoản Windows của Local Runner. Không ghi nội dung lệnh hay output vào DB. Status và job/output hiện chỉ ở bộ nhớ backend, không thay thế trạng thái MeshCentral. Giao diện ghi rõ MeshCentral chưa tích hợp. Không gọi bản này là production hoàn chỉnh.

## Công nghệ
| Phần | Công nghệ | Vai trò |
|---|---|---|
| Website | React + Vite + CSS | Dashboard điều phối; deploy static cùng Express để cùng origin |
| Backend VPS | Node.js 24, Express 5, Socket.IO 4 | Auth/RBAC, registry, lease, realtime |
| Database app | SQLite WAL qua node:sqlite | Starter nhẹ, một backend process; không cần MongoDB có AVX |
| Máy nhà | Local Runner Node.js + socket.io-client + node-pty | Heartbeat, handshake, status, script allowlist và Windows CMD/PowerShell PTY qua Socket.IO |
| Quản trị từ xa | MeshCentral Server + MeshCentral Agent | Desktop/terminal/files; tích hợp app ở Step 03 |
| Deploy | Docker Compose + Traefik có HTTPS | App domain và MeshCentral domain riêng |

Không mở port trên router nhà: hai agent chủ động kết nối ra VPS. Web client không kết nối trực tiếp tới IP nhà.

## Chạy trên máy phát triển (Windows PowerShell hoặc Linux)
Cài Node.js 24.x + npm. Giải nén và mở terminal ở thư mục repo.
```sh
npm ci
```
1. Copy `backend/.env.example` thành `backend/.env`; điền SEED_EMAIL/SEED_PASSWORD (ít nhất 12 ký tự), giữ PUBLIC_ORIGIN=http://localhost:5173.
2. Tạo tài khoản owner:
```sh
npm run seed -w backend
```
3. Hai terminal riêng:
```sh
npm run dev:backend
```
```sh
npm run dev:frontend
```
4. Mở **http://localhost:5173** và đăng nhập. Không đổi sang 127.0.0.1 ở browser vì Origin/cookie được kiểm tra.
5. Tạo mã ghép cặp. Copy `local-agent/.env.example` thành `local-agent/.env`, đặt PAIR_CODE=mã vừa tạo. Để khai báo các option chạy script, copy `local-agent/scripts.example.json` thành `local-agent/data/scripts.json`, rồi sửa executable, cwd cố định, args và choices phù hợp máy đó. Ví dụ mẫu nhận scenario, profile, file variables chọn từ allowlist và checkbox `--wait`.
6. Terminal thứ ba:
```sh
npm run agent
```
Gõ YES trên máy local để xác nhận ghép cặp; xóa PAIR_CODE sau khi thành công. Web cập nhật online sau khi socket xác thực và hiện các option từ `scripts.json`.
Runner gửi status CPU, RAM, tải mạng xuống/lên và uptime mỗi 10 giây theo mặc định. Có thể đổi `STATUS_INTERVAL_SECONDS` trong `local-agent/.env` từ 5 đến 60 giây. Linux bỏ loopback khi cộng bộ đếm adapter; Windows cộng các adapter được `Get-NetAdapterStatistics` trả về. Adapter ảo/VPN có thể được tính vào.
7. Web chọn Yêu cầu điều khiển; gõ YES trên console local trong 20 giây. Phiên chuyển pending → active. Chọn script đã cấu hình và nhập params, hoặc mở Remote Terminal để dùng CMD/PowerShell trên Windows. Terminal chỉ mở một phiên mỗi máy, tự đóng khi lease mất/hết hạn, idle 10 phút hoặc đạt tối đa 30 phút. Chạy Local Runner bằng tài khoản Windows thường, không phải Administrator.

Tạo user thứ hai: sửa SEED_EMAIL/SEED_PASSWORD/SEED_NAME trong backend/.env, chạy seed lần nữa (không thay mật khẩu tài khoản đã có). Owner cấp quyền theo email trên dashboard. Dùng browser/profile khác để kiểm tra tranh chấp phiên; owner có nút lấy quyền.

## Chạy không cần Vite
Đặt PUBLIC_ORIGIN=http://localhost:4000, chạy `npm run build` rồi `npm start`, mở http://localhost:4000. Express phục vụ frontend/dist. Restart backend khi đổi env.

## Máy nhà thật kết nối VPS
Cài Node 24 trên máy nhà, copy repo, `npm ci`; đặt SERVER_URL=https://remote.tenmien.vn trong local-agent/.env. Ghép cặp từ dashboard VPS và chạy runner. TLS phải hợp lệ; không dùng NODE_TLS_REJECT_UNAUTHORIZED=0.
- MeshCentral Agent là chương trình riêng tải từ MeshCentral của chính bạn (docs/MESHCENTRAL.md).
- Chạy 24/24: hoàn thành pairing trong console trước; bật AUTO_APPROVE_SESSIONS=true **chỉ khi muốn máy tự chấp nhận user đã được owner cấp quyền**. Điều này bỏ câu hỏi mỗi phiên, không bỏ auth/RBAC/nonce/lease.
- Linux dùng mẫu systemd; Windows dùng Task Scheduler, đọc docs/LOCAL_SERVICE.md. Máy cần tắt sleep/hibernate nếu muốn luôn online.

## Kiểm tra
```sh
npm test
npm run build
```
Xem docs/VALIDATION.md về phạm vi đã kiểm tra và các bước cần test trên VPS/Windows thật.

## Deploy và tiếp tục coding
- docs/DEPLOY.md: app lên VPS đang có Traefik.
- docs/MESHCENTRAL.md: MeshCentral độc lập và giới hạn tích hợp.
- docs/prompts/planned/001-core-base.md là prompt đầu tiên để AI đọc repo, kiểm tra và hoàn thiện core.
- docs/PROMPT_INDEX.md: thứ tự 001 → 008; không chạy tất cả một lượt.

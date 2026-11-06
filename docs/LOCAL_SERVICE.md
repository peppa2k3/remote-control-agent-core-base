# Chạy Local Runner 24/24
Hoàn thành pairing tương tác trước khi làm service. Credential đã lưu trong local-agent/data/credentials.json, không đặt lại mã pairing mỗi lần boot. .env ghi SERVER_URL đúng, AUTO_APPROVE_SESSIONS=true chỉ khi chấp nhận unattended control cho user được cấp quyền. Nếu false, chạy console tương tác; service background không có người trả lời sẽ timeout và không có phiên active.

## Windows
Dùng Task Scheduler tạo task với user Windows thường sở hữu credentials:
- Trigger At startup hoặc At log on (tùy có cần interactive desktop ở Step 04).
- Action: đường dẫn đầy đủ node.exe. Arguments: `--env-file=.env src/index.js`.
- Start in: đường dẫn tuyệt đối tới local-agent.
- Không chọn highest privileges nếu không cần; cấu hình restart on failure, restart mỗi 1 phút và không tự stop sau 3 ngày.
- Với unattended chọn Run whether user is logged on or not, nhưng app UI/Chrome automation không chạy vào desktop đang đăng nhập từ session background. Step 04 phải có executor ở user interactive session hoặc browser headless.
- Bảo vệ .env và data bằng NTFS ACL, loại quyền read của Users nếu không cần. Kiểm tra reboot thật.
Script start-agent.ps1 để chạy tương tác, không tự cài task. MeshCentral Agent cài bằng installer riêng.

## Linux
Tạo user rca, đặt repo tại /opt/remote-control-agent, cấp quyền tối thiểu cho rca đọc code và ghi local-agent/data. Cài Node 24 từ nguồn tin cậy; sửa ExecStart nếu node không ở /usr/bin/node. Cài dependencies từ root repo bằng npm ci trước.
Copy scripts/systemd.example.service vào /etc/systemd/system/rca-local.service rồi:
```sh
sudo systemctl daemon-reload
sudo systemctl enable --now rca-local
sudo systemctl status rca-local
journalctl -u rca-local -n 50
```
Mẫu chưa được chạy systemd thật ở môi trường này. Chỉ chạy core heartbeat/handshake; runner scripts desktop sau này cần môi trường DISPLAY/session phù hợp.

## Lưu ý kết nối
Sleep/hibernate hoặc mất điện = offline. Wake-on-LAN qua Internet không tự có; không đưa vào core. Khi rớt mạng, runner reconnect backoff, socket mới handshake lại. Secret bị thu hồi không tự pair lại; owner phải tạo mã mới và local xác nhận lại.

# 004- Remote Terminal – CMD / PowerShell qua Web

## Mục tiêu
Xây dựng tính năng Remote Terminal cho phép người dùng điều khiển CMD/PowerShell thực trên máy Windows thông qua giao diện web của project localbot-vps. Terminal hoạt động tương tác hai chiều, realtime, sử dụng Windows Local Agent làm nơi thực thi lệnh.

## Phạm vi
`/backend`, `/frontend`, `/local-agent`, docs và tests.

## Công nghệ và nguyên tắc triển khai
- Frontend: xterm.js, @xterm/addon-fit, @xterm/addon-web-links.
- Backend: Express, Socket.IO hoặc cơ chế WebSocket hiện có.
- Local Agent: Node.js, node-pty để tạo và quản lý tiến trình CMD/PowerShell.
- Tận dụng authentication, device pairing, heartbeat và realtime infrastructure hiện tại.
- Không cài node-pty trên VPS Backend; tiến trình Terminal phải chạy trên Windows Agent.
- Không dùng child_process.exec để thay thế Terminal tương tác.
- Không tự tạo MeshCentral endpoint/event nếu chưa có căn cứ từ source hiện tại.
- Thiết kế module độc lập, dễ mở rộng và bảo trì.

## Hành vi
1. Người dùng chọn thiết bị Windows Online và mở Remote Terminal.
2. Backend xác thực tài khoản, quyền truy cập thiết bị và tạo Terminal Session.
3. Local Agent nhận yêu cầu đã xác thực, tạo tiến trình CMD hoặc PowerShell bằng node-pty.
4. Frontend hiển thị Terminal bằng xterm.js.
5. Hỗ trợ truyền input/output hai chiều realtime, lệnh liên tục, nhiều dòng, Ctrl+C, copy/paste và resize.
6. Hiển thị trạng thái Connecting, Connected, Disconnected, Error.
7. Cho phép đóng phiên và kết thúc tiến trình Terminal tương ứng.
8. Xử lý timeout, mất kết nối, Agent Offline và cleanup tiến trình mồ côi.
9. Mỗi thiết bị chỉ có một người điều khiển Terminal tại một thời điểm.
10. Ghi audit log về người điều khiển, thiết bị, thời gian mở/đóng phiên và trạng thái; không mặc định lưu nội dung lệnh hoặc output.

## Bảo mật
- Agent chủ động kết nối VPS qua kết nối outbound WSS, không mở port CMD trên Windows.
- Xác thực và phân quyền ở cả bước tạo session và từng thao tác Terminal.
- Kiểm tra quyền sở hữu/quản lý thiết bị trước khi cấp session.
- Mỗi session có ID/token riêng, thời hạn và cơ chế thu hồi.
- Không cho phép thiết bị hoặc tài khoản khác sử dụng session trái phép.
- Chạy Agent bằng tài khoản Windows có quyền tối thiểu cần thiết, không mặc định Administrator.
- Giới hạn số session, thời gian không hoạt động và kích thước dữ liệu truyền.
- Có cơ chế đóng session và kill process an toàn.
- Không coi blacklist lệnh là biện pháp bảo mật đầy đủ.
- Không ghi secret, mật khẩu hoặc token vào log.

## Tiêu chí hoàn tất
- Mở Terminal từ website và thực thi được lệnh trên đúng máy Windows.
- CMD/PowerShell hoạt động tương tác liên tục.
- Kiểm thử `hostname`, `ipconfig`, `ping -t`, Ctrl+C và lệnh nhiều dòng.
- Input/output realtime, không phải cơ chế gửi từng lệnh độc lập.
- Copy/paste, resize và trạng thái kết nối hoạt động.
- Xử lý được Agent Offline, mất WebSocket, timeout và đóng trình duyệt.
- Không để lại tiến trình CMD/PowerShell mồ côi sau khi đóng session.
- Ngăn chặn truy cập trái phép và điều khiển đồng thời.
- Có unit tests, integration tests và cập nhật tài liệu.
- Kiểm tra tương thích node-pty với phiên bản Node.js và Windows mục tiêu; ghi rõ giới hạn nền tảng nếu có.

## Kết quả
Source + tests + docs/progress + evidence thực tế; nêu rõ giới hạn và bước nào chưa xác minh.

Báo cáo cuối cùng gồm:
- Các file đã tạo/sửa.
- Kiến trúc và luồng hoạt động đã triển khai.
- Các tests đã chạy và kết quả thực tế.
- Evidence thực tế nếu có.
- Các giới hạn, lỗi còn tồn tại và bước chưa xác minh.
- Cập nhật `docs/PROGRESS.md` và tài liệu liên quan.

## Quy tắc chung
Đọc `AGENTS.md`, `README.md`, `docs/AI_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md` và `docs/PROGRESS.md`. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint/event. Không thêm stack nặng nếu chưa cần. Không sửa `.env` thật hoặc đưa secret vào commit. Không tự deploy lên VPS thật khi chỉ được yêu cầu coding.
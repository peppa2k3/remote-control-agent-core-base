# 002 — Quản lý device status
## Mục tiêu
Quản lý  xem được device status trên máy local được kết nối.
## Phạm vi
/backend, /frontend, /local-agent
## Thực hiện
triển khai tính năng quản lý device status trên máy local đc kết nối. FE thấy đc thông số máy, local gửi thông số cho VPS, điều chỉnh đc mức độ realtime hoặc theo x giây/lần gửi status để hạn chế quá tải hệ thống
## Tiêu chí hoàn tất
giao diện mỗi thiết bị có thêm 1 table 2 cột dạng key | value thể hiện % cpu ram rom tốc độ mạng dowload uptime ... những thông số cần cho quản lí
## Kết quả
Source + tests + docs/progress + evidence thực tế; báo rõ limitations.

## Quy tắc chung
Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md và docs/PROGRESS.md. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint hay test result. Không thêm stack nặng nếu chưa cần. Cập nhật env examples/API/docs/test đúng thay đổi; không chạm secrets thật. Chạy npm test + npm run build. Báo changed files, validation và phần chưa kiểm tra; cập nhật tiến độ. Chỉ chuyển prompt vào completed khi mọi tiêu chí hoàn tất và ghi commit nếu được phép commit.

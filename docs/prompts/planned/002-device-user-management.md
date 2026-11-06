# 002 — Quản lý user/device và vòng đời credential
## Mục tiêu
Quản lý user/device và vòng đời credential trên core hiện có.
## Phạm vi
/backend, /frontend, /local-agent, migrations
## Thực hiện
Thêm user creation/invite và owner quản lý membership; viewer/operator; giới hạn owner transfer có xác nhận lại. Bổ sung lastSeen persistent (throttled writes), hostname/OS tối thiểu, revoke/rotate credential có local confirmation, session listing và logout all. Tạo migration versioned; không sửa DB production thủ công. Bổ sung MFA cho tài khoản hoặc bước hardening với giao diện rõ ràng. Thêm local consent policy phân quyền; không để owner là tên/email tự khai.
## Tiêu chí hoàn tất
Owner đổi membership có audit và revoke hiệu lực ngay; user khác không đọc/sửa máy trái phép; restart không mất máy/quyền; credential cũ mất hiệu lực sau rotate; kiểm thử upgrade DB cũ và rollback kế hoạch.
## Kết quả
Source + tests + docs/progress + evidence thực tế; báo rõ limitations.

## Quy tắc chung
Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md và docs/PROGRESS.md. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint hay test result. Không thêm stack nặng nếu chưa cần. Cập nhật env examples/API/docs/test đúng thay đổi; không chạm secrets thật. Chạy npm test + npm run build. Báo changed files, validation và phần chưa kiểm tra; cập nhật tiến độ. Chỉ chuyển prompt vào completed khi mọi tiêu chí hoàn tất và ghi commit nếu được phép commit.

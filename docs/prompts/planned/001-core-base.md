# 001 — Core base: Local ↔ VPS ↔ FE realtime
## Mục tiêu
Hoàn thiện source starter để user đăng nhập dashboard VPS, ghép cặp một/nhiều máy nhà, thấy online/offline realtime và xin phiên điều khiển độc quyền có ACK từ local. Bước này là core kết nối, chưa cần chạy kịch bản hoặc desktop nhúng.
## Công nghệ/phạm vi
/frontend React/Vite, /backend Express/Socket.IO/SQLite, /local-agent Node 24, /infrastructure Docker/Traefik. MeshCentral Server/Agent cài độc lập theo docs; trạng thái Mesh phải ghi not_integrated khi chưa có adapter.
## Thực hiện
1. Audit source; xử lý race/disconnect/auth/TTL/cookie/CORS/input validation, không đổi protocol không cần thiết.
2. Enrollment owner login → mã 256-bit hash/TTL/one-use → xác nhận tại local → cấp credential hash DB, bảo vệ file local. Xác thực socket agent bằng credential riêng.
3. Presence outbound WSS, heartbeat 5s, offline quá 25s, FE snapshot được lọc membership; reconnect full snapshot. FE mất VPS phải unknown/stale, không báo máy local tắt nguồn.
4. Model owner duy nhất + members viewer/operator, users/devices nhiều-nhiều. Viewer không xin control.
5. Lease pending giữ chỗ, active chỉ sau local ACK sessionId+nonce còn TTL; bind user/browser/device. TTL active 45s, renew 10s. Một máy chỉ một pending/active. Owner force revoke phiên cũ; operator không force; owner vẫn phải ACK local hoặc policy auto-approve.
6. Disconnect browser/agent, token expiry, logout, member revoke/downgrade, device revoke và restart đều fail closed. Không nhận credential của device A để ACK device B.
7. Kiểm thử 2 browser + local; bổ sung test cases nonce replay, unauthorized user, pending timeout, simultaneous requests, credential revoked, reconnect, owner takeover.
8. Hoàn thiện hướng dẫn local/VPS/service Windows/Linux. MeshCentral standalone installation không đồng nghĩa app integration.
## Tiêu chí hoàn tất
- npm ci, npm test, npm run build thành công; UI chạy và không lỗi console cơ bản.
- Trên môi trường thật: local nhà kết nối HTTPS VPS, FE thấy online; mất mạng/stop runner đổi offline; mất VPS FE unknown; restart không khôi phục lease cũ.
- Pair code replay/expired bị chặn; user trái phép không thấy thiết bị và không xin quyền.
- Hai operator tranh chấp chỉ một pending/active; owner takeover làm phiên cũ mất quyền ngay, ACK cũ bị từ chối.
- Session không tự active nếu local chưa ACK; unattended mode là lựa chọn explicit, không mặc định bật.
- Không có shell executor và không tuyên bố MeshCentral desktop đã chịu lease.
## Kết quả
Source core, test evidence, docs API/data/deploy/security cập nhật, PROGRESS ghi đúng trạng thái và giới hạn.

## Quy tắc chung
Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md và docs/PROGRESS.md. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint hay test result. Không thêm stack nặng nếu chưa cần. Cập nhật env examples/API/docs/test đúng thay đổi; không chạm secrets thật. Chạy npm test + npm run build. Báo changed files, validation và phần chưa kiểm tra; cập nhật tiến độ. Chỉ chuyển prompt vào completed khi mọi tiêu chí hoàn tất và ghi commit nếu được phép commit.

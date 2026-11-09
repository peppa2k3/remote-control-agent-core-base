# Context dự án
Mục tiêu: máy nhà bật 24/24 chủ động giữ kết nối ra VPS; user đăng nhập web trên máy tính/điện thoại gửi yêu cầu điều khiển. VPS là bên quyết định quyền và điều phối, FE nhận trạng thái realtime.

Một user quản lý nhiều máy, một máy có nhiều user; mỗi máy có đúng một owner, nhiều operator/viewer. Mỗi thời điểm chỉ một phiên active; pending cũng giữ chỗ để tránh tranh chấp. Owner muốn lấy quyền thì phiên cũ bị revoke trước, phiên owner vẫn phải qua ACK local. Operator không được cưỡng chế takeover. Viewer chỉ xem trạng thái.

Hai lớp xác thực:
1. Enrollment: owner đăng nhập tạo mã random 256-bit, TTL 5 phút, dùng một lần; người có mặt tại local xác nhận server và nhập mã; VPS cấp device credential, DB chỉ giữ hash. Mã bị lộ có thể bị người khác dùng trước: chuyển riêng và kiểm tra máy sau pairing.
2. Runtime: user cookie còn hiệu lực, device credential hợp lệ, membership còn quyền, device online; VPS phát offer có sessionId + nonce + TTL; local xác nhận; server mới active. Không cho FE tự ACK.

MeshCentral phục vụ quản trị endpoint; Local Runner phục vụ pairing, status và handshake lease. Kịch bản allowlist trên máy local không thuộc core. Mỗi thành phần có trạng thái riêng: runnerStatus, meshStatus, VPS/API reachability. FE mất kết nối VPS thì trạng thái thiết bị là unknown, không kết luận máy tắt nguồn.

Starter: React/Vite vì dashboard không cần SSR, Express + Socket.IO, SQLite single-process. Có thể chuyển PostgreSQL khi scale bằng prompt riêng; không cần Redis, Kafka, Kubernetes ở bước đầu. Nếu có nhu cầu Next.js, port FE sau core, không đổi protocol.

Kịch bản tương lai: mở website, Playwright test web của mình, đổi tên/sắp xếp file theo allowlist thư mục, upload nội dung. Không nhận tùy ý shell hoặc eval từ web. AI/giọng nói ở giai đoạn sau chỉ tạo kế hoạch JSON qua whitelist, không thực thi command trực tiếp.

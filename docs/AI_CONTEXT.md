# Context dự án
Mục tiêu: máy nhà bật 24/24 chủ động giữ kết nối ra VPS; user đăng nhập web trên máy tính/điện thoại gửi yêu cầu điều khiển. VPS là bên quyết định quyền và điều phối, FE nhận trạng thái realtime.

Một user quản lý nhiều máy, một máy có nhiều user; mỗi máy có đúng một owner, nhiều operator/viewer. Mỗi thời điểm chỉ một phiên active; pending cũng giữ chỗ để tránh tranh chấp. Owner muốn lấy quyền thì phiên cũ bị revoke trước, phiên owner vẫn phải qua ACK local. Operator không được cưỡng chế takeover. Viewer chỉ xem trạng thái.

Hai lớp xác thực:
1. Enrollment: owner đăng nhập tạo mã random 256-bit, TTL 5 phút, dùng một lần; người có mặt tại local xác nhận server và nhập mã; VPS cấp device credential, DB chỉ giữ hash. Mã bị lộ có thể bị người khác dùng trước: chuyển riêng và kiểm tra máy sau pairing.
2. Runtime: user cookie còn hiệu lực, device credential hợp lệ, membership còn quyền, device online; VPS phát offer có sessionId + nonce + TTL; local xác nhận; server mới active. Không cho FE tự ACK.

MeshCentral phục vụ quản trị endpoint; Local Runner phục vụ pairing, status,
handshake lease và workflow bridge tới engine scenario riêng. Generic script
runner/manifest cũ không được khôi phục. Mỗi thành phần có trạng thái riêng:
runnerStatus, meshStatus, VPS/API reachability. FE mất kết nối VPS thì trạng thái
thiết bị là unknown, không kết luận máy tắt nguồn.

Starter: React/Vite vì dashboard không cần SSR, Express + Socket.IO, SQLite single-process. Có thể chuyển PostgreSQL khi scale bằng prompt riêng; không cần Redis, Kafka, Kubernetes ở bước đầu. Nếu có nhu cầu Next.js, port FE sau core, không đổi protocol.

Kịch bản tương lai: mở website, Playwright test web của mình, đổi tên/sắp xếp file theo allowlist thư mục, upload nội dung. Không nhận tùy ý shell hoặc eval từ web. AI/giọng nói ở giai đoạn sau chỉ tạo kế hoạch JSON qua whitelist, không thực thi command trực tiếp.
# Cập nhật WFI-04 — 2026-11-12

Engine 0.3.0 có lifecycle health và IPC shutdown. Runner có supervisor attach
mặc định/managed opt-in; backend/frontend nhận health đã lọc membership, stale
sau 15 giây và offline trả null. Xem [WORKFLOW_SUPERVISOR](WORKFLOW_SUPERVISOR.md).
OpenProfile/extension readiness và durable jobs/report vẫn thuộc WFI-05–08.

## WFI-05 — 2026-11-12

Engine 0.4.0/extension 4.4.0 có openProfile v2 theo grant/allowOpen, Options port
và versioned worker/client binding với heartbeat, foreground lock đến quiescence.
Web cần readiness thật, local-only vẫn riêng; revoke không kill Chrome. Đã có
unpacked MV3 E2E trong Chromium/profile tạm. Xem [WORKFLOW_CHROME](WORKFLOW_CHROME.md).
Nghiệm thu target production tiếp tục thuộc WFI-08.

## WFI-06 — 2026-11-18

Engine 0.5.0 bổ sung durable jobs/correlation trước side effect; adapter journal
SQLite và report seq/ACK về VPS. Retry giữ requestId/fingerprint/grant gốc;
restart chỉ reconcile, không phục hồi lease hoặc replay. Unknown giữ barrier.
History metadata kiểm tra membership hiện tại, retention metadata 30 ngày/key
90 ngày. Xem [WORKFLOW_JOBS](WORKFLOW_JOBS.md) và [VALIDATION](VALIDATION.md).
WFI-08 còn planned; chưa nghiệm thu VPS/WAN hoặc desktop/website thật.

## WFI-07 — 2026-11-18

WorkflowPanel thống nhất health/lease/profile/catalog/run/history; biến theo
policy schema. sessionStorage chỉ giữ requestId/hash/jobId, lookup receipt theo
user/device trước retry; scope đổi hủy UI requests/timers, ACK cũ không ghi state.
Xem [WORKFLOW_FRONTEND](WORKFLOW_FRONTEND.md). WFI-08 chưa nghiệm thu target thật.

# HTTP và realtime
HTTP app cùng origin frontend; mọi mutation của user yêu cầu Origin = PUBLIC_ORIGIN. Cookie rca HttpOnly, SameSite=Strict, Secure trên HTTPS. Body JSON tối đa 16KiB. Error {error}; HTTP 400/401/403/404/409/500.

| Method/path | Input | Quyền/kết quả |
|---|---|---|
| GET /api/health | — | Public, status ok + at |
| POST /api/auth/login | email,password | Cookie 8h; user id/email/name |
| GET /api/auth/me | — | User hiện tại |
| POST /api/auth/logout | {} | Xóa cookie/session và disconnect socket của session đó |
| POST /api/pairing | name | Auth user; code + expiresIn:300 |
| POST /api/agents/enroll | code | Một lần; deviceId + credential; console local cho phép trước khi gọi |
| GET /api/devices | — | Chỉ máy có quyền; runnerStatus, meshStatus, status CPU/RAM/mạng hoặc null, session không có nonce/browserId |
| GET /api/devices/:id/members | — | Owner |
| POST /api/devices/:id/members | email,role viewer/operator | Owner; user phải được seed trước |
| DELETE /api/devices/:id/members/:userId | — | Owner; revoke lease người bị gỡ |
| DELETE /api/devices/:id | — | Owner; thu hồi credential và mọi phiên |
| GET /api/devices/:id/audit | — | Owner; 100 event mới nhất |

Socket.IO path /socket.io. Browser dùng cookie, agent dùng auth {kind:'agent',credential}; server lấy deviceId từ DB, không tin deviceId tự khai.
| Event | Hướng | Payload |
|---|---|---|
| devices:snapshot | VPS → browser | danh sách máy đã lọc quyền |
| agent:ready | VPS → runner | deviceId |
| agent:heartbeat | runner → VPS | {}, ack {ok,at} |
| agent:status | runner → VPS | `{cpuPercent,ramUsedBytes,ramTotalBytes,networkRxBytesPerSecond,networkTxBytesPerSecond,uptimeSeconds}`; ack `{ok,at}` hoặc `{error,status}`. Runner credential xác định thiết bị; server kiểm tra giá trị và giới hạn tối đa 1 report/giây. |
| status trong devices:snapshot | VPS → browser | Cùng sáu trường trên + `updatedAt` (epoch ms), hoặc `null` khi runner offline/chưa báo cáo hay báo cáo cũ hơn 3 phút. Status chỉ lưu trong memory, không persist. |
| session:request | browser → VPS | deviceId, force?; ack pending/sessionId hoặc error/status |
| session:offer | VPS → runner | sessionId,nonce,userId,userName,owner,expires |
| session:ack | runner → VPS | sessionId,nonce,accept:boolean |
| session:active | VPS → browser/runner | sessionId,expires; browser thêm deviceId |
| session:renew | browser → VPS | deviceId,sessionId |
| session:release | browser → VPS | deviceId |
| session:revoked | VPS → browser/runner | sessionId,reason; browser thêm deviceId |

Chưa có jobs API và MeshCentral API bridge. Không gửi credential user/device ở query string.

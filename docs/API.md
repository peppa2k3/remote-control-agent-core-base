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
| GET /api/devices | — | Chỉ máy có quyền; runnerStatus, meshStatus, status CPU/RAM/mạng, `terminalSupported`/`terminalShells`, terminal state không có terminalId/browserId, session không có nonce/browserId |
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
| agent:terminal-capabilities | runner → VPS | `{platform,shells}`; chỉ `win32` cùng shell `cmd`/`powershell` mới được công bố. |
| agent:terminal-state | runner → VPS | Danh sách terminalId/sessionId còn sống sau reconnect; backend xóa trạng thái cũ khi agent xác nhận process đã dừng. |
| terminal:open | browser → VPS → runner | `{deviceId,sessionId,shell,cols,rows}`; owner/operator phải giữ active lease trên đúng browser socket. Mỗi device tối đa một terminal. |
| terminal:opened | runner → VPS → browser | `{terminalId,sessionId,shell,startedAt}`; chỉ browser đã mở session nhận. |
| terminal:input | browser → VPS → runner | `{deviceId,terminalId,sessionId,data}`; tối đa 4KiB mỗi gói và 1MiB mỗi phiên; cần lease còn hiệu lực. Input không được lưu/log. |
| terminal:output | runner → VPS → browser | `{terminalId,sessionId,text}`; tối đa 4KiB mỗi gói, 4MiB mỗi phiên; chỉ browser sở hữu terminal nhận, không persist. |
| terminal:resize | browser → VPS → runner | `{deviceId,terminalId,sessionId,cols,rows}`; cols 20–300, rows 5–120. |
| terminal:close | browser → VPS → runner | `{deviceId,terminalId,sessionId}`; dừng shell, trạng thái giữ đến khi agent báo `terminal:exited`. Revoke, timeout/offline, disconnect và owner takeover cũng yêu cầu đóng. |
| terminal:exited / terminal:error | runner → VPS → browser | Kết quả đóng hoặc lỗi chỉ có metadata; audit không chứa command/output. |
| status trong devices:snapshot | VPS → browser | Cùng sáu trường trên + `updatedAt` (epoch ms), hoặc `null` khi runner offline/chưa báo cáo hay báo cáo cũ hơn 3 phút. Status chỉ lưu trong memory, không persist. |
| session:request | browser → VPS | deviceId, force?; ack pending/sessionId hoặc error/status. Nếu terminal cũ đang dừng, owner cần thử lại sau khi runner xác nhận kết thúc. |
| session:offer | VPS → runner | sessionId,nonce,userId,userName,owner,expires |
| session:ack | runner → VPS | sessionId,nonce,accept:boolean |
| session:active | VPS → browser/runner | sessionId,expires; browser thêm deviceId |
| session:renew | browser → VPS | deviceId,sessionId |
| session:release | browser → VPS | deviceId |
| session:revoked | VPS → browser/runner | sessionId,reason; browser thêm deviceId |

Core không có protocol để chạy script đã cấu hình trên Local Runner. Remote Terminal là luồng riêng qua active lease, giới hạn thời gian/kích thước và chỉ chạy CMD/PowerShell trên Windows bằng quyền OS của Local Runner.

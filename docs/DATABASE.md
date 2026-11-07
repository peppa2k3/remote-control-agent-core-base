# Data model
| Bảng | Nội dung và ràng buộc |
|---|---|
| users | id UUID, email UNIQUE lowercase, name, scrypt salted password |
| logins | SHA256 session secret, userId, expires 8h |
| devices | id UUID, name, ownerId FK, credentialHash UNIQUE, revoked |
| members | composite PK deviceId/userId; role viewer/operator; owner suy ra devices.ownerId |
| pairs | hash secret PK, ownerId, name, expires 5 phút; consume trong transaction |
| leases | deviceId PK: chỉ một pending/active mỗi máy; id UNIQUE, userId, browserId, nonce, state, expires |
| audit | UUID, at epoch ms, userId, deviceId, event; không secret |

Dữ liệu user/device/member/audit persist; online/presence và status CPU/RAM/mạng nằm trong memory, làm lại qua heartbeat và status report sau restart. Status không được ghi vào SQLite, bị xóa khi runner offline; vì vậy API trả `status:null` nếu runner offline hoặc chưa có báo cáo hợp lệ. Hiện lastSeen chỉ có trong memory, về null khi mất socket; Step quản lý device sau này mới bổ sung lastSeen persistent, hostname/OS thông tin tối thiểu và migration versioned. Lease cũ xóa khi boot để fail closed.

Không hỗ trợ owner transfer hoặc xóa user ở core; thêm migration/API riêng nếu cần. Không thêm MongoDB 4.0 chỉ để giữ stack cũ: SQLite phù hợp quy mô starter, PostgreSQL là hướng scale.

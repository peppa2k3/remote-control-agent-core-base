# Hướng dẫn AI Agent
Đọc README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md, docs/PROGRESS.md rồi prompt được gọi.
- Đây là repo starter: core Step 01 có source; MeshCentral adapter và script runner chưa triển khai.
- Không coi MeshCentral là REST API thông thường. Kiểm tra tài liệu/source phiên bản đã pin; không bịa endpoint hoặc event.
- Không tuyên bố desktop chỉ có một người điều khiển nếu còn đường truy cập MeshCentral trực tiếp bỏ qua lease.
- Không nhận shell command/code/path từ frontend. Chỉ scriptId thuộc allowlist local, params validated.
- Quyền luôn kiểm tra server. Role owner/operator/viewer; owner duy nhất một máy; quan hệ users/devices nhiều-nhiều qua members.
- Lease ràng buộc userId + browser socketId + deviceId + sessionId; pending phải có local ACK nonce mới active. Revoke/timeout/offline phải hủy quyền.
- Không lưu plaintext user/device secret trong DB, không log credential/mã pairing. Credential local cần đọc được bởi runner, bảo vệ bằng ACL.
- SQLite + một backend process là giới hạn hiện tại. Không bật cluster/replicas trước khi thay khóa bằng transaction DB dùng chung và cập nhật Socket.IO adapter.
- Cập nhật API docs, PROGRESS, .env.example và test có ý nghĩa khi thay hành vi. Không sửa .env thật, không đọc hay đưa secret vào commit.
- Chạy npm test, npm run build. Chỉ đưa prompt vào completed khi đạt toàn bộ acceptance criteria; ghi phần chưa xác minh.
- Không tự deploy lên VPS thật khi chỉ được yêu cầu coding. Không giả lập kết quả test hoặc tích hợp.

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

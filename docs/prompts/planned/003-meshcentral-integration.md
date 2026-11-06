# 003 — Tích hợp MeshCentral có kiểm soát
## Mục tiêu
Tích hợp MeshCentral có kiểm soát trên core hiện có.
## Phạm vi
/backend/adapters, /frontend, /infrastructure/meshcentral
## Thực hiện
Kiểm tra source/docs MeshCentral phiên bản pin. Thiết kế adapter server-side bằng giao thức được xác minh (meshctrl/control WebSocket); mapping app deviceId ↔ Mesh NodeID được verify bởi owner/admin. Đồng bộ presence/events với reconnect/full resync, độc lập runnerStatus và meshStatus. Service account least privilege, không admin secrets FE. Chứng minh phương án enforcing lease desktop ở relay/session layer hoặc runtime access; revoke/takeover phải đóng desktop thật. Không coi iframe hoặc che nút là enforcement. Nếu API không cho enforce, chỉ implement read-only presence và ghi blocker desktop, không tạo integration giả.
## Tiêu chí hoàn tất
VPS MeshCentral + agent thật được test; mesh presence chính xác; mapping không cross-tenant. Operator không bypass lock bằng direct MeshCentral UI/token. Revoke/takeover/disconnect đóng phiên thật và audit. Nếu chưa chứng minh được thì prompt chưa complete; ghi rõ read-only phạm vi.
## Kết quả
Source + tests + docs/progress + evidence thực tế; báo rõ limitations.

## Quy tắc chung
Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md và docs/PROGRESS.md. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint hay test result. Không thêm stack nặng nếu chưa cần. Cập nhật env examples/API/docs/test đúng thay đổi; không chạm secrets thật. Chạy npm test + npm run build. Báo changed files, validation và phần chưa kiểm tra; cập nhật tiến độ. Chỉ chuyển prompt vào completed khi mọi tiêu chí hoàn tất và ghi commit nếu được phép commit.

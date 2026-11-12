# WFI-01 — Contract và layout

Trạng thái: **Completed — thiết kế WFI-01, 2026-11-11**. Giữ đường dẫn prompt
hiện tại để các liên kết và lệnh gọi đã dùng tiếp tục hoạt động. Không đánh dấu
WFI-02–08 hoặc runtime integration completed.

Đọc README cùng thư mục. Bước này chốt tài liệu, chưa thay hành vi runtime.

## Đọc source

Core: `backend/src/{workflow,server,store}.js`, `local-agent/src/{index,workflow}.js`,
`frontend/src/{main,WorkflowPanel}.jsx`, package/lockfile và test liên quan.
Ref: các README, engine `src/{main,paths,config}.js`, `src/http/automation-api.js`,
remote client/executor, control-server server/commands/store/shared protocol,
manifest/background/options và `prompts/processing/`.

## Thực hiện

1. So sánh baseline hiện tại với bảng khảo sát; xác định source test nằm ngoài
   package standalone, dependency runtime/dev, CommonJS/ESM và launcher legacy.
2. Viết ADR trong docs chốt package đích, ownership source, strategy vendor/version
   và license/provenance. Nếu dùng layout khác đề xuất, giải thích bằng dependency.
   Ghi checksum source chọn lọc, không hash/copy secret hoặc runtime data.
3. Định nghĩa contract version cho health, local policy, grant expiry, profile-open,
   job/requestId/runId/report seq. Phân biệt API hiện hữu và API mới đề xuất.
4. Chốt quyền catalog/read/run/stop/open; default dừng run remote theo grant, cách
   chờ quiescent khi takeover, ngoại lệ local dashboard và workflow local độc lập.
5. Chốt dữ liệu VPS/local, sanitize metadata, retention, cancel trước delivery,
   crash giữa journal/start/receipt, restart, nâng/hạ version và compat matrix.
6. Chốt bypass: integrated mode không nhận lệnh từ control-server cũ; policy local
   deny-by-default; biến URL/path không tạo đường vượt allowlist.

## Acceptance

- Có contract đủ implement/test từng đầu, threat boundaries và ma trận failure
  cho disconnect/revoke/expiry/takeover/restart/ACK trễ; không hứa tính năng chưa có.
- Có inventory test/package/data migration và phạm vi không đồng bộ media/secret.
- Có lộ trình attach trước managed; không cần sửa .env thật để hoàn thành ADR.
- `npm test`, `npm run build` được chạy, ghi kết quả baseline và phần chưa xác minh.

## Kết quả và bằng chứng

- [ADR-001](../../../adr/001-workflow-integration.md): layout/package ownership,
  license/provenance, dependency/lockfile, compatibility và migration/rollback.
- [Contract integrated v2](../../../WORKFLOW_INTEGRATION_CONTRACT.md): schema,
  quyền, grant expiry/fencing, local policy, job/report/retention và failure matrix;
  API v2 đều được đánh dấu chưa implement.
- [Inventory import/test](../../../WORKFLOW_IMPORT_INVENTORY.md): phạm vi source,
  port test an toàn, CI/package và checklist WFI-01.
- [Manifest SHA-256](../../../workflow-integration-source.json): 29 file source
  chọn lọc từ snapshot local; không dùng commit core như upstream commit ref.
- `npm test` exit 0: backend 5/5, local-agent 13/13, Windows PTY Node v24.16.0.
- `npm run build` exit 0: frontend Vite build.
- Không sửa runtime, env example hoặc .env thật; chưa copy engine/extension,
  chạy suite ref/Chrome thật, thử MongoDB/video, startup task hoặc deploy VPS.

Bước kế tiếp: WFI-02 theo ADR này; giữ giới hạn v1 cho đến khi WFI-03 enforce
grant. Không gọi bộ tích hợp production hoàn chỉnh từ kết quả tài liệu WFI-01.

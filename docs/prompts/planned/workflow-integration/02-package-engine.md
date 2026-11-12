# WFI-02 — Đóng gói engine và extension vào local-agent

Trạng thái: **Completed — nhập source/package và kiểm tra local, 2026-11-11**.
Giữ đường dẫn prompt để các liên kết đã dùng tiếp tục hoạt động. WFI-03–08
chưa completed; không tuyên bố đã enforce grant v2 hoặc Chrome E2E.

Đọc README chung và ADR WFI-01; chưa làm supervisor hoặc jobs.

## Thực hiện

1. Đưa source engine và extension vào layout đã chốt dưới `local-agent/`. Chỉ copy
   runtime source/docs/sample an toàn, không copy .env/data/tools binary/Chrome
   profile/node_modules, ID máy hoặc scenario riêng có dữ liệu nhạy cảm. Ghi
   provenance/version; không biến thư mục ref thành dependency production.
2. Giữ package CommonJS engine riêng với entrypoint và daemon mode; core vẫn ESM.
   Nối dependency/lockfile và npm scripts để fresh checkout cài/chạy được bằng
   tài liệu; không yêu cầu lấy file thủ công từ repo ref lúc chạy.
3. Giữ scenario validation, selector cũ, action/ACK, media guard, activity/history,
   cache và MongoDB tùy chọn. Không rewrite engine hoặc đổi runtime data path ngầm.
4. Port test cần thiết từ ref vào test layout có thể chạy trong core; sửa import
   path có chủ đích. Giữ launcher tương thích trong package đã nhập, ghi rõ những
   launcher gốc của repo ref không thuộc core. Extension package đủ năm file runtime.
5. Tạo scenario fixture không side effect và temp data/profile riêng. Env example
   chỉ chứa placeholder; hướng dẫn attach token bằng cấu hình local an toàn.

## Acceptance

- Engine độc lập phục vụ đúng loopback API token; workflow wait fixture có runId,
  status, stop/history; token sai/thiếu và Origin sai bị chặn như contract.
- Runtime không import `ref/`; fresh install/package layout có test; không mất
  fallback/migration dữ liệu cũ đã cam kết, không tự chạy migration.
- Test engine và core chạy được; build pass, extension ZIP không chứa secrets.
- Chưa bật remote path cũ trong installation tích hợp, chưa chạy profile thật.

## Kết quả

- `local-agent/workflow-engine/`: CommonJS workspace, MongoDB 7.7.0 runtime,
  Playwright 1.64.0 dev, API v1/CLI/daemon/dashboard/history/media guard giữ nguyên
  engine; chỉ fixture/sample public. PROVENANCE ghi 58 file nguồn và adaptations.
- `local-agent/chrome-reels-extension/`: runtime MV3 4.2.2 và ZIP 5 file.
- Bootstrap engine không instantiate HTTP remote client, không đọc remote.json;
  route mutation cũ trả 410 sau auth dashboard. Không tự khởi động engine/Chrome
  hoặc thực hiện migration/startup task trên installation người dùng.
- Root npm scripts/lock, Docker workspace manifests và context exclusions đã nối.
  Dùng tên workspace chính xác để `npm run agent` không chạy cả nested engine.
- Standalone exporter dùng allowlist 50 files và lock runtime trích từ root;
  fresh `npm ci --omit=dev` và chạy workflow thật tại temp độc lập đạt.
- Node suites: core backend 5, local-agent 13, engine 17; 2 browser fixture tests
  content/media bằng Chrome profile test riêng. Migration/ZIP fixture Windows đạt.
- Frontend build, JavaScript/PowerShell syntax và source/package checks đạt.
- `npm ci` tại checkout gặp EPERM file Rolldown đang được giữ; dependency đã
  khôi phục bằng npm install, và npm ci với cùng manifests/lock ở temp sạch đạt.
- Docker image chưa build vì daemon không chạy; extension execution E2E,
  MongoDB thật/video, WAN/VPS và startup thật chưa kiểm tra, thuộc các gate sau.

Hướng dẫn chạy: [README engine](../../../../local-agent/workflow-engine/README.md).
Ghi nhận kiểm chứng: [VALIDATION](../../../VALIDATION.md).

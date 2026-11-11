# WFI-02 — Đóng gói engine và extension vào local-agent

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

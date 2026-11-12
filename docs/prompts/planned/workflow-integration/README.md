# Bộ prompt WFI — tích hợp workflow

Trạng thái: **WFI-01 Completed (thiết kế); WFI-02 Completed (package/source);
WFI-03 Completed (policy/grant); WFI-04–08 Planned**. Giữ nguyên đường dẫn prompt
để tương thích liên kết. Engine 0.2.0/extension 4.3.0 có grant subset;
supervisor/openProfile/durable jobs toàn tuyến chưa triển khai. Phân tích gốc:
[WORKFLOW_INTEGRATION_PLAN](../../../WORKFLOW_INTEGRATION_PLAN.md).

Mỗi lần gửi AI:

> Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md,
> docs/SECURITY.md, docs/PROGRESS.md, docs/WORKFLOW.md và
> docs/WORKFLOW_INTEGRATION_PLAN.md. Thực hiện duy nhất
> docs/prompts/planned/workflow-integration/01-contract-layout.md trên source hiện
> tại. Đọc README này và chỉ dẫn trong source tham chiếu. Giữ thay đổi đang có của
> người dùng, không đọc/sửa .env thật hoặc credential, không deploy. Báo source đã
> đổi, test thực chạy, acceptance đạt/chưa đạt và bước tiếp theo.

Thay tên file theo thứ tự 01 → 08; không dán cả bộ một lần.

## Quy tắc bắt buộc cho mọi bước

- Kiểm tra git diff/status trước khi sửa; không reset/stash/commit thay đổi có
  sẵn. Không sửa `ref/` hoặc `local-agent copy/` để triển khai thay source chính.
- Đọc lại các file nguồn nêu trong prompt. Dùng CodeGraph trước tìm source nếu
  repo có `.codegraph/`. Mọi endpoint/event mới phải được ghi **đề xuất mới**,
  sau đó implement và test hai đầu; không trình bày như API đã có.
- Giữ RBAC server, ACK local nonce, binding user/browser/device/session, local
  policy và expiry. Không dùng HTTP control-server song song trong integrated
  mode. Không cho FE gửi command/code/path/steps hoặc cấu hình supervisor.
- Không deploy, restart service thật, cài startup task, dùng profile đăng nhập,
  post/upload nội dung thật hoặc đọc/copy secrets/runtime data để làm test.
- Chọn path/executable chỉ từ cấu hình local tin cậy; spawn argv không shell.
  Credential local bảo vệ ACL NTFS hoặc mode 600; không coi chmod là đủ cho Windows.
- Đừng đưa Node runtime env chứa device credential/MongoDB/token không cần thiết
  vào process con; lọc env và redact lỗi/log/response.
- Dùng SQLite một backend process. Không hứa exactly-once cho side effect website;
  ambiguous receipt/crash chuyển unknown, không tự replay.
- Mỗi bước code phải có test hành vi có ý nghĩa, chạy `npm test`, `npm run build`
  repo chính và suite engine/extension liên quan. JS mới/đổi chạy `node --check`.
  Không cài dependency/binary hoặc bỏ qua test mà báo pass.
- Cập nhật docs/API.md, docs/WORKFLOW.md, docs/PROGRESS.md, env examples của thành
  phần liên quan khi thay behavior; thêm ARCHITECTURE/SECURITY nếu đổi ranh giới
  quyền. Không thêm env giả chưa implement.
- Kết thúc với acceptance checklist và bằng chứng lệnh/exit status; ghi thiếu
  môi trường. Chỉ chuyển completed khi đạt toàn bộ tiêu chí; không tự commit
  toàn workspace. Nếu cần commit, chỉ phạm vi được cho phép và kiểm tra secrets.

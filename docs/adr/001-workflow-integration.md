# ADR-001 — Tích hợp engine workflow vào core

Ngày: 2026-11-11. Trạng thái: **chấp nhận cho thiết kế WFI-01**.
WFI-03 (2026-11-12) đã implement subset grant/policy, xem
[WORKFLOW_GRANTS](../WORKFLOW_GRANTS.md). Các phần openProfile/jobs/reports/
retention/supervisor của contract vẫn planned; ADR không thay bằng chứng test.

## Cơ sở quyết định

Khảo sát lại core qua CodeGraph và source ref tại workspace:

- Core có Express/Socket.IO, SQLite users/devices/members/lease/audit, adapter HTTP
  và WorkflowPanel. `Store.lease()` loại lease hết hạn ngay khi đọc; kiểm tra
  relay không chỉ phụ thuộc sweep. Capability v1 chỉ kiểm tra config, không probe.
- Engine ref có CommonJS, API v1, scenario validation, history, local dashboard,
  download/media guard; chạy một workflow/profile. API v1 idempotency giữ RAM.
- Control-server có DB records JSON và owner trực tiếp, HTTP polling/report seq.
  Instance lease chống hai agent không thay được user/browser lease của core.
- `src/main.js` engine luôn tạo remote HTTP client; chỉ không có config mới chưa
  polling command. Copy package rồi attach config cũ có thể mở đường điều khiển
  thứ hai. Integrated mode phải chặn từ bootstrap, không chỉ ẩn nút dashboard.
- Test nguồn nằm ở `ref/.../tests/`, không nằm trong engine standalone. Một số
  test layout copy đệ quy package trước khi filter đủ `.env`/runtime; không chạy
  nguyên suite này trên workspace người dùng. Xem inventory để port test an toàn.
- MongoDB được require ở top-level integration: dù không có URI thì runtime vẫn
  cần package `mongodb`. Không gọi nó là optionalDependency khi chưa refactor.

## Layout đã chốt

```text
local-agent/
  src/                         ESM adapter/supervisor, không import engine internals
  workflow-engine/
    package.json               type=commonjs, name=@rca/workflow-engine, private
    index.js                   entrypoint/CLI, --daemon giữ tương thích
    src/ dashboard/ shared/ docs/ scripts/
    scenarios/                 chỉ mẫu/fixture đã kiểm tra, không user scenarios
    test/                      test engine đã port, CommonJS
    data/ tools/ .env           runtime tại máy, không commit hoặc copy từ ref
  chrome-reels-extension/       manifest/background/content/options + package.ps1
  test/                        core adapter/supervisor/integration ESM
```

WFI-02 thêm `local-agent/workflow-engine` vào workspaces root, dùng một lockfile
root v3 làm nguồn dependency cho checkout/CI. Không nhập root package.json hoặc
lockfile của repo ref đè lên core. Bỏ lockfile con khỏi bản vendored, giữ checksum
lockfile nguồn trong manifest provenance. Package độc lập export cần tạo lockfile
riêng từ dependency đã pin và kiểm tra `npm ci`; không hứa copy folder trần từ
workspace hoisted là đủ. Đây là quyết định build, chưa đổi package scripts.

Runtime engine pin MongoDB 7.7.0 theo source lock; Playwright 1.64.0 chỉ dev/test,
không vào runtime engine hoặc app VPS. Node 24 theo root core (không giữ >=22
như một cam kết test). Extension giữ manifest 4.2.2 cho import nguyên bản; sửa
runtime extension sau đó phải tăng version và kiểm tra compatibility.

Đường dẫn tương đối luôn resolve từ package/config tin cậy, không từ cwd frontend.
Trong core layout, parent engine là `local-agent/`, không phải root ref chứa
`local-agent.js`. Fallback `paths.js` phải có test để không vô tình đọc dữ liệu
runner. Giữ `index.js`, daemon/CLI, selector và JSON schema cũ trong package;
launcher root `node local-agent.js` của repo ref không tự xuất hiện ở root core.
Không đổi tên root `local-agent/` đang giữ Socket.IO identity.

Backend/frontend tiếp tục code native của core. Không ship control-server web,
auth/pairing/SQLite records/deploy image như một service mới. Port nguyên tắc
local allowlist/journal/report seq qua contract v2, có test trong core.

## Nguồn và quyền sở hữu

Source ref là snapshot local, chưa có upstream URL/commit đáng tin cho chính
snapshot đó. `git -C ref/... rev-parse --show-toplevel` trỏ về repo core; không
ghi HEAD của core như commit upstream. Engine package version 0.1.0 không đủ
định danh snapshot. [Manifest SHA-256](../workflow-integration-source.json) ghim
các file source/lock/test được chọn, hash bytes nguyên gốc, không đọc `.env`.

Không thấy LICENSE/COPYING trong inventory ref; package khai `private`, không có
license field. Không tự gán MIT hoặc giấy phép CodeGraph cho source này. WFI-02
phải giữ provenance/thông báo bản quyền nếu có và ghi rõ source do người dùng
cung cấp; trước phân phối ra ngoài cần xác định quyền/license với chủ source.
Điều này không ngăn hoàn tất thiết kế hoặc test local của WFI-01.

Core duy trì bản vendored sau import. Mỗi cập nhật từ ref phải có diff source,
checksum mới, test regression và migration review; không auto pull ref hoặc ghi
đè runtime data. Ref không là npm/file dependency production.

## Quyền và vận hành

Chốt contract [WORKFLOW_INTEGRATION_CONTRACT](../WORKFLOW_INTEGRATION_CONTRACT.md).
Một đường remote core, một identity thiết bị. Integrated mode deny-by-default;
standalone giữ behavior riêng và không được quảng bá là lease-enforced.

Attach trước: probe auth/version/mode/instance engine đã chạy; engine v1 chỉ là
legacy bridge với giới hạn hiện tại, không tự nâng thành grant v2. Khi người
vận hành chuyển integrated mode cần dừng engine, backup runtime tại local và
restart có chủ đích. Không restart installation thật trong coding.

Managed sau: supervisor khởi động process Node từ executable/entrypoint cố định,
lọc env, không shell; chỉ quản lý process do mình sở hữu. Không kill process
giữ port hoặc Chrome người dùng để xử lý xung đột. Token/API URL/path chỉ local.
Giữ port 34719 cho extension, không tự cấu hình port khác khi extension hardcode.
Windows interactive user là target cho Chrome/file picker; không hứa Session 0.

Một workflow/profile; các action GUI foreground/file picker dùng khóa toàn máy
trước khi cho phép song song. Remote Terminal/local dashboard/OS cùng tài khoản
vẫn có khả năng tác động trình duyệt; không tuyên bố độc quyền desktop.

## Migration, compatibility và rollback

| Backend / adapter / engine | Hành vi được phép |
| --- | --- |
| Core hiện tại + adapter v1 + engine ref v1 | Legacy bridge hiện hữu; accepted run có thể tiếp tục khi mất lease |
| Core v2 + adapter v1 | Hiện legacy indicator, không bật action v2 hoặc giả health ready |
| Adapter v2 + engine chỉ v1/standalone | `incompatible`; không fallback POST v1 để vượt grant |
| Core/adapter v2 + engine integrated protocol 2 | Chỉ bật v2 sau negotiate và reconcile quiescent |
| Bất kỳ major không biết hoặc policy schema không hỗ trợ | Fail closed, local hướng dẫn nâng version |
| Extension 4.2.2 + engine mới | Giữ route extension cũ; chỉ claim tương thích sau suite E2E WFI-05 |

Minor mới chỉ tương thích khi không đổi semantics/field bắt buộc; capability
được negotiate từ danh sách cố định. Unknown fields bị từ chối; thay schema cần
major mới hoặc explicit negotiated capability, không âm thầm bỏ key.

Giữ credentials core và machine ID/history engine tại chỗ, không copy remote
credential của ref sang core DB. Không tự di chuyển data hoặc giả đồng nhất hai
device ID. `remote.json` cũ giữ file riêng, integrated mode không load token hoặc
khởi tạo polling; thông báo conflict đã redact để local admin xử lý.

Migration jobs của core phải có version trong DB; additive trước, transaction,
backup/restore test bằng fixture. Engine journal riêng, không trộn SQLite core.
Upgrade dừng remote delivery, revoke/drain grant, backup, thay code/schema rồi
handshake và reconcile. Rollback chỉ khi quiescent: tắt v2, không replay queue,
restore schema tương thích từ backup nếu cần. Không rollback sang engine v1 rồi
tiếp tục tự chạy job v2. Unresolved run giữ blocked/unknown đến xác minh local.

## Các gate tiếp theo

WFI-02 chỉ nhập source/package/test; không gọi đó là tích hợp điều khiển an toàn
hoàn chỉnh trước WFI-03. WFI-03 enforce grant/policy và cleanup; WFI-04 health và
supervisor; WFI-05 Chrome thật; WFI-06 journal/sync; WFI-07 UI; WFI-08 nghiệm thu.
Các yêu cầu API/env mới chỉ ghi vào tài liệu hiện hành khi đã implement.

# Inventory nhập source WFI-02

Chốt ngày 2026-11-11; **WFI-02 đã nhập source/package theo bảng dưới**. Chi tiết
nguồn thực và adaptations ở `local-agent/workflow-engine/PROVENANCE.json`.
Mọi đường dẫn nguồn ở dưới tương đối
`ref/local_workflow_agent-dev-remote/`. ADR và contract v2 là quyết định thiết kế,
test hiện tại chưa chứng minh v2.

## Source/package/data

| Nguồn | Đích/quyết định |
| --- | --- |
| `local-workflow-agent/index.js`, `src/`, `dashboard/`, `shared/` | `local-agent/workflow-engine/`; giữ CommonJS, CLI/daemon/local UI/engine validation |
| `local-workflow-agent/package.json` | Đổi name/private/type; Node24; pin MongoDB 7.7.0; workspace root quản lý lock |
| Hai lockfiles ref v3 | Chỉ provenance/so phiên bản; không đè root core. Root ref còn Playwright 1.64.0 dev |
| `local-workflow-agent/docs/`, README, `.env.example` | Adapt đường dẫn và mode docs; example qua review, không lấy `.env` thật |
| `local-workflow-agent/scripts/` | Port setup/check/migration có test và path fix; không chạy installer startup/migration trong coding |
| `local-workflow-agent/scenarios/` | Không copy toàn bộ; viết fixture wait/browser mới và sample public đã review |
| `chrome-reels-extension/{manifest.json,background.js,content.js,options.html,options.js}` | Package extension riêng, giữ token ngoài extension |
| `chrome-reels-extension/package.ps1`, README | Adapt runtime allowlist chỉ 5 file, output dist gitignored |
| `control-server/src/commands.js`, executor/client/shared protocol | Nguồn tham khảo algorithm TTL/journal/seq/ACK/local policy; rewrite integration theo core members/grant, không import trực tiếp auth/server |
| `control-server/src/{server,store,proxy}.js`, web/deploy | Không vendor thành backend/service thứ hai; test invariants bằng core mới |
| `prompts/processing/DATA_STRUCTURE_BLUEPRINT.md` | Inventory nghiệp vụ MongoDB/content, không là kế hoạch remote đang chạy; không nhập object-storage đề xuất |
| `.env*` thật, `.env.control`, credentials, data/tools/Chrome profiles/keys/binaries/node_modules | Không đọc/copy/commit; giữ dữ liệu installation thật tại máy |

Engine env loader có reread MongoDB settings; supervisor chỉ truyền các env cần
thiết và path env engine do local admin chọn, không thừa kế toàn bộ runner env.
MongoDB disabled vẫn cần module installed do top-level require. Không chạy
`check:mongo` hoặc video setup để xác minh import cơ bản.

`src/paths.js` có fallback root legacy khi tồn tại launcher `local-agent.js`.
WFI-02 test ba layout: standalone, core workspace, temp legacy checkout. Dữ liệu
existing không migrate tự động. Attach dùng installation engine cũ không copy
machine ID/scenario/history sang workspace. Managed với data mới có opt-in local.

## Port test, không chạy suite ref nguyên trạng

Tất cả test dưới nằm ở **root ref/tests**, không theo engine standalone. Chuyển
đường dẫn imports/fixtures vào `workflow-engine/test/`; package có type commonjs
để `.js` test require chạy được trong core type module.

| Nhóm test nguồn | Cần giữ/điều chỉnh | Gate |
| --- | --- | --- |
| `project-layout`, `layout-migration`, `env-config` | Fresh package/legacy path/lock consistency; thay recursive copy bằng allowlist source an toàn trước khi chạy | WFI-02 |
| `workflows`, `scenario-features`, `pipeline` | Selector cũ, biến runtime/template, bước/ACK/timeout/cancel, concurrency profile | WFI-02/03 |
| `automation-api`, `agent-api` | Token/Host/Origin/body/idempotency/CLI; tách browser test khỏi Node-only suite | WFI-02/03 |
| `activity-history`, `content-manager`, `media-duplicates`, `mongo-dns`, helpers/memory-mongo | Temp storage/outbox/cache, mocked MongoDB, pause local; không URI thật | WFI-02 |
| `video-download` | Mock executable/download fixture, không tải media ngoài mạng | WFI-02/03 |
| `dashboard-performance`, `dashboard-steps`, `overlay-flow`, `navigation-flow`, `file-picker` | UI/DOM/cancel + platform guard; profile test riêng | WFI-02/05 |
| `extension-profiles` | Playwright extension thật, temp profile/port/scenarios, Mongo URI trống | WFI-05 |
| `remote-core/pairing/execution/web/daemon/deployment` + helpers/remote | Test tham khảo invariants; không đưa whole owner-only server vào core để test pass | WFI-03/06/08 |
| `backend/test/workflow.test.js` core | Hiện dùng HTTP fixture, không engine thật; giữ v1 regression rồi thêm real v2 engine test | WFI-03/06 |
| `local-agent/test/workflow.test.js` core | Giữ abort/expiry/late result/CLI retry; bổ sung grant/watchdog, không thay fixture pass thành integration claim | WFI-03/04 |

`tests/project-layout.js` nguồn có `cpSync` package filter thiếu `.env`/data ở
nhánh đầu. Không thực thi trên installation chứa runtime riêng; test đã port phải
chỉ tạo tree từ manifest source allowlist và tự sinh dummy config temp. Dọn temp
Windows chỉ sau kiểm tra absolute path trong temp workspace.

## CI và build dự kiến

- Root `npm test` nối test engine Node-only có ý nghĩa; Playwright/extension là
  job riêng, dùng browser đã cài theo tài liệu, không profile đăng nhập người dùng.
- CI hiện ubuntu Node24 test/build/Compose/Docker/deploy fixtures; thêm Windows
  interactive evidence riêng cho GUI/PTy/file picker, không giả Linux cover GUI.
- Root Dockerfile hiện chỉ copy backend src/frontend dist; giữ vậy. Khi thêm
  workspace engine, phải copy package manifest cần cho npm lock resolution ở
  build stage, không COPY engine runtime/Chrome/media vào final VPS image.
- `.dockerignore` hiện chưa loại toàn `ref/`/`.env.*`/`.codegraph`; WFI-02 cần
  review build context và exclude, không dựa `.gitignore` để bảo vệ Docker context.
- `npm ci` tại root phải đủ cho core/engine tests; export standalone có test cài
  không dựa node_modules root/ref. Extension ZIP có manifest ở root, chỉ runtime.

## Checklist nghiệm thu WFI-01

- [x] ADR chốt package ownership, dependency/lock, provenance và release limitation.
- [x] Contract v2 tách API hiện hữu/đề xuất; policy/grant/open/job/report và limits.
- [x] Failure matrix và compatibility/upgrade/rollback, attach trước managed.
- [x] Test/package/data migration inventory; không đồng bộ secrets/media/Chrome data.
- [x] Baseline core: `npm test` backend 5/5, local-agent 13/13; build exit 0.
- [x] WFI-02 import/package, engine API thật, ZIP và Node/browser fixture tests.
- [ ] WFI-03+ grant enforcement, Chrome extension execution E2E, VPS/WAN:
  chưa thực hiện, không thuộc acceptance triển khai của bước tài liệu WFI-01.

# CodeGraph trong repo

Thiết lập được kiểm tra ngày 2026-11-11 trên Windows, Node v24.16.0,
CodeGraph npm global v1.6.2.

## Cài trên máy mới

Theo [hướng dẫn CodeGraph chính thức](https://github.com/colbymchenry/codegraph):

```powershell
npm install -g @colbymchenry/codegraph@1.6.2
codegraph install --target codex --location global --yes
codegraph init --yes
```

Chạy `init` trong thư mục gốc repo. Khởi động lại Codex/IDE để nạp MCP mới.
Lệnh install cấu hình MCP và chỉ dẫn cho Codex ở tài khoản người dùng; không
chỉ cài CLI. Cấu hình MCP Codex nằm tại `~/.codex/config.toml`, theo
[tài liệu OpenAI](https://developers.openai.com/codex/mcp).

## Sử dụng

```powershell
codegraph status
codegraph explore createWorkflowRelay
codegraph explore "local-agent/src/workflow.js"
codegraph files
codegraph sync
```

Ưu tiên MCP `codegraph_explore` khi session có tool này; CLI dùng được ngay.
MCP server tự theo dõi thay đổi khi hoạt động. Dùng `sync` khi cần cập nhật
thủ công ngoài session MCP; kiểm tra lại bằng `status`.

## Phạm vi index

`codegraph.json` bổ sung exclude cho `.env*`, credential, khóa, SQLite,
data/backup/build/dependencies, `ref/`, `local-agent copy/` và thư mục runtime
MeshCentral. `.gitignore` vẫn được tôn trọng. Đây là cấu hình index source
chính; source tham chiếu trong `ref/` chưa được index. Không bỏ exclude secrets
để tìm source tham chiếu.

`.codegraph/` chứa index local, đã được gitignore; không commit DB index.
Telemetry hiện giữ lựa chọn sẵn có **disabled**, kiểm tra bằng
`codegraph telemetry status`.

## Bằng chứng thiết lập hiện tại

- `codegraph --version`: 1.6.2, trùng `npm view @colbymchenry/codegraph version`.
- `codegraph init --yes`: exit 0; 24 files, 328 nodes, 1.061 edges.
- `codegraph status`: up to date; `files` không chứa các thư mục đã loại.
- `codegraph explore createWorkflowRelay`: trả source và call paths, exit 0.
- `codex mcp get codegraph`: enabled, stdio, `codegraph serve --mcp`.
- MCP stdio thử trực tiếp: initialize và tools/list thành công, có
  `codegraph_explore`. Chưa xác minh tool trong session IDE mới sau restart.
- `npm test`: backend 5/5, local-agent 13/13; `npm run build`: exit 0.

# Local Runner workflow bridge

Runner này giữ kết nối Socket.IO tới VPS và gọi API loopback của Local Workflow
Agent chạy riêng trên cùng máy. Cấu hình và thao tác web/terminal tại
[docs/WORKFLOW.md](../docs/WORKFLOW.md).

Chạy `npm run workflow -- --help` để xem CLI. Agent cần
`WORKFLOW_AGENT_ENV_FILE` trỏ tới `.env` của workflow engine. Token không được
gửi lên VPS. Giữ `data/`, `data-backup/` và `.env` riêng của từng máy.

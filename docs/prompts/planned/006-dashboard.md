# 006 — Dashboard quản lý hằng ngày
## Mục tiêu
Dashboard quản lý hằng ngày trên core hiện có.
## Phạm vi
/frontend, API cần thiết
## Thực hiện
Hoàn thiện responsive desktop/mobile, theme light/dark, tách trạng thái VPS/runner/Mesh, người đang control, thời hạn lease và lý do revoke. Trang members/invite/revoke, audit, jobs history/logs, script catalog/forms từ schema. Socket disconnect đánh stale/unknown; reconnect rehydrate. Disable theo role chỉ là UX, backend vẫn enforce. Không đưa token/NodeID secret vào UI.
## Tiêu chí hoàn tất
UI rõ ràng không báo online sai khi stale; thao tác operator/viewer/owner đúng; keyboard/mobile dùng được; không console error; kiểm tra login logout reconnect takeover và dark/light.
## Kết quả
Source + tests + docs/progress + evidence thực tế; báo rõ limitations.

## Quy tắc chung
Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md và docs/PROGRESS.md. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint hay test result. Không thêm stack nặng nếu chưa cần. Cập nhật env examples/API/docs/test đúng thay đổi; không chạm secrets thật. Chạy npm test + npm run build. Báo changed files, validation và phần chưa kiểm tra; cập nhật tiến độ. Chỉ chuyển prompt vào completed khi mọi tiêu chí hoàn tất và ghi commit nếu được phép commit.

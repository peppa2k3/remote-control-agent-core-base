# 003 (bổ sung) — Kích hoạt script đã cấu hình trên máy local

## Mục tiêu
Từ dashboard, người có quyền chọn một chương trình/kịch bản đã được khai báo trên máy local và yêu cầu Local Runner chạy nó; dashboard nhận trạng thái tiến trình cùng stdout/stderr realtime.

Prompt này bổ sung vào roadmap hiện có, không thay thế `003-meshcentral-integration.md`.

## Phạm vi
`/backend`, `/frontend`, `/local-agent`, docs và tests.

## Công nghệ và nguyên tắc triển khai
- Dùng Socket.IO đã có để chuyển yêu cầu và log giữa browser ↔ VPS ↔ Local Runner; không mở inbound port tại máy local.
- Dùng `node:child_process.spawn` trong Local Runner, với executable, args và working directory lấy từ allowlist local; không bật shell. Không thêm PTY hoặc dịch vụ ngoài nếu chưa chứng minh cần thiết.
- Mỗi lựa chọn trên giao diện là một `scriptId` ổn định, có label dễ hiểu. Các script được cấu hình local, ví dụ trong manifest/registry riêng có mẫu `.example`; danh sách này không do browser gửi lên để định nghĩa lệnh.
- Browser chỉ gửi `deviceId`, `sessionId`, `scriptId`, `jobId` khi dừng và params theo schema. Không nhận hay thực thi command string, shell code, executable, args, cwd/path hoặc biến môi trường tùy ý từ frontend.

## Hành vi
1. Local Runner công bố metadata an toàn của allowlist cho backend; dashboard hiện các option đã cấu hình cho đúng thiết bị và chỉ user có membership mới xem được. Không gửi thông tin bí mật hoặc đường dẫn nội bộ không cần thiết.
2. Chỉ owner/operator được chạy hoặc dừng script. Backend xác thực browser session, membership, thiết bị online và active lease khớp `userId + browser socketId + deviceId + sessionId` trên từng yêu cầu. Viewer không được chạy/dừng; chỉ xem status/log nếu được phép theo membership.
3. Backend chuyển `scriptId` và params đã kiểm tra tới Local Runner đã xác thực. Runner tra cứu lại allowlist cục bộ, xác thực params lần nữa và chỉ chạy đúng mục đã khai báo.
4. Giao diện có lựa chọn script và chỉ render các ô params được schema cho phép; không có ô terminal nhận lệnh tùy ý. Ví dụ `app.start` có thể chạy `npm start` trong cwd cố định đã cấu hình tại máy, không cho người dùng gõ `cd ...`.
5. Stream stdout/stderr, trạng thái, exit code và thời gian chạy qua Socket.IO theo `jobId`. Giới hạn kích thước output, thời gian chạy và số tiến trình đồng thời; dừng theo `jobId` chỉ khi backend xác nhận còn quyền.
6. Revoke/timeout/offline/disconnect lease phải chặn job mới và dừng hoặc thu hồi job đang chạy theo policy fail-closed. Không để lệnh từ một lease cũ chạy tiếp sau takeover.
7. Tiến trình chạy với quyền của tài khoản Local Runner. Không hỏi hoặc gửi user/password administrator qua frontend/VPS. Nhu cầu elevated privilege nằm ngoài phạm vi; nếu thật sự cần, phải thiết kế service local đặc quyền riêng với API allowlist hẹp và xác nhận tại máy.

## Bảo mật và tương thích
- Không dùng `exec`, `shell:true`, `eval`, terminal PTY tùy ý hoặc ghép chuỗi command.
- Cấu hình allowlist local được bảo vệ bằng quyền filesystem của tài khoản vận hành. Không đưa secret vào manifest, DB, log, test fixture hoặc Git.
- Params kiểm tra theo schema ở cả backend và runner; chặn scriptId không tồn tại, params dư/thiếu/sai kiểu, jobId giả và truy cập chéo thiết bị.
- Giữ nguyên RBAC owner/operator/viewer, lease/ACK hiện có và giới hạn backend một process + SQLite; không cho MeshCentral direct access bypass lease.
- Xác minh cách spawn, nhận log và dừng process trên Windows/Linux. Không giả lập test tích hợp với máy thật.

## Tiêu chí hoàn tất
- Dashboard liệt kê đúng các option do allowlist thiết bị cung cấp, có trạng thái online/offline và form params theo schema.
- Owner/operator có active lease chạy được script đã cấu hình và xem stdout/stderr + exit status; viewer bị chặn chạy/dừng, người không có membership không xem hoặc điều khiển thiết bị, lease sai/hết hạn và Local Runner offline đều bị chặn.
- Dừng job chỉ tác động đúng job/thiết bị; disconnect, revoke, timeout và takeover không để job cũ chạy tiếp ngoài policy.
- Không có đường chạy command/path/code tùy ý từ frontend; không nhận admin credentials từ UI.
- Có tests cho authorization, allowlist/schema, output giới hạn, timeout/cancel và platform behavior; cập nhật API/docs, `PROGRESS.md`, env/config examples đúng thay đổi.
- Chạy `npm test` và `npm run build`; báo evidence và phần chưa xác minh. Chỉ chuyển prompt sang completed khi toàn bộ acceptance đạt.

## Kết quả
Source + tests + docs/progress + evidence thực tế; nêu rõ giới hạn và bước nào chưa xác minh.

## Quy tắc chung
Đọc `AGENTS.md`, `README.md`, `docs/AI_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md` và `docs/PROGRESS.md`. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint/event. Không thêm stack nặng nếu chưa cần. Không sửa `.env` thật hoặc đưa secret vào commit. Không tự deploy lên VPS thật khi chỉ được yêu cầu coding.

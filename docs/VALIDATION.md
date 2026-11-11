# Validation — 2026-10-14 (Asia/Saigon)

## Workflow bridge — rà soát 2026-11-11 (Asia/Bangkok)
- `npm test`: backend 5/5 và Local Runner 13/13 đạt trên Windows 10.0.19045, Node v24.16.0. `npm run build` đạt (Vite 8.3.4, 54 modules).
- Test Socket.IO + HTTP loopback xác nhận browser khác/viewer bị chặn, request run giữ idempotency header, shell/uploadPath bị chặn, revoke không trả data đang chờ và lease hết hạn không gọi engine. Sau điều chỉnh test expiry, chạy riêng `node --test backend/test/workflow.test.js` đạt.
- Test đồng hồ giả xác nhận HTTP pending bị abort tại expiry local khi không có VPS revoke; gia hạn cùng session vượt deadline cũ không bị hủy và request hoàn tất được dọn timer.
- Test hủy do thay session/revoke/disconnect/shutdown xác nhận AbortSignal bị hủy và response đến muộn không được relay, kể cả client giả lập bỏ qua abort. Params quá 12KB bị chặn trước khi gọi HTTP client.
- Test CLI mô phỏng mất response sau khi engine nhận run: requestId đã được xuất trước request, thử lại với `--request-id` giữ nguyên key và body. Đây là kiểm tra key phía bridge, không chứng minh cơ chế deduplicate của engine thật.
- Các kiểm tra engine dùng HTTP fixture; chưa chạy scenario/Chrome extension thật, UI browser mới, VPS/domain hay kết nối Internet. Không deploy, restart runner, sửa secret hoặc cập nhật source trong `local-agent copy`. Workflow đã được engine nhận có thể tiếp tục sau mất lease; abort HTTP không phải rollback/stop workflow.

## Remote Terminal CMD/PowerShell — 2026-11-08 (Asia/Bangkok)
- `npm test`: backend 4/4 pass; Local Runner 11/11 pass.
- Windows PTY integration chạy trên Windows 10.0.19045, Node v24.16.0. Đã mở CMD/PowerShell, chạy `hostname`, `ipconfig`, `ping -t 127.0.0.1`, gửi Ctrl+C và xác nhận `ping.exe` không còn sau khi đóng terminal.
- Backend realtime test xác nhận viewer bị chặn, terminal bind vào đúng user/browser/device/session lease, chỉ browser mở nhận output, một terminal mỗi máy, giới hạn input/output và dừng terminal khi lease release. Audit chỉ có sự kiện metadata.
- `npm run build`: Vite 8.3.4 thành công; xterm tải tách riêng khi người dùng mở Remote Terminal, initial JS 277KiB.
- Chưa kiểm tra giao diện qua browser/VPS/domain, clipboard trong browser HTTPS thật, Windows Server/Windows build khác, hoặc runner đăng nhập bằng tài khoản không phải Administrator. Prompt 004 còn Planned tới khi hoàn tất các kiểm tra máy thật này.

## Loại bỏ script allowlist — 2026-11-09 (Asia/Bangkok)
- Đã gỡ màn hình “Kịch bản trên máy”, protocol script, executor Local Runner, manifest và cấu hình `SCRIPTS_PATH`.
- Remote Terminal/PTY vẫn được giữ; các test backend và Windows PTY vẫn chạy trong bộ kiểm tra.
- `npm test`: backend 4/4 pass; Local Runner 7/7 pass. Integration test xác nhận runner khởi động không cần cấu hình script và snapshot không có catalog `scripts`.
- `npm run build`: Vite 8.3.4 thành công, 52 modules.

## Device status — 2026-11-07 (Asia/Bangkok)
- `npm test`: backend 3/3 pass; Local Runner status 4/4 pass. Integration test chạy Local Runner thật trên Windows Node 24.16.0, nhận CPU/RAM/network status qua Socket.IO và `Get-NetAdapterStatistics`, đồng thời xác nhận status biến mất khi runner disconnect.
- Backend realtime test xác nhận status chỉ hiển thị với owner/operator có quyền; outsider không thấy máy, schema sai và report dày hơn 1/giây bị từ chối.
- `npm run build`: Vite 8.3.4 thành công (44 modules).
- Linux `/proc/net/dev` parser và bộ tính sample được kiểm tra bằng fixture; chưa chạy Local Runner trên máy Linux thật. Chưa nghiệm thu dashboard qua VPS/domain hoặc máy nhà thật; status hiện chỉ trong memory backend và mất sau restart.

## Kiểm tra bổ sung 2026-10-15 (Asia/Bangkok)
- Windows, Node v24.16.0: `npm ci` thành công, 0 vulnerabilities theo npm audit trong quá trình cài.
- `npm test`: 3/3 pass. Sửa đường dẫn khi spawn Local Runner bằng `fileURLToPath` và dọn tiến trình con theo `signalCode` trên Windows.
- `npm run build`: Vite 8.3.4 build thành công (44 modules).
- UI hiển thị trạng thái máy là chưa xác định khi browser mất kết nối realtime VPS.
- Chưa có VPS/domain/máy local thật để nghiệm thu đường truyền Internet, stop mạng, hoặc service reboot. Step 001 vẫn chưa completed.

## CodeGraph và tối ưu snapshot — 2026-10-15
- Cài `@colbymchenry/codegraph` v1.6.2 tại `D:\CODE_DND\codegraph-tools` vì ổ C hết dung lượng; thêm thư mục này vào User PATH. Tắt telemetry. `codegraph init --yes` lập chỉ mục 8 file, 108 nodes, 368 edges; `codegraph status` báo index cập nhật.
- Cấu hình MCP Codex ở `.codex/config.toml`; cần mở lại Codex và trust project để nạp MCP. Chưa xác minh MCP trong phiên Codex hiện tại; CLI `codegraph explore` đã chạy được.
- Snapshot thiết bị dùng một truy vấn SQL JOIN cho mỗi user thay vì truy vấn thêm role và lease cho từng máy. Broadcast tái sử dụng snapshot giữa các tab của cùng user. Điều này giảm số truy vấn khi nhiều máy/tab; chưa đo benchmark tải thực tế.
- Sau thay đổi: `npm test` 3/3 pass và `npm run build` pass trên Windows Node 24.16.0.
Runtime kiểm tra: Linux, Node v24.19.0, npm 11.9.0.

## Đã chạy và đạt
- npm install: lockfile tạo đủ các workspaces; dependencies pin version.
- npm test: 3 test cases tổng hợp đều PASS.
  1. Store/transaction: mã pairing dùng một lần và hết hạn, user không quyền, viewer bị chặn, pending không renew, sai nonce/cross-device/replay ACK bị chặn, khóa độc quyền, owner takeover, lease expiry.
  2. HTTP + Socket.IO trên loopback: đăng nhập/cookie, Origin sai bị chặn, enrollment, membership privacy, handshake active, conflict, takeover/revoke, stale renew bị chặn, runner offline, credential sai và device revoke, audit.
  3. Khởi động chính executable Local Runner với credential đã enroll: outbound connect, heartbeat online, auto-approve offer từ server, lease active, SIGTERM làm revoke.
- npm run build: Vite 8.3.4 build thành công (44 modules).
- npm audit --json: 0 vulnerabilities trong workspace dependencies tại thời điểm chạy. Không bao gồm MeshCentral cài trong Dockerfile riêng.
- node --check: backend server và local runner hợp lệ cú pháp.

## Chưa kiểm tra
- Không có Docker binary ở môi trường này: chưa build image, chưa chạy compose/Traefik/MeshCentral thật.
- Chưa có VPS/domain/key của người dùng: không deploy hay kiểm tra nhà ↔ VPS qua Internet.
- Chưa chạy Windows Task Scheduler/Linux systemd thật, interactive console pairing thực hoặc UI browser visual QA.
- MeshCentral adapter, script executor, jobs và desktop lease enforcement chưa implement; không có test giả cho các phần đó.

## Checklist nghiệm thu Step 001 trên máy thật
1. npm ci trên máy sạch Node 24, seed owner, khởi chạy FE/BE.
2. Login đúng/sai, tạo pairing, local gõ YES, thử replay/expired code.
3. Chạy trên HTTPS VPS và máy nhà: socket online, tắt runner/mạng → offline ≤27s khi mất heartbeat; stop process có thể nhanh hơn.
4. Tạo operator/viewer và browser profiles khác nhau; thử xin quyền đồng thời.
5. User local xác nhận → active; không xác nhận → timeout 20s. Với unattended test AUTO_APPROVE_SESSIONS=true riêng.
6. Owner force takeover: browser cũ bị revoke, ACK/renew session cũ bị chặn; owner qua handshake mới.
7. Logout/revoke member/device/offline/restart VPS đều hủy lease; reconnect nhận snapshot mới, không revive session cũ.
8. Test riêng MeshCentral install/reconnect/reboot; FE hiện not_integrated cho Mesh đến Step 003.

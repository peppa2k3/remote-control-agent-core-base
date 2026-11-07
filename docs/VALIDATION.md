# Validation — 2026-10-14 (Asia/Saigon)

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

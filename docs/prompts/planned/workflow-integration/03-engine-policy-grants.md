# WFI-03 — Local policy và grant tại engine

Trạng thái: **Completed — source và nghiệm thu local, 2026-11-12**. Giữ đường
dẫn để tương thích liên kết. WFI-04–08 vẫn planned, không coi kết quả này là
deploy/Chrome supervisor/durable jobs hoàn chỉnh.

Đọc README chung; phụ thuộc WFI-01/02. Đây là thay đổi bảo mật hai đầu, phải cập
nhật backend relay và adapter hiện có khi cần để có integration test thực.

## Thực hiện

1. Tách standalone/integrated mode rõ ràng. Integrated mode từ chối kích hoạt
   HTTP remote polling cũ; phát hiện config cũ mà không xóa/chuyển secret. Không
   dùng engine API token chung như bằng chứng đang có active lease.
2. Local admin duyệt policy profiles/scenarios/variables với schema/constraints.
   Validate cả catalog, describe và run; không relay biến mặc định nhạy cảm.
   Thu hẹp biến URL/path theo domain/root local, chặn traversal/symlink escape khi
   liên quan; từ chối key lạ, prototype keys và biến runtime dành riêng.
3. Implement contract grant mới WFI-01 ở engine/adapter/backend: grant phiên,
   renew, expiry, revoke, binding lease/device và các request liên quan. Grant
   không được cấp từ frontend hoặc extension; API token vẫn chỉ ở local.
4. Engine watchdog tự dừng run remote thuộc grant khi expiry hoặc mất adapter;
   request revoke phải dừng đúng runId, hủy bước chờ, abort download/child do run
   sở hữu và vô hiệu ACK trễ. Không dừng run local không thuộc grant.
5. Adapter hủy HTTP chờ như hiện tại và thu hồi run đã nhận bằng grant. Không chỉ
   dựa vào response POST run: xử lý cả trường hợp nhận run nhưng mất ACK.
6. Backend giữ trạng thái dừng/quiescent; takeover chặn new side effect cho đến
   khi local xác nhận run cũ đã dừng. Không ACK dừng thành công chỉ vì đã gửi stop.
   Không kill toàn bộ Chrome/user processes để mô phỏng cleanup.

## Acceptance

- Viewer/browser khác/session cũ/ACK giả/replayed grant/lease hết hạn bị từ chối
  ở đúng lớp; revoke membership/device và mất VPS thật trong fixture hết quyền.
- Policy ngoài allowlist, variable nguy hiểm và API URL/path/steps frontend bị chặn.
- Engine watchdog xử lý adapter crash; ACK đến muộn không chạy bước sau; takeover
  không overlap run cũ. Nếu action đang xảy ra không đảo ngược được, ghi giới hạn.
- Run local độc lập vẫn đúng behavior; HTTP polling cũ không bypass integrated mode.
- Test dùng server/engine thật với temp data, có fake time chỉ ở unit test phù hợp;
  test/build và docs behavior mới pass trước chuyển bước.

## Kết quả và bằng chứng

- Engine 0.2.0 giữ engine/validation/history/media guard nguồn tham chiếu; thêm
  standalone/integrated, local policy hash/schema/realpath, grant/fence/seq và
  watchdog monotonic. Integrated chặn v1/native dashboard token bypass; không
  khởi tạo HTTP polling cũ, không đọc/xóa credential remote cũ.
- Backend giữ persistent workflow_control fence/barrier; cấp grant từ auth +
  user/browser/device/session lease thật. Runner protocol 2 gọi HTTP loopback;
  panel cũ được route v2 theo capability, không cho FE mint grant.
- Dừng quyền/HTTP pending và run đã accepted, kể cả mất response POST. Takeover
  chờ local quiescent. ACK đúng client/profile/run/step đến trễ không advance.
  Engine/backend restart giữ unresolved barrier, không tự replay/nhả khóa.
- Extension 4.3.0/settlementVersion=1 xác nhận content idle + debugger input;
  lỗi port không phải settled. Extension cũ bị chặn trước bước web integrated.
  Process cancel đợi exit/tree cleanup, lọc secret env; parent chết bất thường
  không tự coi descendants đã dừng.
- `npm test`: backend 7/7, local-agent 13/13, engine 25/25; 3 browser fixture
  tests và frontend build đạt. Có engine/Socket.IO thật, lost-response, expired
  lease, wrong browser/viewer, membership/device revoke, reconnect, backend
  restart, late ACK, symlink escape, monotonic renewal/expiry, Windows tree kill.
- Gói standalone cài sạch runtime và chạy integrated policy/grant/run/revoke đạt.
  Syntax checks + docs/provenance/env examples cập nhật; không sửa env thật/ref,
  không restart installation người dùng hoặc deploy VPS.

Hướng dẫn triển khai local: [WORKFLOW_GRANTS](../../../WORKFLOW_GRANTS.md).
Giới hạn: chưa full extension worker E2E trên profile người dùng, download thật,
Linux process-tree E2E, WAN/VPS/startup; mất proof có thể giữ unknown/barrier,
chưa có recovery tự động. OpenProfile/GET jobs/report/retention tổng thể contract
chưa implement. Các phần này thuộc WFI-04–08, không được đánh pass tại đây.

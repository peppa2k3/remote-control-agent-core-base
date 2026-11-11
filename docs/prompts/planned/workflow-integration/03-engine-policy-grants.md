# WFI-03 — Local policy và grant tại engine

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

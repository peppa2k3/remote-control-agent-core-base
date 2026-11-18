# Giao diện workflow — WFI-07

WorkflowPanel thống nhất trong mỗi device card, dùng auth/membership/lease core;
không nhúng control-server hoặc gọi trực tiếp engine từ trình duyệt.

- Hiển thị riêng VPS, runner, engine/version, profile/extension và lease. Mất VPS
  đưa snapshot về chưa xác định; engine down không biến runner thành offline.
  Viewer đọc metadata; cửa sổ khác hoặc mất lease không có action.
- Catalog/describe qua relay kiểm tra active browser lease. Describe thêm
  `variableSchema` và `profiles` từ policy; chỉ publicDefaults có giá trị mặc định.
  UI kiểm tra key/type/range/length; engine kiểm tra cả enum và quyết định quyền.
  Không có trường executable/path/flags/token/steps/API URL.
- Mở Chrome dùng profile allowlist, theo dõi readiness thực. Engine vẫn kiểm tra
  extension cho web step, local-only không bị ép có extension. Receipt tiếp nhận
  không được hiển thị như hoàn thành. Theo dõi đúng runId và proof quiescence.
- Run paused hướng dẫn xác nhận dashboard local ở chính máy chạy; không tạo
  link loopback trên điện thoại. Unknown không có force-clear hoặc tự chạy lại.

## Khôi phục và vòng đời

sessionStorage scope user/device/operation chỉ giữ requestId, SHA-256 canonical
params, thời điểm và jobId nếu đã nhận; không lưu variables/payload/credential.
Reload/reconnect tra receipt của chính user trước retry. Không tự gửi mutation;
body mới không thay yêu cầu cũ đang mơ hồ. Retry cùng body giữ requestId, chặn
key không tìm thấy khi quá 89 ngày (retention tối thiểu 90 ngày). “Chuẩn bị lượt
mới” chỉ xóa key run sau khi tra receipt terminal + quiescent. Logout xóa metadata
phiên trình duyệt; không khôi phục biến nhập sau reload.

Đổi user/device/session/role/trạng thái phiên, offline hoặc mất hỗ trợ engine
unmount scope cũ: abort fetch/request UI, bỏ ACK muộn và hủy timer. Abort UI
không chứng minh side effect đã dừng; revoke vẫn do backend/runner xử lý.
Status/profile poll tuần tự dưới lease cửa sổ hiện tại, 2 giây, backoff tối đa
30 giây; không poll run unknown. History mỗi trang 20 job, đọc được khi runner
offline; chỉ poll trang đầu khi mở và còn lease, viewer dùng refresh thủ công.

## API bổ sung

Đề xuất mới WFI-07, **đã implement và kiểm tra hai đầu**:
`GET /api/devices/:id/workflow/requests/:requestId`.
Cookie auth + membership hiện tại, unique device/requestedBy/current user/key;
trả `{version:1,job:<sanitized metadata>|null}`, không cần lease. Không tra được
request của người khác bằng key đoán được. Key còn giữ nhưng metadata hết hạn
trả expired receipt, không cấp execution mới. Dùng schema WFI-06, không migration mới.

Describe v2 thêm variableSchema (type/maxLength/minimum/maximum) và profiles;
enum values không được gửi từ policy vì có thể chứa giá trị không public.
Engine vẫn kiểm tra enum đầy đủ, UI báo lỗi policy nếu giá trị không được phép.
không trả source steps/hash/path/private default values. Không thêm env mới.
Nâng frontend/backend/engine cùng source để có lookup và schema. Khôi phục durable
dành cho protocol 2 + jobsVersion=1; protocol 1 không có đảm bảo journal xuyên restart.
Kiểm thử và phần target chưa xác minh: [VALIDATION](VALIDATION.md). WFI-08 còn riêng.

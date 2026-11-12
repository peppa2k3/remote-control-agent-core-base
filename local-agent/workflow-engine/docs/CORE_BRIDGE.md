# Kết nối core hiện có (v1)

Đây là hướng dẫn legacy standalone/protocol 1. Bản integrated hiện tại xem
[INTEGRATED_MODE](INTEGRATED_MODE.md); env examples mới chọn protocol 2.

Engine chạy riêng trên cùng máy với Local Runner. Local Runner kết nối outbound
Socket.IO tới backend VPS đã ghép cặp; gọi engine bằng HTTP loopback với token
local. Frontend không biết token và không kết nối tới cổng máy local.

Tại checkout core, runner example có:

```dotenv
WORKFLOW_AGENT_ENABLED=true
WORKFLOW_AGENT_PROTOCOL=1
WORKFLOW_AGENT_URL=http://127.0.0.1:34719
WORKFLOW_AGENT_ENV_FILE=./workflow-engine/.env
```

Path env resolve từ thư mục runner `local-agent/`, không phải terminal cwd.
Với gói standalone, local admin chọn path env thật tại installation và điền vào
cấu hình runner. Giữ credentials pairing core; không enroll lại chỉ để attach
engine. Đừng khởi động thêm engine nếu cổng 34719 đã thuộc installation đang dùng.

Khởi động engine rồi runner có chủ đích. Web đăng nhập, yêu cầu lease, local ACK,
chọn scenario/profile và chạy. Bridge chỉ nhận operation cố định và scenario đã
lưu, chặn shell/steps/uploadPath từ web. Chọn profile tồn tại; scenario wait không
cần extension, bước web cần extension connected đúng profile.

Đây là bridge v1: VPS/runner kiểm tra active lease và hủy HTTP pending khi hết
quyền. Workflow đã được engine accepted vẫn có thể tiếp tục; hủy HTTP không phải
dừng run. Kiểm tra history và dừng đúng runId khi được cấp quyền lại. Idempotency
v1 chỉ trong RAM, không bảo đảm chống tạo run trùng qua restart. Không tự retry
run với key mới khi chưa rõ kết quả.

HTTP remote control-server cũ không được bootstrap của bản engine này khởi tạo.
Grant v2/local policy/fencing/watchdog đã có ở integrated mode WFI-03; không áp
dụng cho cấu hình legacy của trang này. Supervisor Chrome và durable jobs còn planned.

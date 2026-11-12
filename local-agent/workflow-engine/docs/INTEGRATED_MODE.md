# Integrated mode (engine 0.2.0)

Engine và core Local Runner vẫn là hai process riêng. Mode này dùng grant từ
lease core, không dùng pairing/polling HTTP control-server cũ. API v1/CLI chỉ
dùng trong standalone mode; integrated dùng panel web core và dashboard local.

Trong env engine tại máy local:

```dotenv
LOCAL_AGENT_MODE=integrated
LOCAL_AGENT_POLICY_FILE=./data/workflow-policy.json
LOCAL_AGENT_API_TOKEN=TOKEN_NGAU_NHIEN_CUA_MAY_LOCAL
```

Token thật 32–256 ASCII không khoảng trắng, giữ tại local với ACL/mode phù hợp.
Path policy tương đối với package engine. Runner ngoài gói này cần
WORKFLOW_AGENT_PROTOCOL=2, URL loopback đúng và WORKFLOW_AGENT_ENV_FILE trỏ env
engine. Không gửi env/token lên VPS. Code mặc định standalone/protocol 1 khi
chưa cấu hình để giữ installation cũ; env examples mới opt-in integrated.

Copy `workflow-policy.example.json` vào path policy local. File example rỗng,
không cấp quyền. Local admin thêm profile/scenario và hash đã duyệt; ví dụ:

```json
{
  "schemaVersion":1,
  "revision":1,
  "profiles":[{"id":"Default","allowOpen":false}],
  "scenarios":[{
    "id":"fixture-wait",
    "sha256":"DIEN_SHA256_64_KY_TU_HEX_THUONG",
    "profiles":["Default"],
    "variables":{"delay":{"type":"integer","minimum":1,"maximum":10000}},
    "publicDefaults":["delay"]
  }],
  "urlOrigins":[],
  "fileRoots":[]
}
```

Tính SHA-256 của bytes file scenarios/fixture-wait.json tại installation. Khi
sửa scenario phải duyệt hash lại; sửa policy tăng revision và thu hồi grant cũ.
Biến primitive cần bounds/schema, string cần maxLength ≤4096, enum tối đa 100.
Không prototype/runtime keys hoặc template trong override. Chỉ publicDefaults
được đưa lên web; text/time/numeric được override, URL/path/locator/action không
được đổi qua biến. URL đã lưu phải nằm trong urlOrigins HTTPS; file/directory
nằm dưới fileRoots tuyệt đối, kiểm tra realpath. openFolder bị chặn remote.

Extension cần **4.3.0**, Reload extension và refresh các trang cũ. Worker chỉ gửi
settled=true khi content script hết busy và debugger input hoàn tất. Cổng 34719
giữ cố định. Engine không tự mở/cài Chrome; scenario wait không cần extension.

Revoke/expiry dừng quyền và chặn bước tiếp; adapter crash được engine watchdog
xử lý theo grant TTL. Takeover đợi xác nhận quiescent, không chỉ ACK gửi stop.
Restart hoặc mất port/extension có thể giữ unknown/barrier nếu chưa chứng minh
action đã dừng. Không xóa journal để giả quiescence; recovery tự động chưa có.
Side effect website không rollback được. Dashboard local/Remote Terminal/quyền
OS là quản trị ngoài policy workflow, không phải desktop độc quyền.

WFI-03 implement health/grants/catalog/run/status/stop qua API v2. Chưa có
openProfile, supervisor, queue/report toàn tuyến và retention tự động. Guard
ledger giới hạn 2000 grants/runs, từ chối thêm thay vì purge unknown. Standalone
export chứa cùng logic, không phụ thuộc ref hoặc backend source để khởi động.

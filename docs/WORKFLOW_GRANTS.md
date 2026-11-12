# Workflow policy và grant (WFI-03)

Engine 0.2.0 có hai mode. `standalone` giữ API v1/CLI cũ; workflow đã accepted
có thể tiếp tục sau khi web mất lease. `integrated` dùng API v2 và policy local,
chặn API v1 và Bearer-token trên API dashboard cũ. Không tự chuyển installation
đang chạy sang mode mới. HTTP polling control-server cũ bị tắt ở cả hai mode;
engine chỉ kiểm tra sự tồn tại remote.json để báo conflict, không đọc/xóa secret.

## Cấu hình local

Các biến mới được implement; chỉ sửa cấu hình máy khi người vận hành triển khai:

```dotenv
# local-agent/workflow-engine/.env
LOCAL_AGENT_MODE=integrated
LOCAL_AGENT_POLICY_FILE=./data/workflow-policy.json
LOCAL_AGENT_API_TOKEN=TOKEN_NGAU_NHIEN_CUA_MAY_LOCAL
```

Token thật phải có 32–256 ASCII printable, không khoảng trắng. Giữ tại local,
bảo vệ env/credential bằng NTFS ACL hoặc mode 600. Policy cần chỉ local admin
được ghi; grant journal cần writable bởi tài khoản engine. Path policy tương đối
resolve từ package engine; không từ browser hoặc terminal cwd.

```dotenv
# local-agent/.env
WORKFLOW_AGENT_ENABLED=true
WORKFLOW_AGENT_PROTOCOL=2
WORKFLOW_AGENT_URL=http://127.0.0.1:34719
WORKFLOW_AGENT_ENV_FILE=./workflow-engine/.env
```

Mặc định trong code khi chưa cấu hình vẫn là standalone/protocol 1 để không đổi
installation cũ ngầm. Env examples mới chọn integrated/protocol 2. Không fallback
từ protocol 2 sang v1 khi lỗi. Engine và runner vẫn start riêng; supervisor và
health poll đầy đủ thuộc WFI-04. Engine restart cần runner reconnect để negotiate
instance mới. Không chạy hai engine trên cổng 34719.

## Phê duyệt scenario

Copy `local-agent/workflow-engine/workflow-policy.example.json` vào path policy
local, rồi duyệt profile/scenario/biến cần dùng. Example mặc định rỗng, không cấp
quyền remote. Tính hash source scenario đã kiểm tra, ví dụ tại root repo:

```powershell
(Get-FileHash local-agent/workflow-engine/scenarios/fixture-wait.json -Algorithm SHA256).Hash.ToLowerInvariant()
```

Mẫu để local admin điền hash thực, không phải policy có hiệu lực sẵn:

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "profiles": [{"id":"Default","allowOpen":false}],
  "scenarios": [{
    "id":"fixture-wait",
    "sha256":"DIEN_SHA256_64_KY_TU_HEX_THUONG",
    "profiles":["Default"],
    "variables":{"delay":{"type":"integer","minimum":1,"maximum":10000}},
    "publicDefaults":["delay"]
  }],
  "urlOrigins": [],
  "fileRoots": []
}
```

Policy thiếu/sai schema/hash hoặc scenario đổi nội dung sẽ bị từ chối. Khi sửa
policy, tăng revision; grant đang active bị revoke theo digest thay đổi. Catalog
và describe lọc theo policy; chỉ publicDefaults được đưa lên VPS, không toàn bộ
biến mặc định. Biến chỉ primitive, có schema/bounds/enum; chặn unknown keys,
prototype keys, `download_*` và template trong giá trị override.

Bản WFI-03 chỉ cho override text/date/time/numeric input; thay đổi gián tiếp hay
trực tiếp URL/path/locator/action qua biến đều bị chặn. Muốn đổi đích, local admin
sửa scenario rồi duyệt hash lại. URL đã lưu phải thuộc `urlOrigins` HTTPS đã
duyệt; file/directory phải thuộc `fileRoots` tuyệt đối, kiểm tra realpath sau nội
suy để chặn symlink escape. `openFolder` không được chạy từ remote v2. Không cấp
quyền ghi policy hoặc cấu hình executable/path cho frontend.

## Vòng đời quyền

Web vẫn dùng panel cũ và `workflow:request`; backend tự route v2 khi runner đã
advertise v2. Cũng có event `workflow:v2:request`. Backend lấy user/browser/device
từ auth, bắt buộc owner/operator và active lease đúng browser; pending vẫn cần
ACK nonce từ agent socket. Browser không tự cấp grant/fence/expiry.

Backend tạo grant/session binding, fence tăng bền vững theo device trong SQLite
`workflow_control`, gửi `workflow:v2:grant` qua agent đã auth. Runner xác minh
session hiện tại, trừ safety margin 2 giây khỏi expiry, gửi HTTP loopback token
tại local. Engine pin engineInstance/device/fence/seq, dùng deadline monotonic
và watchdog 250ms; renew cùng grant không vượt expiry lease, grant expired hoặc
revoked không được sống lại. Policy/source đổi cũng revoke run liên quan.

Release, logout/browser disconnect, membership/device revoke, agent disconnect,
lease expiry và shutdown đều hủy quyền/HTTP pending và revoke toàn grant. Mất
response POST run không làm mất khả năng revoke: engine đã ghi runId thuộc grant
trước start. Adapter crash thì engine tự hết quyền khi grant TTL hết (tối đa
45 giây, không đợi revoke từ VPS). Run local qua dashboard session riêng không
thuộc grant web và không bị dừng theo grant đó.

## Dừng thật và takeover

`stopRun` chặn bước tiếp theo ngay, nhưng quiescent chỉ true khi các promise local
đã settle và action Chrome đã có receipt hoàn tất. Download process bị abort theo
process group trên Unix hoặc taskkill tree trên Windows; đợi close và kết quả
cleanup, không đưa API token/MongoDB/device env vào process con.

Extension **4.3.0** gửi settlementVersion=1. Sau mỗi action, worker xác minh content
script hết busy và các debugger input đã xong, rồi mới gửi `settled:true`.
Transport failure hoặc cleanup không xác nhận được giữ `settled:false`/unknown.
ACK đúng client/profile/run/step đến sau revoke chỉ xác nhận action cũ đã kết
thúc; không advance. Extension cũ không chạy bước web trong integrated mode.
Cần Reload extension và refresh các trang Chrome cũ sau nâng cấp; không chỉ
restart engine. Không thêm quyền Chrome mới trong bước này.

Owner takeover trả 409 và revoke trước; chỉ tạo offer/nonce mới khi local xác
nhận quiescent. Không nhả barrier theo timeout hoặc chỉ vì socket/process chết.
Backend restart xóa lease nhưng giữ counter/barrier; engine restart vô hiệu grant
cũ và giữ run chưa xác minh ở unknown. Reconnect có thể reconcile revoke đã biết;
không tự replay. Mất extension/port/cleanup có thể giữ barrier cho đến khi xác
minh local; chưa có API tự xóa/reset barrier hoặc quy trình recovery đầy đủ ở
WFI-03. Không xóa journal để giả lập tác vụ đã dừng.

Các side effect website đã xảy ra không rollback được. Local dashboard, chương
trình native/extension tin cậy và Remote Terminal có quyền OS là các đường quản
trị ngoài policy workflow. Không coi grant này là độc quyền desktop hay sandbox
chống người có quyền Windows/local admin.

## API và phạm vi triển khai

Đã implement HTTP `/api/v2/health`, PUT/GET `/grants/:id`, POST
`/grants/:id/revoke`, catalog/describe, runs/status/run/stop. Mọi route cần Bearer
local, Host đúng, cấm Origin browser; catalog/run/status/stop còn cần grant/fence/
engine-instance headers. JSON HTTP mới chặn duplicate/prototype keys.

Đã implement socket capabilities/grant/revoke/dispatch; panel cũ không cần tự
giữ grant. Request run cần requestId ổn định; backend tạo job correlation ID xác
định theo device/user/operation/requestId. Stop từ panel cũ được backend thêm key;
không dùng key này để tạo run mới. Engine ghi fingerprint/run metadata để chặn
replay trong các grant đã biết, không lưu raw variables lên VPS.

Chưa implement openProfile, GET jobs, queue/report seq/ACK toàn tuyến, retention
30/90 ngày hoặc recovery tự động trong contract tổng thể. Guard ledger giới hạn
2000 grants/runs và từ chối nhận thêm khi đầy, không purge run unknown. Các phần
này thuộc WFI-04–06. Không nâng SQLite lên nhiều backend process.

Test dùng backend/Socket.IO/engine thật với dữ liệu tạm, extension protocol fixture,
VM worker và content script thật trong Chrome test context. Chưa nghiệm thu full
extension worker trên profile người dùng, download thực/FFmpeg, WAN/VPS hay
Windows startup. Xem [VALIDATION](VALIDATION.md).

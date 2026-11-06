# GitHub Actions CI/CD lên VPS

Workflow này lấy quy trình trong `ref/` và thay các giả định riêng của project mẫu bằng cấu hình của Remote Control Agent:

- Một image GHCR duy nhất phục vụ cả React/Vite và Express/Socket.IO.
- VPS dùng Docker Compose, Traefik và SQLite trong named volume `infrastructure_app-data`.
- Mỗi image gắn với commit SHA và workflow dùng lại image đã publish nếu rerun cùng commit. Deploy chỉ chạy sau `npm test`, `npm run build` và kiểm tra rollback script; bước verify gọi HTTPS health route rồi mới promote release. Nếu deploy/verify lỗi, workflow khôi phục image trước.
- Không truyền file `.env` qua GitHub Actions. File cấu hình và SQLite ở VPS được giữ nguyên khi cập nhật container.

Chưa có deploy tự động nào được chạy trên VPS thật. Hãy chuẩn bị các mục dưới đây trước khi push vào `main` hoặc bấm `Run workflow` trên nhánh `main`.

## 1. Chuẩn bị VPS

VPS cần Linux, Docker Engine, Docker Compose plugin có hỗ trợ `up --wait`, `curl`, Traefik đang chạy, DNS của `APP_DOMAIN` trỏ đến VPS, HTTPS hợp lệ và network Traefik mà app sẽ dùng. Deploy user cần đăng nhập SSH bằng public key và quyền chạy Docker. Quyền Docker tương đương quyền quản trị VPS; chỉ cấp cho tài khoản deploy đáng tin cậy.

Tạo thư mục theo mặc định của workflow (nếu dùng đường dẫn khác, cập nhật `VPS_DEPLOY_ROOT` ở GitHub Variables; đường dẫn không có dấu cách hoặc thành phần `..`):

```bash
sudo install -d -o deploy -g deploy -m 750 \
  /opt/remote-control-agent/infrastructure \
  /opt/remote-control-agent/releases \
  /opt/remote-control-agent/shared
```

Từ máy đang có checkout của repo, chép hai file mẫu lên VPS:

```powershell
scp infrastructure/.env.example infrastructure/backend.env.example deploy@VPS_HOST:/opt/remote-control-agent/infrastructure/
```

Trên VPS, tạo file cấu hình thật và sửa chúng theo Traefik/domain của VPS:

```bash
cd /opt/remote-control-agent/infrastructure
cp .env.example .env
cp backend.env.example backend.env
```

Trong `.env`, đặt ít nhất:

```dotenv
APP_DOMAIN=remote.example.com
TRAEFIK_NETWORK=web
TRAEFIK_CERTRESOLVER=letsencrypt
```

`TRAEFIK_NETWORK` phải đúng tên Docker network hiện có và Traefik phải tham gia network đó. `TRAEFIK_CERTRESOLVER` phải trùng tên resolver cấu hình trong Traefik. `MESH_DOMAIN` và `MESH_VERSION` vẫn là biến cho cấu hình MeshCentral độc lập; workflow này chỉ deploy service `app`.

Trong `backend.env`, `PUBLIC_ORIGIN` phải đúng tuyệt đối với `https://APP_DOMAIN`. Giữ các giá trị dưới đây cho app chạy sau Traefik và ghi SQLite vào volume:

```dotenv
PUBLIC_ORIGIN=https://remote.example.com
COOKIE_SECURE=true
TRUST_PROXY=true
HOST=0.0.0.0
PORT=4000
DB_PATH=/data/rca.sqlite
```

Không dùng `http://`, không đặt `NODE_TLS_REJECT_UNAUTHORIZED=0`, và không thay `DB_PATH` sang filesystem ngoài `/data`. Bảo vệ file rồi xác nhận các biến chính:

```bash
chmod 600 .env backend.env
docker network inspect web
grep -E '^(APP_DOMAIN|TRAEFIK_NETWORK|TRAEFIK_CERTRESOLVER)=' .env
grep -E '^(PUBLIC_ORIGIN|COOKIE_SECURE|TRUST_PROXY|HOST|PORT|DB_PATH)=' backend.env
```

Thay `web` trong lệnh kiểm tra bằng `TRAEFIK_NETWORK` thực tế. Các lệnh `grep` chỉ in cấu hình mẫu, không in credential. Không đặt mật khẩu owner hoặc pairing code trong hai file này.

Nếu app đã được chạy thủ công, kiểm tra Compose project đang dùng là `infrastructure` và named volume là `infrastructure_app-data` trước khi chuyển workflow. Đó là project/volume mà file production Compose giữ lại. Backup SQLite trước lần deploy đầu; không chạy `docker compose down -v`.

## 2. Tạo SSH key cho Actions

Trên Windows PowerShell:

```powershell
ssh-keygen -t ed25519 -C "github-actions-remote-control-agent" -f "$env:USERPROFILE\.ssh\rca_github_actions"
```

Để passphrase trống để workflow có thể dùng key không tương tác. Chỉ chép public key lên VPS:

```powershell
Get-Content "$env:USERPROFILE\.ssh\rca_github_actions.pub"
```

Thêm nguyên dòng `ssh-ed25519 ...` vào `/home/deploy/.ssh/authorized_keys` (đổi `deploy` nếu dùng tên khác), rồi đặt quyền:

```bash
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
sudo -u deploy touch /home/deploy/.ssh/authorized_keys
sudo nano /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Lấy private key để lưu trong GitHub Secret, không đưa file lên repo:

```powershell
Get-Content "$env:USERPROFILE\.ssh\rca_github_actions"
```

Copy toàn bộ, bao gồm cả dòng `BEGIN OPENSSH PRIVATE KEY` và `END OPENSSH PRIVATE KEY`.

Tạo `VPS_SSH_KNOWN_HOSTS` bằng host key của VPS, rồi đối chiếu fingerprint với console/provider đáng tin cậy trước khi lưu. Không dùng `ssh-keyscan` rồi tin kết quả mà chưa xác minh:

```bash
ssh-keyscan -p 22 VPS_HOST
```

Nếu SSH dùng port khác, thay `22`. Giá trị secret chứa nguyên các dòng known_hosts cho đúng host và port.

## 3. Tạo quyền đọc image GHCR cho VPS

Trong GitHub, tạo Personal Access Token (classic) chỉ có quyền `read:packages`; dùng tài khoản có quyền đọc package của repo. Lưu token đó làm secret `GHCR_READ_TOKEN`. Đặt tên tài khoản GitHub sở hữu token vào variable `GHCR_USERNAME`.

Image được publish vào `ghcr.io/<owner>/<repository>:<commit-sha>`. Nếu package GHCR đang private, cấp repository này quyền truy cập package trong Package settings. Workflow dùng `GITHUB_TOKEN` với `packages: write` khi publish; VPS chỉ nhận token đọc package trong một bước SSH và workflow gọi `docker logout` sau khi apply.

## 4. Thêm GitHub Actions variables và secrets

Trong repository, vào **Settings → Secrets and variables → Actions**. Tạo các **Repository variables**:

| Variable | Giá trị |
|---|---|
| `VPS_HOST` | DNS name hoặc IPv4 của VPS, không có `ssh://` hay path |
| `VPS_USER` | Tài khoản deploy có quyền Docker, ví dụ `deploy` |
| `VPS_PORT` | Port SSH, thông thường `22` |
| `VPS_DEPLOY_ROOT` | Đường dẫn tuyệt đối, mặc định `/opt/remote-control-agent` |
| `GHCR_USERNAME` | Tên tài khoản GitHub sở hữu PAT đọc GHCR |

Thêm các **Repository secrets**:

| Secret | Giá trị |
|---|---|
| `VPS_SSH_PRIVATE_KEY` | Toàn bộ private key `rca_github_actions` |
| `VPS_SSH_KNOWN_HOSTS` | Host key VPS đã xác minh; giữ đúng dòng/port |
| `GHCR_READ_TOKEN` | PAT chỉ có `read:packages` |

Job `deploy` dùng environment `production`. Có thể tạo environment này và đặt protection rules/reviewer nếu muốn duyệt thủ công trước khi thay app. `verify` và `rollback` dùng Repository secrets nên rollback không bị chờ duyệt riêng. Repo `main` phải cho phép GitHub Actions chạy. Workflow chỉ deploy khi `main` được push hoặc khi bấm **Run workflow** chọn `main`.

## 5. Kiểm tra lần chạy đầu

1. Đảm bảo CI pass trên commit sẽ deploy.
2. Mở **Actions → Production deploy** để xem job `validate`, `publish-image`, `deploy`, `verify`. `verify` chỉ promote image sau khi container khỏe và `https://APP_DOMAIN/api/health` trả HTTP 200 với `status: ok`.
3. Kiểm tra dashboard/login và runner sau deploy. Health endpoint chỉ xác nhận app process phản hồi; nó không xác nhận máy local online.
4. Nếu `deploy` hoặc `verify` lỗi, job `rollback` khôi phục image trước. Trên VPS, xem log bằng lệnh dưới đây; không đưa output có secret vào issue/commit.

```bash
set -e
root=/opt/remote-control-agent
release_sha="$(sed -n 's/^RELEASE_SHA=//p' "$root/shared/current-release.env")"
app_image="$(sed -n 's/^IMAGE=//p' "$root/shared/current-release.env")"
APP_IMAGE="$app_image" BACKEND_ENV_FILE="$root/infrastructure/backend.env" \
docker compose -p infrastructure --project-directory "$root/infrastructure" \
  --env-file "$root/infrastructure/.env" \
  -f "$root/releases/$release_sha/infrastructure/compose.prod.yml" \
  logs --tail=100 app
```

Deploy workflow không tạo owner tự động. Sau lần deploy đầu, seed owner bằng file tạm chỉ có trên VPS:

```bash
set -e
root=/opt/remote-control-agent
release_sha="$(sed -n 's/^RELEASE_SHA=//p' "$root/shared/current-release.env")"
app_image="$(sed -n 's/^IMAGE=//p' "$root/shared/current-release.env")"
umask 077
nano "$root/shared/seed.env"
chmod 600 "$root/shared/seed.env"
cat > "$root/shared/seed.compose.yml" <<EOF
services:
  app:
    env_file:
      - $root/infrastructure/backend.env
      - $root/shared/seed.env
EOF
chmod 600 "$root/shared/seed.compose.yml"
APP_IMAGE="$app_image" BACKEND_ENV_FILE="$root/infrastructure/backend.env" \
  docker compose -p infrastructure --project-directory "$root/infrastructure" \
    --env-file "$root/infrastructure/.env" \
    -f "$root/releases/$release_sha/infrastructure/compose.prod.yml" \
    -f "$root/shared/seed.compose.yml" \
    run --rm app node src/seed.js
rm -f "$root/shared/seed.env" "$root/shared/seed.compose.yml"
```

Trong `seed.env`, đặt `SEED_EMAIL`, `SEED_PASSWORD` (ít nhất 12 ký tự) và tùy chọn `SEED_NAME`. Không truyền mật khẩu trong command line. Tạo user khác bằng quy trình tương tự; seed không đổi mật khẩu nếu email đã tồn tại. SQLite vẫn nằm trong volume qua các lần thay image. Quy trình deploy thủ công ban đầu vẫn ở [DEPLOY.md](DEPLOY.md).

## Phạm vi hiện tại

Đây là CI/CD starter cho một VPS và một backend process. Workflow cập nhật riêng app, giữ SQLite volume và rollback image; nó không backup database, không nâng cấp schema tự động và không triển khai MeshCentral. Trước khi dùng dữ liệu quan trọng, thiết lập/diễn tập backup-restore SQLite trên VPS và xác minh hành vi với đúng Traefik/network của bạn.

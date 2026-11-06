# Deploy core lên VPS có Traefik
Cần Docker Compose plugin, quyền Docker cho deploy user, domain remote.example.com trỏ VPS, Traefik network/entrypoint/certresolver thực tế. File mẫu dùng network web, entrypoint websecure, resolver letsencrypt; sửa nếu VPS khác. Không giả định network tên traefik giống tên container.

1. Copy repo lên /opt/remote-control-agent.
2. Trong infrastructure copy .env.example → .env, backend.env.example → backend.env. APP_DOMAIN và PUBLIC_ORIGIN phải khớp, ví dụ https://remote.tenmien.vn. COOKIE_SECURE=true. Không dùng http public.
3. Kiểm tra mạng:
```sh
docker network ls
```
Nếu chưa có mạng Traefik, tạo hoặc chọn mạng proxy đang dùng; gắn Traefik vào đúng mạng trước.
4. Tại infrastructure:
```sh
docker compose config --quiet
docker compose build app
docker compose up -d app
```
5. Tạo owner bằng override seed ở mục bên dưới; giữ seed.env riêng trên VPS, chmod 600 và xóa sau seed. Không đưa mật khẩu vào command/image/Git.
6. Mở HTTPS dashboard, kiểm tra /api/health, login, pairing máy nhà SERVER_URL=https://remote.tenmien.vn.
7. Bật runner trên máy nhà, nhìn online rồi ngắt mạng local để kiểm tra offline. Không mở port router nhà.

## Seed bằng Compose override tương thích (khuyến nghị)
Tạo seed.env chỉ ở VPS, không commit. Tạo seed.compose.yml:
```yaml
services:
  app:
    env_file:
      - ./backend.env
      - ./seed.env
```
```sh
docker compose -f compose.yml -f seed.compose.yml run --rm app node src/seed.js
```
Xóa seed.env và seed.compose.yml sau khi seed; service đang chạy không bị restart hoặc lưu seed env. Tạo user khác bằng cách này khi cần. Không có self registration.

## Vận hành
- Single app replica. DB tại named volume app-data; không dùng `down -v` trừ khi cố ý xóa dữ liệu.
- Backup SQLite consistent: stop app trước snapshot/copy volume hoặc dùng SQLite backup API; giữ permissions, kiểm tra restore trên môi trường thử.
- MeshCentral backup gồm toàn bộ meshcentral-data (DB/khóa/chứng chỉ) và meshcentral-files. Không chỉ backup config.
- `docker compose logs --tail=100 app`; không log secret. Health route chỉ kiểm tra process, không chứng minh agent đang online.
- App domain phục vụ cả FE/API/socket. Không cần NEXT_PUBLIC_* hoặc FE URL hard-code.
- CI/CD GitHub Actions, GHCR, secrets và rollback: xem [CICD_DEPLOY.md](CICD_DEPLOY.md).

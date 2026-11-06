# 007 — Production hardening, backup và CI/CD
## Mục tiêu
Production hardening, backup và CI/CD trên core hiện có.
## Phạm vi
/infrastructure, /.github/workflows, /docs
## Thực hiện
CI test/build rồi Docker build/push GHCR hoặc DockerHub, image immutable SHA; deploy SSH bằng deploy user tới path cấu hình, env runtime ở VPS, không ghi secret image. Smoke test HTTPS API/socket, rollback image cũ khi fail; migration backward-compatible và backup DB nhất quán trước thay schema. Pin dependencies/images, scan packages, least privilege, MFA, login throttling account+IP, credential rotation, audit retention, observability/log redaction, backup/restore drill. Không bật multiple backend replicas trước PostgreSQL transactions/fencing/shared Socket.IO state.
## Tiêu chí hoàn tất
Pipeline chạy môi trường test, rollout và rollback thật có bằng chứng; restore được DB+Mesh keys; HTTPS/cookie/origin đúng; Docker không expose backend/DB port; secrets không artifacts/logs; documented recovery và giới hạn scale.
## Kết quả
Source + tests + docs/progress + evidence thực tế; báo rõ limitations.

## Quy tắc chung
Đọc AGENTS.md, README.md, docs/AI_CONTEXT.md, docs/ARCHITECTURE.md, docs/SECURITY.md và docs/PROGRESS.md. Tiếp tục source hiện tại, không viết lại repo. Không bịa MeshCentral endpoint hay test result. Không thêm stack nặng nếu chưa cần. Cập nhật env examples/API/docs/test đúng thay đổi; không chạm secrets thật. Chạy npm test + npm run build. Báo changed files, validation và phần chưa kiểm tra; cập nhật tiến độ. Chỉ chuyển prompt vào completed khi mọi tiêu chí hoàn tất và ghi commit nếu được phép commit.

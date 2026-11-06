# MeshCentral Server + MeshCentral Agent
## Phạm vi
Source có Dockerfile cài package meshcentral@1.2.5 (version npm kiểm tra ngày 2026-10-14), compose profile mesh và config mẫu. Chưa chạy MeshCentral server/agent thật trong môi trường kiểm thử này, chưa có adapter đồng bộ NodeID/presence/session vào app. MeshCentral hoạt động standalone trước; không tự đồng bộ users app.

## Cài server sau khi core app đã chạy
1. Domain mesh.tenmien.vn trỏ VPS, có route TLS Traefik. Trong infrastructure/.env đặt MESH_DOMAIN tương ứng.
2. Copy meshcentral/config.example.json → meshcentral/meshcentral-data/config.json; tạo meshcentral-files. Sửa settings.cert và domains[""].certUrl về domain thật.
3. tlsOffload phải là **IP của Traefik được tin cậy**, lấy từ docker inspect/network inspect; IP mẫu 172.18.0.2 không tự đúng. Nếu IP đổi khi recreate proxy cần cập nhật. Không đặt trust-all trên network dùng chung.
4. Domain phải phục vụ certificate HTTPS thực mà MeshAgents thấy; certUrl cần truy cập được từ container. Nên dùng DNS only lúc đầu, không đặt CDN/TLS proxy khác trước MeshCentral khi chưa test cert pinning/reconnect.
5. Quyền bind mount: node image chạy UID/GID 1000; chown hai thư mục dữ liệu cho 1000:1000. Không ghi đè data đang dùng.
6. Để bootstrap admin đầu tiên, tạm đổi domains[""].newAccounts=true, hạn chế route MeshCentral chỉ tới IP của bạn ở proxy/firewall trong thời gian này.
```sh
docker compose --profile mesh build meshcentral
docker compose --profile mesh up -d meshcentral
docker compose logs --tail=100 meshcentral
```
7. Mở https://mesh.tenmien.vn, tạo admin đầu tiên, bật MFA. Đặt newAccounts=false và restart meshcentral ngay sau bootstrap. Kiểm tra đã chặn đăng ký.
8. Admin tạo device group riêng, Add Agent, tải installer đúng Windows/Linux từ chính server, cài lên máy nhà. Cài agent có thể cần admin/root; Local Runner không cần quyền đó.
9. Máy xuất hiện online trên MeshCentral; thử desktop, reconnect, reboot. Đồng thời Local Runner vẫn chạy riêng và dashboard app hiển thị runner online.

## Tích hợp ở Step 03
Backend lưu mapping deviceId ↔ mesh nodeid và mesh group; verify owner/device enrollment trước khi map. Dùng service account server-side quyền tối thiểu; kiểm tra meshctrl/control websocket theo version pinned từ source/tài liệu chính thức. Không bịa endpoint REST. Chọn cơ chế event subscription hoặc polling có reconnect và full resync; tách meshStatus khỏi runnerStatus.

Quan trọng: app lease không tự đóng một remote desktop session MeshCentral. Cần thiết kế gateway/relay hoặc cấp quyền phiên ngắn hạn + disconnect/session control được chứng minh bằng test. Không mở iframe UI admin xuống FE. Nếu version không cho enforce độc quyền đáng tin cậy, chỉ expose trạng thái Mesh và giữ desktop là công cụ break-glass admin, ghi rõ hạn chế.

## Tài liệu chính thức
- https://github.com/Ylianst/MeshCentral
- https://docs.meshcentral.com/meshcentral/
- https://github.com/Ylianst/MeshCentral/blob/master/meshctrl.js
- https://github.com/Ylianst/MeshCentral/blob/master/meshcentral-config-schema.json
- https://docs.meshcentral.com/meshcentral/#traefik-reverse-proxy-setup
Tài liệu Traefik chính thức có ví dụ đời cũ; compose repo dùng nhãn Traefik hiện tại. Dựa vào cert/aliasPort/tlsOffload/agentConfig nguyên lý, không copy nguyên cấu hình Traefik 1.x.

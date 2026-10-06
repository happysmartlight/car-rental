# Kiến trúc

## Tổng thể

```
 iPhone / laptop (Tailscale)
        │ HTTPS  https://dietpi.<tailnet>.ts.net:3002   (Tailscale Serve → 127.0.0.1:3002)
        ▼
 ┌────────────────────────── Raspberry Pi 5 · ~/car-rental ──────────────────────────┐
 │  car-rental (Node 22: Fastify API + web tĩnh)  ──▶  car-rental-gotenberg (DOCX→PDF) │
 │        │ ./data → /data                                                            │
 │        │   db.sqlite · uploads/ · backups/ · config/local.json · update/            │
 │        ▼                                                                           │
 │  car-rental-updater (docker:cli + docker.sock) ──▶ ghcr.io/happysmartlight/car-rental:X.Y.Z │
 └────────────────────────────────────────────────────────────────────────────────────┘
        │ Telegram Bot API: thông báo, bản tin sáng, sao lưu mã hóa
```

- Một container app phục vụ cả API (`/api/*`) và giao diện (`apps/web/dist`). Không cần nginx.
- Cổng 3002, bind `127.0.0.1` + IP LAN (không `0.0.0.0` — đụng tailscaled).
- Container chạy uid 1000; entrypoint chown `./data` rồi hạ quyền bằng `setpriv`.

## Dữ liệu

SQLite (WAL) + Drizzle, migration SQL trong `apps/api/drizzle/` chạy tự động lúc khởi động.

| Bảng | Vai trò |
|---|---|
| `vehicles`, `vehicle_blocks` | Xe, bảng giá, hạn giấy tờ; khoảng xe vào gara / chủ dùng |
| `accessory_catalog`, `vehicle_accessories` | Danh mục phụ kiện dùng chung (tên chuẩn, tên gọi khác, giá trị đền bù) / phụ kiện từng xe |
| `customers` | Khách: CCCD, GPLX, ảnh giấy tờ, danh sách đen |
| `rentals` | Lượt thuê: lịch hẹn, giờ thực tế, bảng giá chốt lúc đặt (`pricing` JSON), trạng thái |
| `rental_segments` | **Ai giữ xe nào từ lúc nào đến lúc nào (thực tế)** — nguồn tra phạt nguội |
| `rental_drivers` | Người lái phụ |
| `handovers` | Biên bản giao/nhận: ODO, xăng, ảnh, vết trầy, checklist giấy tờ, **phụ kiện có/thiếu (ảnh chụp nguyên khối)**, chữ ký |
| `charges` / `payments` | Phải trả / tiền thực đi lại (in, out, offset = cấn trừ cọc) |
| `collaterals` | Tài sản thế chấp |
| `contract_templates` / `documents` | Mẫu Word có version / văn bản đã sinh (đóng băng, SHA-256) |
| `traffic_fines` | Hồ sơ phạt nguội, gắn lượt thuê + khách |
| `files` | Ảnh/văn bản (file thật trong `data/uploads/YYYY/MM/`) |
| `users`, `sessions`, `audit_log`, `settings`, `sequences`, `reminder_log` | Hệ thống |

Trạng thái lượt thuê: `booked → active → returned → settled → closed` (hoặc `cancelled`).
`settled` = đã quyết toán nhưng còn giữ cọc chờ phạt nguội.

## Tính giá (`shared/pricing.ts`)

Khối 24 giờ kể từ giờ nhận. Khối bắt đầu ngày cuối tuần (giờ VN) → giá cuối tuần; rơi vào kỳ lễ → + % phụ thu.
Giờ lẻ: trong ân hạn bỏ qua; ≤ N giờ và rẻ hơn 1 ngày → tính giờ; còn lại +1 ngày. Trả trễ / vượt km tính lúc nhận xe.
Xe có **giá tháng**: tính thêm phương án theo tháng dương lịch (`addMonthsVn`, 31/01 + 1 tháng = 28/02), ngày lẻ = giá tháng ÷ 30,
không phụ thu cuối tuần/lễ, km = km/tháng × số tháng; lấy phương án rẻ hơn. Chưa đủ tháng mà tính ngày đắt hơn → áp giá 1 tháng.
Giá xe được **chốt vào lượt thuê** lúc đặt; đổi lịch thì tính lại các dòng tiền thuê tự sinh (`charges.auto`).

## Hợp đồng

`docxtemplater` render mẫu Word với dữ liệu "làm phẳng" (`{khach.ho_ten}`, vòng lặp `{#khoan}…{/khoan}`).
Biến trống in "……………" để điền tay. PDF do Gotenberg (LibreOffice) chuyển; lỗi thì vẫn có file Word và nút "Tạo PDF" thử lại.
Mẫu dựng sẵn sinh bằng `apps/api/scripts/build-default-templates.ts`, đăng ký vào DB lần đầu khởi động.

## Phụ kiện

- Thêm cho xe bằng `catalogId` hoặc tên. Tên được chuẩn hóa không dấu (`accessoryKey`) → "sac du phong" dùng lại "Sạc dự phòng"; tên mới tự vào danh mục.
- Gợi ý (`suggestAccessories`): +60 xe cùng dòng có, +10/xe khác có (+25 nếu quá nửa đội), +45 đồ xe điện cho xe điện, +30 đồ thiết yếu. Đồ "chỉ xe điện" không gợi ý cho xe xăng.
- Biên bản giao xe chụp lại danh sách phụ kiện (tên, số lượng, giá trị, có/không). Biên bản nhận so với lúc giao; thiếu → giao diện thêm khoản `accessory` = giá trị × số lượng.

## Kiểm tra phạt nguội

- Trang chính thức (csgt.bocongan.gov.vn) có reCAPTCHA → app **không** tự tra ở đó.
- `services/fineCheck.ts` hỏi dịch vụ tra cứu công khai `api.checkphatnguoi.vn` (không chính thức, có lúc sập) theo biển số.
  Lỗi → trả `{ ok: false }`, giao diện chuyển sang: chép biển số, mở trang chính thức, người dùng dán kết quả →
  `shared/violationText.ts` đọc các dòng "Thời gian vi phạm / Hành vi / Địa điểm / Trạng thái".
- Mỗi vi phạm được khớp người giữ xe qua `lookupFine` (rental_segments) và đánh dấu nếu đã có trong hồ sơ (cùng biển, lệch ≤ 1 phút).
- Lịch tự kiểm tra (mặc định mỗi tuần, sau 9h): vi phạm *chưa xử phạt* mới → tự ghi hồ sơ + Telegram; dịch vụ lỗi thì thử lại sau 6 giờ, chỉ báo Telegram lần đầu.

## Chia sẻ bảng giá

Vẽ ảnh JPEG 1080px bằng canvas trên máy người dùng (`apps/web/src/lib/shareCard.ts`), gửi qua Web Share API
(Zalo, Messenger…) hoặc tải về. Không tạo link công khai — app chỉ chạy trong Tailscale.

## Sao lưu

- **Hằng đêm** (mặc định 2h): `VACUUM INTO` → gzip → `data/backups/db-*-nightly.sqlite.gz`. Giữ 30 bản ngày + 12 bản đầu tháng + 10 bản trước cập nhật/khôi phục.
- **Ra ngoài Pi**: Telegram, file `.crbk` = AES-256-GCM (khóa scrypt từ mật khẩu), nội dung gzip. Mỗi đêm gửi DB đầy đủ + ảnh/văn bản mới phát sinh (gói ≤ 40MB).
- **Khôi phục**: chọn bản trên giao diện (xem trước số khách/lượt thuê) hoặc tải file lên (`.sqlite.gz` / `.crbk`). Luôn tự sao lưu bản hiện tại trước.

## Cập nhật

```
 App (Cài đặt → Cập nhật)                         updater (sh, docker.sock)
 ────────────────────────                         ─────────────────────────
 1. GitHub Releases API → có bản mới?
 2. Bấm "Cập nhật lên vX":
    · sao lưu DB (pre-update)
    · tải deploy/docker-compose.yml + updater.sh
      của tag vX vào data/update/staged/
    · ghi data/update/request.env  ───────────▶  3. thấy request → request.processing
                                                  4. kiểm tra compose mới (config -q) → thay
                                                  5. .env: CAR_RENTAL_VERSION=X → compose pull
                                                  6. (quay về kèm dữ liệu: khôi phục DB)
                                                  7. compose up -d (trừ chính updater)
                                                  8. chờ /api/health báo version X (≤ 4 phút,
                                                     bỏ sớm nếu container restart ≥ 3 lần)
                                                     ✗ → .env/compose cũ + khôi phục DB pre-update → up
                                                  9. updater.sh mới → thay rồi exec lại chính nó
 10. Trang chờ /api/version = X → tải lại  ◀────  state.env (heartbeat 10s, phase, result)
```

- Giao tiếp bằng file `key=value` (không cần jq). Updater không mở cổng mạng.
- Tự cập nhật ban đêm: bật trong app, chạy đúng giờ đã chọn, **bỏ qua** nếu có giao/nhận xe trong 2 giờ tới.
- Máy khác đang mở bản cũ: banner "Đã có bản mới" (so `/api/version`); file JS cũ trả 404 → trang tự tải lại.
- Đã kiểm thử thật với Docker + registry nội bộ: cập nhật (8s), bản lỗi tự quay về (10s), quay về kèm dữ liệu.

## Bảo mật

- Đăng nhập: scrypt, cookie httpOnly, phiên 30 ngày trượt; chặn 10 lần sai/15 phút/IP.
- Vai trò: `admin` (mọi thứ) / `staff` (đặt xe, giao nhận, thu tiền, khách, phạt nguội; không cài đặt, sao lưu, báo cáo tiền).
- Ảnh giấy tờ chỉ qua API có đăng nhập; xem bản đầy đủ ghi `audit_log`.
- Truy cập từ ngoài chỉ qua Tailscale (chưa mở ra Internet).

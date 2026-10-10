# KẾ HOẠCH — Car Rental (quản lý cho thuê xe tự lái)

> Lộ trình thực thi. Việc chưa làm / câu hỏi chưa trả lời: [BACKLOG.md](BACKLOG.md).
> Định làm gì không có trong plan → cập nhật plan trước, rồi mới code.

Cập nhật: 2026-10-06

## Trạng thái

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Khung repo, Docker, CI → GHCR, updater + trang cập nhật, sao lưu + khôi phục, đăng nhập | ✅ v0.1.0 |
| 1 | Xe · Khách (QR CCCD) · Đặt xe, tính giá, lái phụ · Lịch xe · Hợp đồng tự động · Giao/nhận · Tiền, cọc, VietQR · Tra phạt nguội | ✅ v0.1.0 |
| 2 | Hồ sơ phạt nguội + giữ cọc · Nhắc hạn giấy tờ · Telegram · Backup ra ngoài Pi | ✅ v0.1.0 (làm sớm) |
| 3 | Bảo dưỡng & chi phí · Báo cáo · Excel | ✅ Phần lớn v0.3.0 (trang Thu chi: chi phí xe/chung, khoản định kỳ, lãi theo xe/tháng, xuất Excel) · ⬜ lịch bảo dưỡng theo hạng mục, nhập Excel |
| 4 | Chữ ký màn hình ✅ · Lễ Tết ✅ · Danh sách đen ✅ · Phân quyền ✅ · Đổi xe giữa chừng ⬜ · 2FA ⬜ · Bot tra cứu ⬜ | ⬜ Một phần |
| 5 | Ký gửi · Web Push · Đặt xe công khai · OCR AI · Tự tra phạt nguội | ⬜ |
| 6 | Xe có tài | ⬜ Để sau |

## Quyết định đã chốt (2026-10-06)

- Quy mô ~5 xe, 1 nhân viên giao xe, khách cũng tự tới lấy xe → có phân quyền Quản trị / Nhân viên.
- Chạy stack riêng ở `~/car-rental` trên Pi, cổng 3002, Tailscale Serve HTTPS.
- Repo `happysmartlight/car-rental`, image `ghcr.io/happysmartlight/car-rental`.
- Sao lưu ra ngoài Pi qua Telegram (như Family Organizer), có mã hóa.
- Cập nhật bằng updater riêng (có rollback), không dùng Watchtower.

---

## 1. Mục tiêu

- Quản lý trọn vòng đời một lượt thuê xe tự lái: đặt xe → làm hợp đồng → giao xe → nhận xe → quyết toán → hoàn cọc.
- Lưu khách hàng và lịch sử thuê đủ chi tiết để khi có **phạt nguội**: nhập biển số + giờ vi phạm là ra ngay ai đang giữ xe, kèm hợp đồng đã ký và ảnh giấy tờ.
- Tạo hợp đồng tự động từ thông tin khách. Quét QR trên CCCD là điền gần hết form.
- Chạy trên Pi 5 homelab. Cập nhật ngay trong app, không mở terminal.
- Giao diện hiện đại, dùng tốt trên điện thoại (lúc giao xe là đứng ngoài bãi cầm điện thoại).
- Thiết kế dữ liệu chừa sẵn chỗ cho **dịch vụ xe có tài** sau này, không phải đập đi làm lại.

Ngoài phạm vi đợt này: xe có tài, app riêng cho khách, kết nối GPS, hóa đơn điện tử.

### Nguyên tắc thiết kế

1. **Không xóa cứng** khách, lượt thuê, hợp đồng. Chỉ ẩn/lưu trữ. Phạt nguội có thể về sau nhiều tháng.
2. **Giờ thực tế mới là sự thật.** Tra phạt nguội dựa trên giờ giao/nhận xe thực tế, không phải giờ dự kiến trên hợp đồng.
3. **Tài liệu đã ký là bất biến.** Sửa mẫu hay sửa thông tin khách sau này thì hợp đồng cũ vẫn y như lúc ký.
4. **Sửa dữ liệu nhạy cảm phải có lý do.** Đổi giờ giao/nhận, số tiền sau khi đã quyết toán → bắt nhập lý do, ghi nhật ký.
5. **Một múi giờ:** Asia/Ho_Chi_Minh ở mọi nơi. Lệch giờ là tra phạt nguội ra sai người.

---

## 2. Đề xuất bổ sung (bạn chưa nhắc nhưng nghề này cần)

| # | Bổ sung | Vì sao |
|---|---|---|
| 1 | **Quét QR trên CCCD** để điền form | QR trên CCCD gắn chip / thẻ Căn cước chứa sẵn số CCCD, họ tên, ngày sinh, giới tính, nơi thường trú, ngày cấp. Đọc offline, không gửi ảnh đi đâu, 2 giây xong. |
| 2 | **Biên bản giao/nhận xe có ảnh** | ODO, mức xăng/pin, ảnh 4 góc + nội thất + vết trầy sẵn có, đồ đi kèm. Lúc nhận xe, ảnh trước/sau đặt cạnh nhau. Bằng chứng khi tranh chấp trầy xước. |
| 3 | **Giữ cọc phạt nguội** | Sau khi trả xe giữ lại một phần cọc X ngày (cấu hình). App nhắc đến hạn hoàn. |
| 4 | **Tài sản thế chấp** | Cọc tiền / xe máy + cà vẹt / giấy tờ khác: ảnh, ngày nhận, ngày trả, ai đang giữ. |
| 5 | **Nhắc hạn giấy tờ xe** | Đăng kiểm, bảo hiểm TNDS, bảo hiểm thân vỏ, phí đường bộ, bảo dưỡng theo km/tháng. |
| 6 | **Lịch xe dạng timeline** | Mỗi hàng một xe, cột là ngày. Chặn đặt trùng, có thời gian đệm giữa 2 lượt để rửa xe. |
| 7 | **Tính giá tự động** | Giá ngày, giờ lẻ, cuối tuần, lễ Tết, giới hạn km/ngày + phụ thu vượt km, quá giờ, giao xe tận nơi, bù xăng, vệ sinh, phí cầu đường. |
| 8 | **Mã VietQR khi thu tiền** | QR chuyển khoản đúng số tiền, nội dung = mã hợp đồng. Khách quét bằng app ngân hàng, đối chiếu dễ. |
| 9 | **Thông báo Telegram** | Xe sắp đến giờ trả / quá giờ, giấy tờ sắp hết hạn, đến hạn hoàn cọc, backup lỗi, có bản cập nhật. Sau đó thêm lệnh tra nhanh: `/phatnguoi 51K12345 20/09 14:30`. |
| 10 | **Sao lưu tự động + khôi phục trên UI** | Dữ liệu dùng để truy trách nhiệm. Mất là mất luôn. |
| 11 | **Phân quyền + nhật ký thao tác** | Nhân viên giao xe tạo được biên bản nhưng không xóa hợp đồng, không xem báo cáo tiền. Mọi lần xem ảnh CCCD đều ghi log. |
| 12 | **Danh sách đen** | Khách từng gây sự cố / bùng phạt nguội: cảnh báo đỏ ngay khi quét CCCD. |
| 13 | **Chữ ký trên điện thoại/tablet** | Khách ký ngay trên màn hình, chữ ký nhúng vào PDF. Đợt đầu vẫn nên in giấy ký tay song song (xem mục 9). |
| 14 | **Chủ xe ký gửi** | Nếu sau này nhận xe người khác để cho thuê: chia doanh thu theo %, đối soát hằng tháng. |

---

## 3. Tính năng chi tiết

### 3.1 Xe
- Biển số, hãng/dòng/đời/màu, số chỗ, hộp số, nhiên liệu (xăng/dầu/điện), số khung, số máy, ODO hiện tại.
- Ảnh xe, ảnh giấy đăng ký. Hạn đăng kiểm, bảo hiểm, phí đường bộ.
- Bảng giá riêng từng xe (kế thừa bảng giá mặc định).
- Trạng thái: sẵn sàng · đã đặt · đang cho thuê · bảo dưỡng · ngừng hoạt động.
- Chủ xe: nhà mình hoặc ký gửi.
- Trang chi tiết xe: lịch sử thuê, chi phí, bảo dưỡng, phạt nguội, doanh thu, ảnh tình trạng gần nhất.

### 3.2 Khách hàng
- Họ tên, ngày sinh, giới tính, số CCCD, ngày cấp, nơi cấp, nơi thường trú, địa chỉ hiện tại, SĐT, Zalo, email, người liên hệ khẩn cấp.
- GPLX: số, hạng, ngày hết hạn. Cảnh báo khi hết hạn hoặc hạng không đủ cho xe.
- Ảnh: CCCD 2 mặt, GPLX 2 mặt, ảnh chân dung lúc nhận xe.
- **Nhập nhanh:** quét QR CCCD bằng camera → điền tự động. Nơi cấp tự suy theo loại thẻ/ngày cấp. Vẫn sửa tay được.
- Quét trúng CCCD đã có trong hệ thống → mở hồ sơ cũ: số lần thuê, công nợ, phạt nguội chưa xử lý, cờ danh sách đen.
- Tìm theo tên, SĐT, CCCD, biển số từng thuê.

### 3.3 Đặt xe & lượt thuê (trung tâm của app)

```
Báo giá → Đã đặt (cọc giữ chỗ) → Đang thuê (đã giao xe) → Đã trả xe → Đã quyết toán → Hoàn tất (đã hoàn cọc phạt nguội)
               └→ Hủy (ghi lý do, xử lý cọc)
```

- Chọn khách + xe + giờ nhận/trả + nơi giao/nhận → app tính giá và kiểm trùng lịch.
- Người lái chính + lái phụ (lái phụ cũng quét CCCD/GPLX).
- Gia hạn giữa chừng → phụ lục, tính lại tiền.
- Đổi xe giữa chừng (xe hỏng) → lượt thuê ghi nhiều đoạn: xe A từ… đến…, xe B từ… đến…. Tra phạt nguội vẫn đúng.
- Cọc: cọc giữ chỗ, cọc thuê, tài sản thế chấp, phần cọc giữ lại cho phạt nguội.
- Thanh toán nhiều lần, nhiều hình thức (tiền mặt / chuyển khoản / VietQR), mỗi lần có biên nhận.
- Quyết toán khi trả xe: tiền thuê + phụ phí − đã trả − cọc → khách trả thêm hoặc hoàn lại, tự trừ phần giữ lại cho phạt nguội.

### 3.4 Hợp đồng tự động
- Mẫu là **file Word (.docx)** bạn soạn, chèn biến kiểu `{khach.ho_ten}`, `{xe.bien_so}`, `{tien.tong}`, `{tien.tong_bang_chu}`. Đổi mẫu = upload file Word mới, không sửa code.
- Nhiều mẫu: hợp đồng thuê, biên bản giao xe, biên bản nhận xe, phụ lục gia hạn, biên nhận tiền, cam kết phạt nguội.
- Xuất DOCX (để sửa tay nếu cần) và PDF (để in / gửi Zalo).
- Số hợp đồng tự sinh: `HD-2026-0001`.
- File đã sinh được đóng băng: lưu PDF + phiên bản mẫu + mã băm SHA-256.
- Upload ảnh/scan bản giấy đã ký tay vào hồ sơ.
- Tiền bằng chữ tiếng Việt, ngày dạng "ngày 06 tháng 10 năm 2026".
- Mình soạn sẵn mẫu đầu tiên có điều khoản phạt nguội và điều khoản đồng ý xử lý dữ liệu cá nhân.

### 3.5 Giao xe / nhận xe (thiết kế cho điện thoại)
- Wizard từng bước: ODO → xăng (thanh trượt theo vạch) → chụp ảnh theo khung gợi ý (trước, sau, trái, phải, nội thất, táp-lô có ODO) → đánh dấu vết trầy trên sơ đồ xe → đồ đi kèm → khách ký.
- Ảnh tự nén để Pi lưu nhẹ, đóng dấu giờ + biển số lên ảnh.
- Lúc nhận xe: ảnh lúc giao hiện bên cạnh để so. Ghi hư hỏng mới → tạo khoản phí.
- Tự tính vượt km, quá giờ, thiếu xăng.

### 3.6 Phạt nguội (yêu cầu cốt lõi)
- **Tra ngược:** nhập biển số + ngày giờ vi phạm → app trả lời ngay:
  - Lượt thuê nào đang giữ xe lúc đó (theo giờ giao/nhận thực tế và các đoạn đổi xe), người lái chính, lái phụ.
  - SĐT, ảnh CCCD/GPLX, PDF hợp đồng đã ký, ảnh biên bản giao xe.
  - Nếu không ai thuê: xe đang ở bãi / đang ở gara / bạn tự dùng.
  - Vi phạm sát giờ giao/nhận (±2 giờ) → cảnh báo để kiểm tra kỹ.
- **Hồ sơ vi phạm:** thời gian, địa điểm, lỗi, mức phạt, nguồn (csgt.vn, thông báo giấy, VNeTraffic), ảnh thông báo.
  Trạng thái: mới phát hiện → đã báo khách → khách tự nộp / mình nộp hộ → đã thu lại (hoặc trừ cọc) → đóng.
- Danh sách khách còn nợ phạt nguội. Cờ đỏ khi họ quay lại thuê.
- Nhắc tra cứu định kỳ (mặc định mỗi tuần): danh sách xe kèm nút mở trang tra cứu chính thức. Tự động tra để phase sau vì trang chính thức có captcha, cần khảo sát.

### 3.7 Bảo dưỡng & chi phí xe
- Lịch bảo dưỡng theo km hoặc theo tháng (dầu, lốp, má phanh…), nhắc khi gần đến.
- Chi phí gắn với xe: sửa chữa, rửa xe, xăng, đăng kiểm, bảo hiểm, gửi xe, trả góp…
- Xe vào gara → trạng thái "bảo dưỡng", chặn đặt, lưu khoảng thời gian (cũng dùng cho tra phạt nguội).

### 3.8 Tài chính & báo cáo
- Tổng quan: xe đang cho thuê, giao hôm nay, trả hôm nay, quá giờ; doanh thu tháng; tỉ lệ lấp đầy từng xe; việc cần làm (cọc đến hạn hoàn, giấy tờ sắp hết hạn, phạt nguội chưa xử lý).
- Báo cáo doanh thu, chi phí, lợi nhuận theo xe/tháng; top khách; công nợ.
- Xuất Excel. Nhập Excel dữ liệu khách/xe đang có.

### 3.9 Hệ thống
- Đăng nhập, phân quyền: Quản trị · Nhân viên · (sau này) Tài xế.
- 2FA (mã TOTP) cho tài khoản quản trị.
- Nhật ký thao tác.
- Cài đặt: thông tin bên cho thuê (in lên hợp đồng), tài khoản ngân hàng (VietQR), bảng giá mặc định, số ngày giữ cọc phạt nguội, Telegram bot, mẫu hợp đồng.
- Sao lưu / khôi phục / cập nhật (mục 5).

---

## 4. Kiến trúc kỹ thuật

Giữ bộ quen thuộc từ KidTube / Family Organizer để dễ bảo trì.

| Lớp | Chọn | Ghi chú |
|---|---|---|
| Repo | npm workspaces: `apps/api`, `apps/web` | Như KidTube |
| Backend | Node 22 + TypeScript + Fastify | |
| Database | SQLite (better-sqlite3, WAL) + Drizzle ORM, **migration có version** | Một doanh nghiệp, vài người dùng → SQLite dư sức, backup là 1 file. Dùng migration thật (không `db push`) để cập nhật tự động không làm mất dữ liệu. |
| Frontend | React 19 + Vite + Tailwind v4 + shadcn/ui + lucide | TanStack Query, TanStack Table, react-hook-form + zod |
| PWA | Cài lên màn hình iPhone, safe-area, sáng/tối | |
| Quét QR CCCD | zxing (WASM) qua camera | iOS Safari chưa có BarcodeDetector nên cần thư viện. Camera bắt buộc HTTPS, Tailscale Serve lo phần này. |
| Ảnh | sharp: nén WebP + thumbnail | |
| Hợp đồng | docxtemplater (DOCX) + Gotenberg (LibreOffice) → PDF | Gotenberg là container riêng, chỉ mạng nội bộ |
| Thông báo | Telegram Bot API; Web Push ở phase sau | |
| Thời gian | `TZ=Asia/Ho_Chi_Minh`, DB lưu UTC | |

### Sơ đồ triển khai

```
 Điện thoại / laptop (có Tailscale)
            │  HTTPS  https://dietpi.latxa-goby.ts.net:3002
            ▼
 ┌──────────────────── Raspberry Pi 5 (DietPi) ─────────────────────┐
 │  tailscale serve --https=3002 → 127.0.0.1:3002                    │
 │                                                                   │
 │  car-rental (API + web) ───────▶ gotenberg (DOCX→PDF, nội bộ)     │
 │     │  ./data: db.sqlite, uploads/, contracts/, backups/          │
 │     │  ./data/update/  (hộp thư trao đổi với updater)             │
 │     ▼                                                             │
 │  car-rental-updater (docker.sock) ──▶ ghcr.io/…/car-rental:vX.Y.Z │
 └───────────────────────────────────────────────────────────────────┘
```

- Port **3002** (đã dùng: 2283, 3000, 3001, 8080, 8090, 8443, 9443).
- Bind `127.0.0.1` + `192.168.1.2`, không bind `0.0.0.0` (đụng tailscaled như đã gặp).
- Image `node:22-slim` (Debian), tránh lỗi musl như ke-toan-noi-bo.
- Container chạy uid 1000; entrypoint tự chown thư mục data (tránh lỗi quyền đã gặp ở Family Organizer).
- Giới hạn RAM/CPU để không tranh tài nguyên với Immich.

---

## 5. Cập nhật ngay trên web app

GitHub Actions build image arm64 mỗi khi tạo tag `vX.Y.Z` → đẩy lên GHCR kèm changelog. Pi không phải build, không cần mã nguồn trên Pi.

Trang **Cài đặt → Phiên bản & Cập nhật**:

| Kiểu cập nhật | Hoạt động |
|---|---|
| Phát hiện bản mới | Mỗi 6 giờ hỏi GitHub Releases. Có bản mới → chấm đỏ trên menu + tin Telegram, kèm changelog tiếng Việt. |
| Cập nhật 1 chạm | Bấm "Cập nhật lên v1.3.0" → sao lưu DB → kéo image → khởi động lại → chạy migration → kiểm tra sức khỏe → xong. Có thanh tiến trình và log trực tiếp. |
| Tự cập nhật theo lịch | Tùy chọn bật: tự cập nhật lúc 2–4 giờ sáng, **bỏ qua nếu có lượt giao/nhận xe trong 2 giờ tới**. |
| Quay về bản cũ | Danh sách các phiên bản đã cài, bấm để về lại, kèm khôi phục bản sao lưu DB tạo ngay trước lần cập nhật đó (vì migration có thể đã đổi cấu trúc). |
| Tự rollback | Bản mới khởi động lỗi hoặc health check hỏng trong 2 phút → tự về bản trước + báo Telegram. |
| Cập nhật cấu hình Docker | Bản mới cần đổi `docker-compose.yml` (thêm service/biến) → updater tải compose đi kèm release và áp dụng, giữ nguyên `.env` của bạn. Đây là chỗ Watchtower ở Family Organizer không làm được. |
| Làm mới trình duyệt | Máy nào đang mở bản cũ → banner "Đã có bản mới — bấm để tải lại" (so commit như Family Organizer, xử lý cache PWA của iOS). |

**Cơ chế:** sidecar `car-rental-updater` (alpine + docker CLI + jq), học từ updater của KidTube: trao đổi với app qua file trong `data/update/` (`request.json` / `state.json` / log), không mở cổng mạng nào. Khác KidTube ở chỗ nó **kéo image có sẵn theo tag** thay vì `git pull` + build trên Pi → cập nhật khoảng 1 phút thay vì 10+ phút, và rollback được theo tag.

**Cài lần đầu:** một lệnh `setup.sh` (tạo `.env`, chown data, cấu hình `tailscale serve`). Đây là lần duy nhất phải mở terminal.

### Sao lưu
- Hằng đêm: `VACUUM INTO` cho SQLite + ảnh/hợp đồng (chỉ chép file mới). Giữ 30 bản ngày + 12 bản tháng.
- Tự backup trước mỗi lần cập nhật / khôi phục.
- Gửi ra ngoài Pi, **đã mã hóa** vì có ảnh CCCD khách: Telegram, Google Drive (rclone) hoặc ổ khác. ✏️
- Khôi phục trên UI: chọn bản → xem trước (ngày, số khách, số hợp đồng) → khôi phục.

---

## 6. Giao diện

- shadcn/ui, tông trung tính + một màu nhấn, sáng/tối, font Be Vietnam Pro (dấu tiếng Việt đẹp).
- Desktop: sidebar trái. Điện thoại: thanh tab dưới (Tổng quan · Lịch · **+** · Khách · Thêm). Nút **+** mở nhanh: Đặt xe / Giao xe / Nhận xe / Tra phạt nguội.
- Ô tiền tự nhóm hàng nghìn khi gõ (1.500.000), như Family Organizer.
- Tìm kiếm toàn cục (Ctrl+K): tên, SĐT, CCCD, biển số, mã hợp đồng.
- Viết `docs/DESIGN.md` làm chuẩn chung trước khi vẽ màn hình.

Màn hình chính: Tổng quan · Lịch xe · Lượt thuê · Wizard đặt xe · Wizard giao/nhận xe · Khách hàng · Xe · Phạt nguội · Bảo dưỡng & chi phí · Báo cáo · Cài đặt.

---

## 7. Dữ liệu (bảng chính)

```
users, audit_log, settings
vehicles, vehicle_documents (đăng kiểm/bảo hiểm/phí đường bộ + hạn), vehicle_owners
price_plans, price_rules (cuối tuần, lễ Tết, theo mùa)
customers, customer_documents (CCCD/GPLX + ảnh), blacklist_entries
rentals                  type = self_drive | with_driver   ← chừa sẵn cho xe có tài
rental_vehicle_segments  xe nào, từ giờ nào đến giờ nào    ← nguồn sự thật để tra phạt nguội
rental_drivers           người lái chính / lái phụ
handovers (giao/nhận: odo, xăng, ghi chú, chữ ký) + handover_photos + damages
charges, payments, deposits, collaterals
contract_templates (có version), documents (file đã sinh, đóng băng, SHA-256)
traffic_fines + fine_events (nhật ký xử lý)
maintenance_schedules, maintenance_records, expenses
notifications
-- để dành: drivers, trips (xe có tài)
```

`rental_vehicle_segments` có ngay từ Phase 1 dù màn hình "đổi xe giữa chừng" làm sau, để dữ liệu tra phạt nguội đúng từ ngày đầu.

---

## 8. Lộ trình

| Phase | Nội dung | Kết quả |
|---|---|---|
| 0 | Khung repo, tài liệu (REQUIREMENTS, ARCHITECTURE, DESIGN), Docker, CI → GHCR, **updater + trang cập nhật**, sao lưu hằng đêm + khôi phục, đăng nhập | App rỗng chạy trên Pi và đã tự cập nhật được bằng nút bấm. Làm trước để mọi phase sau lên Pi bằng chính nút này. |
| 1 | Xe · Khách (quét QR CCCD, ảnh giấy tờ) · Đặt xe, tính giá, lái phụ · Lịch xe · Hợp đồng tự động · Giao/nhận xe · Thanh toán, cọc, VietQR · **Tra ngược phạt nguội** | **MVP**: dùng thật với khách |
| 2 | Hồ sơ phạt nguội đầy đủ + giữ cọc · Nhắc hạn giấy tờ · Telegram · Backup ra ngoài Pi | Yên tâm về pháp lý và dữ liệu |
| 3 | Bảo dưỡng & chi phí · Tổng quan & báo cáo · Xuất/nhập Excel | Biết xe nào lời, xe nào lỗ |
| 4 | Chữ ký trên màn hình · Giá lễ Tết, khuyến mãi · Đổi xe giữa chừng · Danh sách đen · 2FA · Phân quyền nhân viên · Telegram bot tra cứu | Nâng cao |
| 5 | Chủ xe ký gửi & đối soát · Web Push · Trang đặt xe công khai (cần mở ra Internet) · OCR GPLX bằng AI · Tự tra phạt nguội | Mở rộng |
| 6 | **Xe có tài**: tài xế, chuyến, giá theo km/chuyến, lương/hoa hồng tài xế | Để sau |

---

## 9. Pháp lý & dữ liệu cá nhân

Đây là lưu ý khi thiết kế, không phải tư vấn luật.

- Ảnh CCCD, GPLX là dữ liệu cá nhân. Luật Bảo vệ dữ liệu cá nhân có hiệu lực từ 1/1/2026. Hợp đồng nên có điều khoản khách đồng ý cho lưu và dùng thông tin để quản lý hợp đồng, xử lý vi phạm giao thông.
- Vì vậy app: ảnh giấy tờ chỉ xem được khi đăng nhập, không có link công khai; ghi log ai xem; backup ra ngoài phải mã hóa; không gửi ảnh CCCD cho dịch vụ AI bên ngoài trừ khi bạn tự bật (QR đọc offline nên không cần AI).
- Chữ ký vẽ trên màn hình là chữ ký điện tử thông thường, giá trị chứng cứ yếu hơn chữ ký tay hoặc chữ ký số. Đợt đầu nên in giấy ký tay, app lưu bản scan.
- Mẫu hợp đồng mình soạn chỉ là điểm xuất phát. Nên nhờ người có chuyên môn xem lại các điều khoản phạt nguội, hư hỏng, cọc.

---

## 10. Câu hỏi ban đầu

Đã trả lời: 1, 4, 5, 6, 9 (xem "Quyết định đã chốt"). Còn treo: 2, 3, 7, 8 → [BACKLOG.md](BACKLOG.md).

1. **Quy mô:** bao nhiêu xe? Chỉ bạn dùng hay có nhân viên giao xe?
2. **Mẫu hợp đồng:** bạn có sẵn file Word nào không? Bên cho thuê đứng tên cá nhân, hộ kinh doanh hay công ty?
3. **Thế chấp:** đang nhận cọc tiền, xe máy + cà vẹt hay hình thức khác? Mức cọc thường bao nhiêu? Giữ cọc phạt nguội bao nhiêu ngày?
4. **Cách cập nhật:** updater riêng như mục 5 (có rollback, cập nhật được cả compose), hay dùng lại Watchtower đang chạy (đơn giản hơn, không rollback)? Mình đề xuất updater riêng.
5. **Vị trí chạy:** stack độc lập ở `~/car-rental`, hay gộp vào `liu-homelab`? Mình đề xuất độc lập vì updater cần quản compose riêng; thêm link vào homepage.
6. **Repo GitHub:** đặt dưới `happysmartlight` hay tài khoản cá nhân? Tên app là gì?
7. **RAM của Pi 5:** 4, 8 hay 16 GB? Gotenberg dùng khoảng 300–500 MB lúc chuyển PDF, Immich ML đang giữ 1,4 GB.
8. **Truy cập:** chỉ qua Tailscale là đủ, hay sau này cần khách mở link từ Internet (ký online, đặt xe)?
9. **Backup ra ngoài Pi:** Telegram, Google Drive hay ổ cứng khác?

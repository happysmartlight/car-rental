# Việc còn treo

Ghi lại những gì chưa làm / chưa quyết, xử lý dần. Cập nhật: 2026-10-06.

## Câu hỏi chưa trả lời (từ PLAN mục 10)

| # | Câu hỏi | Đang tạm làm |
|---|---|---|
| 2 | Có mẫu hợp đồng Word sẵn không? Bên cho thuê là cá nhân, hộ kinh doanh hay công ty? | Dùng 3 mẫu dựng sẵn. Gửi file Word thật → chuyển thành mẫu có biến. Thông tin bên A nhập ở Cài đặt → Cửa hàng. |
| 3 | Thế chấp kiểu gì, cọc bao nhiêu, giữ cọc phạt nguội bao nhiêu ngày? | Hỗ trợ cả cọc tiền lẫn tài sản (xe máy + cà vẹt, giấy tờ). Mặc định giữ 2.000.000 đ trong 15 ngày (sửa ở Cài đặt → Giá & quy định), không vượt tiền cọc của lượt; sửa được cho từng lượt lúc đặt xe. |
| 7 | Pi 5 bao nhiêu RAM? | Giới hạn: app 768MB, Gotenberg 1GB (chỉ dùng khi in PDF). Pi 4GB vẫn chạy được nếu Immich không quá nặng. |
| 8 | Có cần khách mở link từ Internet (ký online, đặt xe)? | Chỉ qua Tailscale. Nhân viên giao xe cần cài Tailscale trên điện thoại. |
| — | Repo public hay private? | Tài liệu giả định public (như Family-Organizer): runner ARM64 miễn phí + Pi kéo image không cần đăng nhập. |

## Việc phải làm để chạy thật

- [x] Đẩy code lên `happysmartlight/car-rental`.
- [ ] Phát hành v0.1.0: `npm run release -- 0.1.0` → `git push && git push --tags`; chuyển package GHCR sang Public.
- [ ] Trên Pi: chạy `setup.sh`, mở `https://dietpi.latxa-goby.ts.net:3002`, tạo tài khoản, nhập thông tin cửa hàng + tài khoản ngân hàng.
- [ ] Thêm 5 xe (bảng giá, hạn giấy tờ). Cấu hình Telegram + mật khẩu mã hóa sao lưu, bật gửi hằng đêm.
- [ ] Thêm link vào homepage của liu-homelab.
- [ ] Thử quét QR trên CCCD thật và thẻ Căn cước mẫu mới (định dạng QR mẫu mới chưa kiểm chứng trên thẻ thật).

## Chưa làm (theo lộ trình)

### Phase 2–3
- [ ] Đổi xe giữa chừng (dữ liệu `rental_segments` đã sẵn, thiếu giao diện + API).
- [ ] Chi phí xe (sửa chữa, xăng, rửa xe…), lịch bảo dưỡng đầy đủ — hiện mới có mốc bảo dưỡng km/ngày + nhắc.
- [ ] Báo cáo doanh thu / lợi nhuận theo xe, theo tháng; biểu đồ; xuất Excel. Nhập Excel dữ liệu khách/xe cũ.
- [ ] Biên bản nhận xe in SAU khi quyết toán: số liệu quyết toán đang là gợi ý tính lại, nên lấy từ các phiếu đã ghi.

### Ý tưởng thêm
- [ ] Chia sẻ báo giá của một lượt đặt cụ thể (ngày nhận/trả + tổng tiền) cho khách trước khi chốt.
- [ ] Ảnh riêng cho từng phụ kiện (đã có cột `photo_file_id`, chưa có giao diện).

### Phase 4
- [ ] Đánh dấu vết trầy trên sơ đồ xe (hiện chọn vị trí trong danh sách).
- [ ] 2FA (TOTP) cho tài khoản quản trị.
- [ ] Telegram bot tra cứu: `/phatnguoi 51K12345 20/09 14:30`.
- [ ] Mã khuyến mãi, khách thân thiết.
- [ ] Kênh cập nhật thử nghiệm (beta) — hiện chỉ theo bản phát hành chính thức.

### Phase 5
- [ ] Chủ xe ký gửi: đối soát chia doanh thu theo tháng (đã có trường % ở xe).
- [ ] Web Push (thông báo trên iPhone không qua Telegram).
- [ ] Trang đặt xe công khai (cần mở ra Internet: Cloudflare Tunnel / Tailscale Funnel).
- [ ] OCR GPLX bằng AI (Gemini) — chỉ khi bạn đồng ý gửi ảnh ra ngoài.
- [x] Kiểm tra phạt nguội theo biển số (dịch vụ tra cứu công khai + dán kết quả trang chính thức) — v0.2.0.
- [ ] Thêm nguồn tra cứu dự phòng khi api.checkphatnguoi.vn sập lâu (dịch vụ không chính thức).
- [ ] Nén ảnh HEIC phía máy chủ (hiện dựa vào trình duyệt đổi sang JPEG trước khi gửi).

### Phase 6
- [ ] Dịch vụ xe có tài: tài xế, chuyến, giá theo km/chuyến, lương/hoa hồng (`rentals.type = 'with_driver'` đã chừa sẵn).

## Nợ kỹ thuật đã biết

- Thông báo Telegram gửi kiểu "best-effort", không có hàng đợi gửi lại khi mất mạng.
- Ảnh tải lên không bị xóa khi bỏ khỏi form (file mồ côi) — dung lượng nhỏ, sẽ dọn định kỳ sau.
- Chưa có test giao diện tự động trong CI (đã chạy tay bằng Playwright khi phát triển).

# Thay đổi

Ghi theo phiên bản, mới nhất ở trên. Nội dung mục của từng phiên bản được dùng làm ghi chú
hiển thị trong trang **Cài đặt → Phiên bản & cập nhật**.

## [0.2.9] - 2026-10-08

### Mới
- **Gửi khách thông tin sau khi giao xe, nhận xe, quyết toán** — nút **Gửi khách** trên trang lượt thuê soạn sẵn phiếu (ảnh hoặc tin nhắn chữ) để gửi qua Zalo/Messenger:
  - *Giao xe*: giờ nhận, **giờ hẹn trả**, ODO, mức xăng/pin, được đi tới ODO bao nhiêu, phụ kiện kèm theo, vết có sẵn, tiền đã trả / còn phải trả, cọc đã nhận.
  - *Nhận xe*: giờ trả (trễ bao lâu), số km đã đi, **phụ kiện thiếu và hư hỏng mới**, từng khoản phụ phí, phần sẽ trừ vào cọc.
  - *Quyết toán*: các khoản phí, phần trừ vào cọc, đã hoàn cọc, **số cọc giữ chờ phạt nguội đến ngày nào**.
  - Ảnh phiếu kèm được ảnh xe lúc giao/nhận và **mã QR chuyển khoản** đúng số tiền khách còn phải trả.
- **Xe điện: chính sách sạc pin** — trong **Sửa xe** có mục **Sạc pin**: số lượt sạc miễn phí cho chuyến đến 2 ngày (mặc định 1), từ ngày thứ 3 mỗi ngày thêm 1 lượt (3 ngày: 2 lượt, 5 ngày: 4 lượt…). Sạc quá số lượt thì tính phí mỗi lượt cắm-rút sạc (mặc định 30.000đ, chỉnh riêng từng xe). Đổi giá chỉ áp cho lượt đặt mới.
  - Hiện trên ảnh và tin nhắn chia sẻ thông tin xe / bảng giá (ô tick "Phí sạc (xe điện)").
  - Hợp đồng dựng sẵn ghi rõ số lượt sạc miễn phí của chuyến (mẫu tự cập nhật). Mẫu Word riêng của bạn: thêm `{#co_sac}{gia.sac}{/co_sac}` nếu muốn in.
  - **Nhận xe**: nhập số lượt sạc trong chuyến, app tự tính phụ phí sạc.
  - Xe điện đang có: mở **Sửa xe**, kiểm tra mục Sạc pin (app điền sẵn 1 lượt / 30.000đ) rồi bấm Lưu.

## [0.2.8] - 2026-10-08

### Cải tiến
- **Lịch xe: bấm vào ô ngày là điền sẵn giờ nhận và giờ trả** — trước đây chỉ chọn sẵn xe, ngày bắt đầu thuê vẫn phải nhập lại. Nay form Đặt xe mở ra với đúng ngày đã bấm, nhận xe lúc 8:30 sáng, thuê 1 ngày. Bấm vào hôm nay thì giờ nhận là sớm nhất có thể (sau 1 tiếng).
- **Tự né lịch của xe**: ngày đó lượt trước trả xe trong ngày thì giờ nhận tự lùi sau giờ trả + thời gian dọn xe; vướng lượt kế tiếp thì giờ trả tự kéo sớm cho kịp. Form ghi rõ lý do ngay dưới ô giờ, ví dụ "Nhận 18:00 11/10: sau khi lượt HD-2026-0004 trả xe lúc 16:00 + 120 phút dọn xe".
- **Máy tính: giữ chuột kéo ngang trên hàng xe để chọn nhiều ngày** — khung xanh hiện số ngày đang chọn, thả chuột là mở form thuê đủ số ngày đó. Bấm Esc để hủy.
- Xe đang quá hạn chưa trả: form Đặt xe nhắc "Xe chưa về … gọi khách trước khi chốt giờ nhận".
- **Giờ nhận xe mặc định chỉnh được** trong **Cài đặt → Giá & quy định** (mặc định 8:30).
- Ô ngày đã qua trên Lịch xe không bấm được nữa (tránh đặt nhầm vào ngày cũ).

## [0.2.7] - 2026-10-07

### Cải tiến
- **Thêm/sửa xe: chọn hãng và dòng xe từ danh sách** — VinFast đứng đầu, sau đó Toyota, Hyundai, Kia, Mitsubishi, Honda, Mazda, Ford… Chọn hãng thì chỉ hiện các dòng xe của hãng đó; xe chưa có trong danh sách thì chọn "Khác (tự nhập)". Chọn dòng xe điện (VinFast VF, BYD…) thì nhiên liệu tự chuyển sang "Điện".

### Sửa
- Ô năm sản xuất không còn hiện dấu chấm như số tiền (2022 thay vì 2.022).
- Hộp thoại "Thêm khách mới" trên máy tính: nút "Lưu & chọn khách này" nổi gọn ở góc dưới, không còn dải nền xám kéo dài.

## [0.2.6] - 2026-10-07

### Cải tiến
- **Nút "Hủy lượt" để ngay ngoài trang lượt thuê** (dưới nút Giao xe trên điện thoại, cạnh nút Giao xe trên máy tính) — không còn phải mở menu ⋯. Bấm nhầm không sao: phải nhập lý do và bấm xác nhận mới hủy.
- Hộp thoại hủy ghi rõ: giờ hẹn nhận xe, lúc hủy (trước giờ nhận xe bao lâu), tiền cọc khách đã đặt, và kết luận to rõ **"Khách MẤT CỌC …"** hay **"Khách được HOÀN ĐỦ …"** kèm câu chính sách hủy.
- **Tin nhắn gửi khách** soạn sẵn (thời điểm hủy, chính sách, tiền giữ lại / hoàn lại, lời xin thông cảm) — bấm "Gửi / chép tin nhắn cho khách" để gửi qua Zalo.

## [0.2.5] - 2026-10-07

### Mới
- **Khách hủy sát giờ thì mất cọc**: chính sách hủy mới trong **Cài đặt → Giá & quy định** — hủy trong vòng bao nhiêu giờ trước giờ nhận xe (hoặc không đến lấy xe) thì khách mất bao nhiêu % tiền cọc. Mặc định 72 giờ / 100%, chỉnh theo quy định của cửa hàng.
- Bấm **Hủy lượt thuê**: app cho biết còn bao lâu tới giờ nhận xe, tự gợi ý số tiền giữ lại theo chính sách (vẫn chỉnh được: giữ hết, hoàn hết, giữ một phần) và số tiền phải hoàn cho khách; tích "Đã hoàn tiền cho khách ngay" để ghi luôn phiếu hoàn (chuyển khoản/tiền mặt), hoặc hoàn sau bằng nút Hoàn cọc / Hoàn tiền thuê.
- Tiền cọc giữ lại ghi thành khoản **"Phí hủy (mất cọc)"** và được tính vào doanh thu tháng hủy; sổ tiền của lượt đã hủy về 0, không còn treo "Cọc đang giữ".
- Hợp đồng dựng sẵn có thêm điều khoản hủy thuê theo đúng chính sách đã cài (mẫu tự cập nhật). Mẫu Word riêng của bạn: thêm biến `{tien.chinh_sach_huy}` nếu muốn in.
- Trang Đặt xe mới nhắc chính sách hủy ngay chỗ nhận cọc, để báo trước cho khách.

## [0.2.4] - 2026-10-07

### Cải tiến
- **Lịch xe trên điện thoại vuốt ngang được**: vuốt trái/phải để xem các ngày, cột biển số đứng yên, mỗi lần vuốt dừng gọn vào một ngày. Gần hết thì tự nạp thêm 4 tuần, vuốt tiếp không giới hạn. Nút ‹ › nhảy 1 tuần, "Hôm nay" cuộn về hôm nay.
- Ngày trên lịch rõ hơn: mỗi ngày một cột đủ rộng, không còn chữ ngày dính vào nhau. Biển số dài tự xuống dòng, không tràn ra ngoài.

## [0.2.3] - 2026-10-07

### Sửa
- **Điện thoại: các trang không còn bị tràn ra ngoài màn hình** (khung và ô nhập liệu bị cắt mất bên phải). Gặp ở Tổng quan, Đặt xe mới, Xe, hồ sơ khách và Mẫu hợp đồng — do dòng chữ dài (giá tháng, tên khách, danh sách tiện nghi) kéo rộng cả trang. Nay dòng dài tự xuống dòng hoặc rút gọn bằng "…".
- Danh sách hợp đồng & biên bản trong lượt thuê, danh sách mẫu hợp đồng và thẻ xe đang bảo dưỡng: tên không còn bị bóp mỗi chữ một dòng — các nút tự xuống hàng dưới khi chật.
- Đặt xe mới: dòng thông tin xe hiện đủ cả giá ngày và giá tháng.
- Laptop màn nhỏ / iPad xoay ngang: Đặt xe mới, chi tiết lượt thuê, chi tiết xe và Cài đặt chỉ chia nhiều cột khi đủ rộng, không còn ô nhập bị bóp hẹp.

## [0.2.2] - 2026-10-07

### Sửa
- **iPhone: ô chọn ngày giờ bị tràn ra ngoài khung** (giờ nhận/trả xe khi đặt xe, ngày lễ Tết trong Giá & quy định…). Lỗi này còn làm cả trang bị thu nhỏ — thanh tiêu đề hụt một khoảng bên phải — và mỗi lần chạm vào ô nhập là màn hình tự phóng to. Nay các ô nằm gọn trong khung, trang không còn tự phóng to khi nhập liệu (vẫn chụm hai ngón để phóng to được).
- Phụ thu lễ, Tết: hai ô ngày có nhãn **Từ ngày / Đến ngày**, không còn là hai ô trống khó phân biệt trên điện thoại.

## [0.2.1] - 2026-10-06

### Cải tiến
- **Ghi phạt nguội thủ công thông minh hơn**: chọn xe từ danh sách đội xe (vẫn có "Biển khác" để nhập tay). Vừa chọn giờ vi phạm là app tra ngược lịch sử thuê và hiện ngay người đang giữ xe lúc đó — tên, SĐT, CCCD, mã hợp đồng, giờ giao/nhận, lái phụ — và tự gắn hồ sơ vào khách đó khi lưu.
- Vi phạm sát giờ giao/nhận xe có cảnh báo đối chiếu ảnh và biên bản. Xe ở bãi lúc đó thì gợi ý các lượt thuê kề trước/sau (trong 6 giờ) để chọn nếu giờ trên thông báo bị lệch. Lượt đặt chưa ghi giao xe, xe đang bảo dưỡng/sửa chữa cũng được báo rõ.
- Bấm vào thẻ khách để gắn hoặc bỏ gắn; mở lại hồ sơ cũ không tự đổi khách đã gắn.

## [0.2.0] - 2026-10-06

### Mới
- **Thuê theo tháng**: mỗi xe có giá tháng và giới hạn km/tháng. App tự chọn cách tính rẻ hơn cho khách (theo ngày hay theo tháng dương lịch); ngày lẻ tính bằng giá tháng ÷ 30; thuê gần tháng mà tính ngày đắt hơn thì tự áp giá 1 tháng. Nút chọn nhanh 1 / 3 / 6 tháng khi đặt xe, gia hạn nhanh +1 ngày / +1 tuần / +1 tháng. Giá tháng có trong hợp đồng và ảnh/tin nhắn chia sẻ bảng giá.
- **Kiểm tra phạt nguội chỉ cần biển số**: chọn xe → Kiểm tra, mỗi vi phạm tìm được tự hiện người đang giữ xe lúc đó, bấm "Ghi hồ sơ" một lần. Dịch vụ tra cứu tự động lỗi thì chép biển số, mở trang chính thức của Cục CSGT, dán kết quả vào app — app tự đọc giờ vi phạm. Tra theo giờ (khi có thông báo giấy) chuyển thành mục phụ.
- **Tự kiểm tra phạt nguội cả đội xe** mỗi ngày hoặc mỗi tuần: vi phạm mới tự ghi hồ sơ và báo Telegram kèm tên khách.

### Sửa
- Giao diện tối: ô chọn (dropdown) bị nền trắng chữ trắng — nay có nền tối, đủ tương phản; menu, ô tìm nhanh, danh sách chọn khách nổi rõ trên nền; dòng đang chọn dễ thấy; chữ đỏ/xanh/vàng sáng hơn; thông báo đổi màu theo giao diện.
- Ô chọn thiếu mũi tên và bị cắt chữ.

## [0.1.0] - 2026-10-06

Bản đầu tiên.

### Tính năng
- **Khách hàng**: quét QR trên căn cước để điền form, ảnh CCCD/GPLX, báo trùng hồ sơ, danh sách đen, lịch sử thuê.
- **Xe**: bảng giá (ngày, cuối tuần, giờ lẻ, giới hạn km), hạn đăng kiểm/bảo hiểm/phí đường bộ, mốc bảo dưỡng, lịch gara.
- **Phụ kiện trên xe**: danh mục dựng sẵn ~30 món (cảm biến áp suất lốp, camera, sạc dự phòng, nước hoa…), tìm không dấu và theo tên gọi khác, gợi ý theo xe cùng dòng / cả đội / xe điện, chép từ xe khác, áp cho cả đội. Phụ kiện tự vào checklist giao/nhận và hợp đồng; nhận xe thiếu món nào thì tự đề xuất khoản đền bù.
- **Chia sẻ bảng giá cho khách**: ảnh bảng giá từng xe hoặc cả đội (giá, tiện nghi, phụ thu lễ Tết sắp tới, thủ tục, số liên hệ) và tin nhắn chữ để dán Zalo — gửi qua nút chia sẻ của điện thoại.
- **Đặt xe**: báo giá trực tiếp, thấy xe trống, chặn trùng lịch, cảnh báo GPLX/danh sách đen/phạt nguội còn nợ, lái phụ, cọc, tài sản thế chấp.
- **Hợp đồng tự động**: 3 mẫu Word dựng sẵn, xuất Word + PDF, lưu ảnh bản đã ký. Tải mẫu Word của riêng bạn lên được.
- **Giao / nhận xe** trên điện thoại: ODO, xăng, 6 khung ảnh đóng dấu giờ, vết trầy, giấy tờ kèm theo, chữ ký khách; tự tính phí trễ giờ, vượt km.
- **Quyết toán**: cấn trừ cọc, giữ một phần cọc chờ phạt nguội và nhắc hoàn; mã VietQR đúng số tiền.
- **Phạt nguội**: tra ngược biển số + giờ vi phạm ra người giữ xe; ghi hồ sơ vi phạm, trừ vào cọc.
- **Lịch xe** dạng timeline, **Tổng quan** với việc cần làm, doanh thu tháng, tỉ lệ lấp đầy.
- **Thông báo Telegram** và bản tin buổi sáng.
- **Sao lưu** hằng đêm + gửi Telegram có mã hóa; khôi phục trên giao diện.
- **Cập nhật trong app**: cập nhật một chạm, tự cập nhật ban đêm, tự quay về khi bản mới lỗi, quay về bản cũ kèm dữ liệu.
- Quản trị / nhân viên, nhật ký thao tác, giao diện sáng/tối, cài lên màn hình điện thoại.

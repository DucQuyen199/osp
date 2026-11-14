# Bảo mật

Tài liệu mô tả những gì hệ thống **đã làm**, những gì **chưa làm**, và checklist triển khai. Không có hệ thống nào "an toàn tuyệt đối"; phần "Giới hạn đã biết" ở cuối quan trọng không kém phần còn lại.

## 1. Mô hình mối đe dọa (tóm tắt)

| Tài sản | Mối đe dọa chính | Biện pháp |
|---|---|---|
| Dữ liệu của từng doanh nghiệp | Đọc/ghi chéo tenant | Kernel nhận tenant scope; transaction đặt `app.tenant_id` cho RLS; token gắn với đúng một tenant; tham chiếu chéo tenant bị từ chối |
| Tài khoản | Dò mật khẩu, đánh cắp phiên | Argon2id, giới hạn 5 lần sai/15 phút, token băm, thu hồi phiên |
| Tính toàn vẹn dữ liệu | Ghi dở dang, ghi trùng | Giao dịch PostgreSQL bao cả chuỗi sự kiện; ghi tuần tự hóa |
| Trình duyệt người dùng | XSS, clickjacking | CSP nghiêm, không inline, chỉ `textContent`, `X-Frame-Options: DENY` |
| Máy chủ | Path traversal, body khổng lồ, lặp vô hạn | Chuẩn hóa đường dẫn tệp tĩnh, giới hạn kích thước, giới hạn độ sâu sự kiện |

## 2. Xác thực và phiên

- **Mật khẩu:** Argon2id (`m=19456 KiB`, `t=2`, `p=1`, salt 16 byte ngẫu nhiên, khóa 32 byte), so sánh bằng `subtle::ConstantTimeEq` và chạy trong `spawn_blocking`. Tối thiểu 8 ký tự. Khi tài khoản không tồn tại vẫn chạy Argon2id với giá trị giả để giảm khả năng dò tài khoản qua thời gian phản hồi.
- **Token:** tiền tố `osp_` và hai UUID v4 ngẫu nhiên ở dạng hex. Chỉ lưu **SHA-256** của token; DB bị lộ không đủ để dùng lại token. Danh sách token chỉ trả 12 ký tự đầu của băm làm mã định danh.
- **Phiên** hết hạn sau 12 giờ; bị thu hồi khi đăng xuất, đổi mật khẩu, khóa tài khoản. **API token** có thể đặt hạn.
- Người dùng có thể xem thời gian bắt đầu/hết hạn và tự thu hồi mọi phiên trình duyệt khác trong **Bảo mật tài khoản**; thao tác này chỉ tác động các phiên của chính họ.
- Endpoint Prometheus `/metrics` tắt mặc định; khi bật cần bearer token ngẫu nhiên ≥32 ký tự và chỉ nên được scrape qua mạng riêng/HTTPS. Metrics chỉ dùng nhãn status class, không có tenant hoặc user labels.
- **Chống dò mật khẩu:** 5 lần sai / 15 phút cho mỗi (doanh nghiệp, email), thêm 30 lần đăng nhập/phút/IP.
- Luôn còn ít nhất một quản trị viên hoạt động (không thể tự khóa mình ra khỏi hệ thống).

## 3. Phân quyền
RBAC theo quyền `module.entity.verb`, kiểm tra ở **kernel** (không chỉ ở giao diện) cho mọi thao tác: đọc, tạo, sửa, xóa, từng hành động trạng thái, và các quyền cấp tenant (`tenant.*`). Giao diện chỉ *ẩn* nút theo quyền cho tiện, máy chủ luôn kiểm tra lại. Thao tác do **luật tích hợp** thực hiện chạy với quyền hệ thống (vì đó là hành vi do module định nghĩa), nhưng chỉ được kích hoạt bởi một thao tác đã được người dùng có quyền thực hiện.

## 4. Cô lập đa tenant
- Mỗi bảng nghiệp vụ dùng khóa/phạm vi tenant; kernel mở transaction đặt `app.tenant_id` trước khi truy cập dữ liệu.
- `ref` được kiểm tra trong phạm vi tenant: không thể tạo bản ghi trỏ tới id của tenant khác.
- Token của tenant A gọi tenant B → `403 WRONG_TENANT`.
- Test: `cô lập tenant`, `PostgreSQL: cô lập tenant`, `luồng API đầy đủ`.
- PostgreSQL áp dụng **Row-Level Security** cho mọi bảng nghiệp vụ. Vai trò ứng dụng bắt buộc không có `SUPERUSER` hoặc `BYPASSRLS`; kernel từ chối khởi động nếu phát hiện quyền nguy hiểm.

## 5. An toàn dữ liệu và giao dịch
- Mỗi thao tác ghi cấp cao nhất chạy trong transaction PostgreSQL, bao gồm mọi bước tự động nó kích hoạt; lỗi → `ROLLBACK`.
- Mỗi luật tích hợp chạy trong **savepoint**: luật lỗi chỉ hoàn tác phần của nó, không để lại dữ liệu nửa vời, và không làm hỏng thao tác gốc.
- Các thao tác ghi cùng tenant dùng advisory transaction lock; tenant khác vẫn có thể chạy song song.
- `osp_audit` bật RLS `FORCE` theo tenant. Trigger PostgreSQL chặn `UPDATE`, `DELETE` trực tiếp và `TRUNCATE`; xóa tenant dọn audit qua khóa ngoại cascade. Các thao tác audit từ đăng nhập thất bại và xuất dữ liệu cũng ghi trong transaction tenant-scoped.

## 6. Bảo mật giao diện web
Phản hồi HTML kèm:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```
Giao diện chỉ chèn dữ liệu vào DOM bằng `textContent`; không dùng `innerHTML` với dữ liệu người dùng, không `eval`, không inline. Có test xác nhận HTML không chứa script/style inline, và test path traversal (`/app/../../src/app.ts`, `..%2f`, `%2e%2e`).

## 7. Đầu vào và đầu ra
- Body JSON thông thường tối đa 1 MB, tệp import tối đa 5 MB, attachment tối đa 10 MiB. Import JSON yêu cầu mọi dòng là đối tượng; không âm thầm bỏ qua dòng sai kiểu. Trường entity không được khai báo bị từ chối.
- Tên bảng/cột động được quote an toàn; giá trị đi qua tham số PostgreSQL (không nối chuỗi SQL).
- **CSV injection:** khi xuất, ô chuỗi bắt đầu bằng `= + - @` được thêm `'` để Excel không thực thi công thức. Khi nhập, tiền tố này được gỡ.
- Chuỗi sự kiện giới hạn 12 bước (`EVENT_LOOP`), chống vòng lặp luật.
- Tệp tĩnh: Tower HTTP chỉ phục vụ trong thư mục `OSP_PUBLIC`; kiểm tra đường dẫn canonical và đích index để chặn traversal/symlink ra ngoài, từ chối đường dẫn ẩn. MIME, streaming, HEAD/range và cache revalidation do thư viện xử lý. Triển khai thư mục giao diện ở chế độ chỉ đọc.
- Lỗi nội bộ không lộ stack trace cho client; trả `requestId` để tra log.

## 8. Quyền riêng tư và tuân thủ
| Yêu cầu | Hỗ trợ |
|---|---|
| Quyền truy cập/di chuyển dữ liệu (GDPR Điều 15, 20; Nghị định 13/2023) | Xuất toàn bộ JSON và CSV từng loại, bất cứ lúc nào, bởi người có `tenant.export` |
| Quyền xóa (GDPR Điều 17; Nghị định 13/2023) | `DELETE /api/t/:tid` xóa vĩnh viễn dữ liệu, người dùng, phiên, nhật ký của tenant |
| Nhật ký truy cập/thay đổi | Nhật ký kiểm toán (ai, làm gì, khi nào); không ghi nội dung dữ liệu nhạy cảm |
| Tối thiểu hóa | Không thu thập dữ liệu ngoài những gì người dùng nhập; không bên thứ ba, không font/CDN ngoài |

> Đây là **các tính năng kỹ thuật hỗ trợ tuân thủ**, không phải tuyên bố tuân thủ. Tuân thủ còn gồm chính sách, hợp đồng xử lý dữ liệu, thông báo vi phạm, đánh giá tác động… cần tư vấn pháp lý riêng. Dữ liệu y tế, tài chính có yêu cầu bổ sung (mã hóa, lưu trữ trong nước…).

## 9. Checklist triển khai production

- [ ] Đặt sau **HTTPS** (reverse proxy: Caddy, nginx, Traefik). Ứng dụng không tự dùng TLS.
- [ ] `OSP_ENV=production` (tắt demo mặc định, bật log truy cập JSON).
- [ ] `OSP_DEMO=0`. Cân nhắc `OSP_SIGNUP=0` nếu không cho tự đăng ký.
- [ ] Đặt volume PostgreSQL trên ổ đĩa riêng, **sao lưu định kỳ** và thử khôi phục (xem [DEPLOYMENT.md](DEPLOYMENT.md)).
- [ ] Proxy thêm giới hạn tốc độ theo IP thật (ứng dụng thấy IP của proxy). Thêm `Strict-Transport-Security` ở proxy.
- [ ] Nếu bật `/metrics`, đặt `OSP_METRICS_TOKEN` riêng và chỉ cho phép hệ thống giám sát truy cập qua mạng riêng/HTTPS.
- [ ] Không dùng token quản trị cho tích hợp: tạo vai trò riêng quyền tối thiểu + API token có hạn.
- [ ] Giám sát: log truy cập, nhật ký kiểm toán, lỗi `EVENT_LOOP`/`INTERNAL`.
- [ ] Cập nhật image Rust/PostgreSQL theo bản vá bảo mật.

## 10. Giới hạn đã biết (chưa làm — nói thẳng)

| Giới hạn | Ảnh hưởng | Hướng xử lý |
|---|---|---|
| Chưa có **SSO/OIDC** | Đăng nhập bằng email và mật khẩu nội bộ | Tích hợp IdP theo OIDC và quy trình provisioning |
| Giới hạn tốc độ **trong bộ nhớ, theo IP socket** | Mất khi khởi động lại; sau proxy mọi người cùng một IP | Giới hạn ở proxy / Redis |
| **Không mã hóa dữ liệu khi lưu** (at-rest) | Ai có quyền đọc volume có thể đọc dữ liệu | Mã hóa đĩa (BitLocker/LUKS), hoặc mã hóa volume PostgreSQL |
| Audit append-only chưa chống được DBA/superuser có quyền đổi schema hoặc vô hiệu hóa trigger | Người có quyền quản trị PostgreSQL vẫn có thể thay đổi dữ liệu | Sao chép định kỳ sang kho WORM/độc lập nếu cần bằng chứng chống quản trị DB |
| Giới hạn tốc độ trong bộ nhớ | Mất khi khởi động lại; sau proxy mọi người cùng một IP | Giới hạn ở proxy / Redis |
| Chưa có kiểm thử xâm nhập độc lập, chưa rà soát chuỗi cung ứng thư viện | | Cần làm trước khi bán cho khách có yêu cầu bảo mật |
| Chưa có chính sách mật khẩu nâng cao (độ phức tạp, tra cứu rò rỉ) | Chỉ kiểm độ dài | |

**Báo lỗi bảo mật:** gửi riêng cho chủ dự án, không mở issue công khai.

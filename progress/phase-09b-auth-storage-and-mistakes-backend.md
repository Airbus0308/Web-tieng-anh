# Phase 9B — Auth, Multi-tenant Storage & Mistake-driven Units (Backend)

- **Trạng thái:** ✅ Backend hoàn thành; frontend Phase 9B chờ bàn giao
- **Người thực hiện:** OpenAI Codex
- **Ngày:** 2026-11-16

## Phạm vi

Cung cấp định danh guest, đồng bộ bằng passcode và dữ liệu Study riêng cho từng học viên; tạo bài học từ kết quả Writing/Speaking. Giao diện Profile Pill, thao tác trên thiết bị và màn hình tạo bài thuộc phần frontend Phase 9B.

## Thay đổi

| File | Nội dung |
| :--- | :--- |
| `db/store.js` | Adapter JSON theo user, Upstash REST, chế độ ephemeral; khóa thao tác và sao chép dữ liệu cũ cho user local đầu tiên. |
| `db/auth.js` | Cookie session, profile, passcode scrypt, redeem/merge, giới hạn và thu hồi thiết bị, chống Origin lạ, giới hạn nhập mã sai. |
| `db/mistakes.js`, `config.json` | Chuẩn hóa ngữ cảnh lỗi, prompt AI và fallback 5 bước tất định. |
| `server.js` | Chuyển Placement, Writing, Speaking, progress, SRS, checkpoint, diagnostic và streak sang dữ liệu riêng; thêm nhánh mistakeContext. |
| `tests/smoke.test.js` | Kiểm thử các trình duyệt độc lập, đồng bộ, giới hạn đồng thời, adapter REST giả lập và fallback. |

## Hợp đồng và hành vi

- Trang HTML ứng dụng và các API cấp cookie để trình duyệt có phiên trước khi chạy script. Mỗi trình duyệt được cấp cookie `im_uid=<userId>.<token>` HttpOnly, SameSite=Lax, 400 ngày; Secure trên production hoặc Vercel. Server lưu SHA-256 của token; phiên không hoạt động 60 ngày bị loại. `GET /api/health` không tạo guest hay nhận dữ liệu cũ.
- `GET /api/me`, `POST/PATCH /api/me`; `POST /api/auth/passcode`, `/redeem`, `/logout`; `GET /api/auth/sessions` và `DELETE /api/auth/sessions/:sessionId`. Mã chỉ được trả khi tạo, lưu scrypt với salt; tạo lại thu hồi mã trước. Năm lần nhập sai trong 15 phút theo IP sẽ chặn lần tiếp theo. Origin khác host/protocol bị từ chối đối với request thay đổi dữ liệu.
- Redeem gộp lịch sử guest và `localData`; loại trùng theo ID/timestamp hoặc unitId, giữ mastery cao nhất, hợp nhất ngày streak. Giới hạn ba phiên hoạt động được kiểm tra trong khóa trước khi cấp phiên mới. Thiết bị hiện có có thể thu hồi phiên cũ, rồi thiết bị mới redeem lại.
- Local: `results/users/<userId>/<collection>.json`, metadata trong `results/auth/`. User đầu tiên được sao chép các file lịch sử cũ đã biết; file gốc vẫn được giữ, không sao chép `gemini_keys.json`. Upstash dùng REST qua `fetch`; Vercel thiếu cấu hình Upstash báo `storage: "ephemeral"`.
- `POST /api/study/generate-unit { mistakeContext }` không yêu cầu Placement. Fallback không gọi mạng khi thiếu key, có lesson/theory, flashcards/vocabulary, bốn quiz và ba drill; tối đa năm lỗi/gợi ý được đưa vào SRS riêng và không lặp từ. Có key thì thử AI, kiểm tra schema, chuyển về fallback nếu lỗi hoặc không hợp lệ.

## Kiểm thử

`npm test`: 55 test, 53 pass, 0 fail, 2 skip. Hai test Gemini trực tiếp được bỏ qua do thiếu `GEMINI_API_KEY`. Kiểm thử gồm cookie, migration, cô lập hai user, profile/streak, merge, xoay mã, CSRF, rate limit, thiết bị thứ tư, thu hồi, bốn redeem đồng thời, SRS và fallback khi thiếu key/AI lỗi. Adapter Upstash và một server dùng adapter được kiểm thử với REST giả lập; chưa thử với dịch vụ Upstash thật.

## Bàn giao và giới hạn

- Frontend nên gọi `GET /api/me` và chờ cookie trước khi phát các request API song song lần đầu; tiếp tục áp dụng UI cổng chẩn đoán, ngoại trừ luồng tạo bài từ lỗi.
- Một số ví dụ trong fallback là bài luyện chung khi dữ liệu sửa lỗi không đủ; chúng được ghi rõ không nhất thiết trích từ bài của học viên. IPA của câu sửa tùy biến để trống vì không suy đoán phiên âm.
- Chế độ `ephemeral` dùng `/tmp` trên Vercel và có thể mất dữ liệu sau cold start. Cần cấu hình hai biến Upstash trước khi dùng production; chưa xác thực kết nối live trong lượt này.
- JSON local dùng khóa trong tiến trình; không dùng nhiều tiến trình cùng thư mục kết quả. Với Upstash, khóa có TTL 180 giây và metadata/collection được lưu thành JSON; giới hạn quy mô và độ trễ cần được kiểm tra trên dịch vụ thật. Merge và checkpoint có nhiều bước ghi, có thể cần retry nếu storage lỗi giữa chừng.
- Runtime API keys vẫn dùng kho cấu hình hiện có của máy chủ; không phải dữ liệu hồ sơ cá nhân. Không lưu hay commit khóa, passcode hoặc session token dạng plaintext.

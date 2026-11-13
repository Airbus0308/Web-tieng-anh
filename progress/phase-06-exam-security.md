# Phase 6 — Anti-Copy DRM & Exam Proctoring Security

- **Trạng thái:** ✅ DONE
- **Người thực hiện:** Codex
- **Ngày:** 2026-11-13
- **Commit triển khai:** `a69b37e`

## Mục tiêu

Giảm sao chép đề thi và dán bài mẫu, đồng thời ghi nhận tín hiệu toàn vẹn bài làm trên các trang Placement, Writing và Speaking.

## Các file đã tạo hoặc sửa

| File | Vai trò |
| :--- | :--- |
| `js/exam-security.js` | IIFE `ExamSecurity`: chặn thao tác sao chép/dán, theo dõi chuyển tab và tốc độ gõ, cung cấp `snapshot()` |
| `css/main.css` | Khóa chọn vùng đề, giữ khả năng nhập/chọn văn bản trong input, hiển thị huy hiệu và cảnh báo |
| `index.html`, `writing.html`, `speaking.html`, `analytics.html` | Tải module trên cả bốn trang |
| `js/database.js`, `js/writing.js`, `js/speaking.js` | Gửi `integrity` cùng bài làm tới API |
| `server.js` | Chuẩn hóa `integrity` từ body hoặc `X-Exam-Integrity`, lưu vào lịch sử và trả trong kết quả |
| `tests/smoke.test.js` | Kiểm tra script, tích hợp trang và lưu/trả metadata của ba API |
| `PROGRESS.md` | Đánh dấu Phase 6 hoàn thành |

## API và schema

`integrity: { tabSwitches, pasteAttempts, keystrokes, wpm, burstDetected, flagged }` được gửi trong body của `POST /api/placement/results`, `POST /api/writing/score` và `POST /api/speaking/score`. Server cũng nhận header `X-Exam-Integrity` nếu body không có. Server kiểm tra kiểu dữ liệu, giới hạn các số và tự tính lại `flagged` từ ba tín hiệu cảnh báo.

## Kết quả kiểm thử

- `npm test`: 24 test, 22 pass, 0 fail, 2 skip. Hai test gọi Gemini thật đã có từ trước và được bỏ qua vì môi trường không có `GEMINI_API_KEY`; các test API mới dùng phản hồi AI giả lập và đều chạy.
- `node --check js/exam-security.js`, `node --check server.js`, `git diff --check`: pass.

## Ghi chú bàn giao

- Các giới hạn trong trình duyệt chỉ cản thao tác thông thường; người dùng vẫn có thể xem nội dung đã tải bằng công cụ ngoài trình duyệt. `integrity` là tín hiệu hỗ trợ xem lại, không phải bằng chứng gian lận và có thể bị client giả mạo.
- WPM được ước lượng từ số phím sửa nội dung trong ô bài làm và thời gian kể từ phím đầu tiên. Mic thu âm không làm tăng bộ đếm phím; tăng văn bản >30 ký tự trong một sự kiện `input` khi mic không hoạt động sẽ bật `burstDetected`.
- Phase 7 đang ở trạng thái sẵn sàng bàn giao trong `PROGRESS.md`.

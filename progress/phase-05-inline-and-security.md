# Phase 5 — Production Security & Inline Essay Correction

- **Trạng thái:** ✅ DONE
- **Người thực hiện:** Codex
- **Ngày:** 2026-11-13
- **Commit triển khai:** `6940a77`

## Mục tiêu

Giới hạn file công khai của Express, giới hạn số yêu cầu Gemini theo IP và hiển thị các cụm từ Writing được sửa trực tiếp trong kết quả chấm.

## File đã sửa

| File | Thay đổi |
| :--- | :--- |
| `server.js` | Chỉ phục vụ các trang HTML, `config.json`, `css/`, `js/`, `assets/`; thêm hạn mức dùng chung 10 yêu cầu AI mỗi 15 phút theo IP; lọc correction không khớp bài gốc |
| `config.json` | Bổ sung `inline_corrections` vào yêu cầu JSON gửi Gemini |
| `writing.html`, `css/writing.css`, `js/writing.js` | Khu vực so sánh cụm gốc gạch đỏ → cụm sửa xanh và giải thích; lưu/đọc correction trong lịch sử |
| `tests/smoke.test.js` | Kiểm tra file nhạy cảm không truy cập được, tài nguyên công khai vẫn hoạt động, schema correction và giới hạn AI |
| `PROGRESS.md` | Đánh dấu Phase 5 hoàn thành |

## API và schema

- Bốn endpoint `POST /api/writing/score`, `/api/speaking/score`, `/api/analytics/roadmap`, `/api/analytics/study-plan` dùng chung hạn mức **10 yêu cầu / IP / 15 phút**. Vượt hạn mức trả `429` và header `Retry-After`.
- Kết quả Writing có `inline_corrections: [{ original, correction, explanation }]`. Server trả mảng rỗng nếu AI không cung cấp và bỏ qua mục có `original` không xuất hiện trong bài.
- Các đường dẫn file không thuộc danh sách tài nguyên công khai trả `404`.

## Kiểm thử

- `npm test`: 21 test, 19 pass, 0 fail, 2 skip. Hai test gọi Gemini thật được bộ test hiện có bỏ qua vì môi trường không có `GEMINI_API_KEY`.
- `node --check server.js` và `node --check js/writing.js`: pass.
- `git diff --check`: pass.

## Ghi chú bàn giao

- Hạn mức lưu trong RAM của từng tiến trình. Nếu triển khai nhiều instance, cần dùng nơi lưu trữ chung để áp dụng hạn mức toàn hệ thống.
- `config.json` vẫn là tài nguyên công khai theo yêu cầu sản phẩm; các prompt trong đó có thể được người dùng xem.

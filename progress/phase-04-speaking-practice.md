# ✅ Báo Cáo Tiến Độ — Phase 4: Speaking Practice & AI Examiner

- **Phase:** 04
- **Trạng thái:** ✅ HOÀN THÀNH (DONE)
- **Đơn vị thực hiện:** Claude Code
- **Ngày hoàn thành:** 2026-11-13
- **Commit:** `574872a`

---

## 1. Mục tiêu Phase 4
- Xây dựng trang luyện nói IELTS Speaking Part 2 (Cue Card) & Part 3 (`speaking.html`) theo Dark Theme & Glassmorphism, dùng lại bộ style của `css/writing.css`.
- Đồng hồ luyện nói: 1 phút chuẩn bị rồi 2 phút nói; tự chuyển pha khi hết giờ.
- Thu âm giọng nói thành văn bản qua Web Speech Recognition API, kết hợp `textarea` để gõ hoặc chỉnh sửa transcript (tối thiểu 40 từ mới được chấm).
- Chấm điểm AI theo 4 tiêu chí chính thức: `FC`, `LR`, `GRA`, `PR` (mỗi tiêu chí 25%).
- Tích hợp điểm Speaking vào trang Analytics (điểm trung bình, biểu đồ tiến độ, Skill Breakdown).

## 2. Các File Đã Tạo / Cập Nhật
| File | Vai trò |
| :--- | :--- |
| `speaking.html` | Trang luyện nói: Cue Card, câu hỏi Part 3, đồng hồ, ô transcript, kết quả chấm, sidebar lịch sử |
| `css/speaking.css` | Style bổ sung (cue card, đồng hồ theo pha, nút thu âm); phần còn lại dùng lại `css/writing.css` |
| `js/speaking.js` | Module IIFE `SpeakingApp`: đổi đề, timer, Speech Recognition, gọi API chấm, lịch sử (API + fallback `ielts_speaking_history`) |
| `config.json` | Thêm `speakingSystemInstruction`, `speakingCriteria`, `speakingResponseFormat`, `sampleSpeakingTopics` (5 đề), `speakingWordCountRequirements` |
| `server.js` | Thêm `GET /api/speaking/config`, `POST /api/speaking/score`, `GET /api/speaking/history` |
| `analytics.html`, `js/analytics.js`, `css/analytics.css` | Thẻ điểm Speaking, đưa lượt Speaking vào biểu đồ, Skill Breakdown FC/LR/GRA/PR |
| `index.html`, `writing.html`, `analytics.html` | Thanh điều hướng đủ 4 mục |
| `tests/smoke.test.js` | Thêm 8 test cho Speaking |

## 3. API & Schema Mới
- **`GET /api/speaking/config`**: `{ model, wordCountRequirements: { min: 40, recommended: 120 }, sampleTopics, criteria: [FC, LR, GRA, PR] }`.
- **`POST /api/speaking/score`**: body `{ transcript, topic?, part?, durationSeconds? }`. Trả `400` nếu rỗng hoặc dưới 40 từ (kèm `wordCount`, `minRequired`). Gọi Gemini qua `generateWithRetry`, lưu bản ghi vào `results/speaking_results.json`, trả `{ criteria[4], overall_band, overall_feedback, suggestions, id, timestamp, wordCount }`.
- **`GET /api/speaking/history`**: mảng bản ghi `{ id, timestamp, topic, part, wordCount, durationSeconds, transcript, result }`.
- Cue Card trong `sampleSpeakingTopics`: `{ id, category, part2: { prompt, points[], closing }, part3: [câu hỏi] }`.

## 4. Kết quả Kiểm thử (`npm test`)
- **18 test: 16 PASS, 0 FAIL, 2 SKIP.** Hai test gọi Gemini thật (Writing và Speaking) tự bỏ qua vì máy này không có `GEMINI_API_KEY`; chúng sẽ chạy khi có key.
- Chưa thử trên trình duyệt thật (mic, timer, giao diện); mới kiểm tra cú pháp JS và phần phục vụ file tĩnh.

## 5. Ghi chú bàn giao cho Phase 5 (Inline Essay Correction & Production Security)
- Tiêu chí `PR` được ước lượng từ transcript, không phân tích âm thanh; prompt đã yêu cầu AI nói rõ điều này.
- Rate limit và bảo mật cần áp dụng cho cả `POST /api/speaking/score` giống `/api/writing/score`.
- Web Speech Recognition chạy tốt nhất trên Chrome/Edge; trình duyệt khác tự chuyển sang nhập tay.

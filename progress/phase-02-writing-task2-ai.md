# ✅ Báo Cáo Tiến Độ — Phase 2: Writing Task 2 AI Grader (Gemini API)

- **Phase:** 02
- **Trạng thái:** ✅ HOÀN THÀNH (DONE)
- **Đơn vị thực hiện:** Antigravity
- **Ngày hoàn thành:** 2026-11-12
- **Commit:** `d7f50f9`, `38baa5d`

---

## 1. Mục tiêu Phase 2
Tích hợp tính năng chấm điểm bài viết IELTS Writing Task 2:
- Giao diện có ô nhập văn bản lớn (`textarea`), bộ đếm từ trực tiếp, đồng hồ 40 phút và đề bài mẫu.
- Backend Node.js/Express kết nối Gemini API chấm theo 4 tiêu chí chính thức của IELTS (`TR`, `CC`, `LR`, `GRA`).
- Lưu toàn bộ cấu hình prompt vào `config.json` để dễ dàng chỉnh sửa.
- Kiểm thử tự động và đẩy mã nguồn lên GitHub.

## 2. Các File Đã Tạo / Cập Nhật
| File | Vai trò |
| :--- | :--- |
| `writing.html` | Giao diện luyện viết Writing Task 2, hiển thị điểm 4 tiêu chí và sidebar lịch sử |
| `css/writing.css` | Stylesheet chuyên biệt cho trang Writing (layout 2 cột, thẻ tiêu chí màu sắc theo band) |
| `js/writing.js` | Module `WritingApp` quản lý đếm từ, gửi bài, hiển thị kết quả và lịch sử |
| `config.json` | Cấu hình model (`gemini-3.5-flash`), `systemInstruction`, prompt 4 tiêu chí, `responseFormat`, `sampleTopics` |
| `server.js` | Express server phục vụ file tĩnh và các endpoint `/api/writing/config`, `/api/writing/score`, `/api/writing/history` |
| `tests/smoke.test.js` | Bộ 7 bài kiểm thử tự động bằng `node:test` |
| `package.json` | Khai báo dependencies (`@google/genai`, `express`, `cors`, `dotenv`) và script `npm start`, `npm test` |

## 3. Điểm kỹ thuật đáng chú ý
- **SDK:** Sử dụng SDK mới nhất `@google/genai` với `responseMimeType: 'application/json'`.
- **Cơ chế chống lỗi quá tải:** Hàm `generateWithRetry()` trong `server.js` tự động thử lại tối đa 4 lần (exponential backoff 2s, 4s, 8s) khi Gemini trả lỗi tạm thời `429` hoặc `503`.
- **Lưu trữ kết quả:** Mỗi lần chấm được ghi nối vào `results/writing_results.json` (đã thêm vào `.gitignore`) kèm bản sao ở `localStorage` (`ielts_writing_history`).

## 4. Kết quả Kiểm thử (`npm test`)
- **7/7 bài test PASS**, bao gồm bài test gửi bài luận mẫu 261 từ lên Gemini API thật và nhận về điểm chi tiết 4 tiêu chí (`TR: 8.5, CC: 8.5, LR: 8.5, GRA: 8.5`).

## 5. Ghi chú bàn giao cho Phase 3
- Khi xây dựng trang `analytics.html` ở Phase 3, hãy lấy lịch sử Writing từ `GET /api/writing/history` (chú ý mỗi bản ghi trong `results/writing_results.json` có đối tượng điểm nằm trong trường `record.result`).

# ✅ Báo Cáo Tiến Độ — Phase 3: Backend Sync & Proficiency Analytics Dashboard

- **Phase:** 03
- **Trạng thái:** ✅ HOÀN THÀNH (DONE)
- **Đơn vị thực hiện:** OpenAI Codex & Antigravity (Coordinator Review & Polish)
- **Ngày hoàn thành:** 2026-11-13
- **Commit:** `d9e97e0` (kèm bản vá hoàn thiện Skill Breakdown & Writing Criteria)

---

## 1. Mục tiêu Phase 3
- Đồng bộ kết quả bài kiểm tra Placement Test (`localStorage` ↔ Backend `results/placement_results.json`) theo kiến trúc Offline-first.
- Xây dựng trang Phân tích năng lực (`analytics.html`, `css/analytics.css`, `js/analytics.js`) tổng hợp toàn bộ lịch sử Placement Test và Writing Task 2.
- Hiển thị Overview Cards (Average Band, số lượt làm bài, tổng thời gian luyện tập, Reading %, Listening %, Writing Band).
- Bổ sung bảng phân tích chi tiết **Skill Breakdown** so sánh trực quan Reading %, Listening %, và **4 tiêu chí Writing (`TR`, `CC`, `LR`, `GRA`)** trên thang Band 0–9.
- Thống kê **Weak Areas** theo cấp độ CEFR (`A2`, `B1`, `B2`) kết hợp phát hiện tự động **tiêu chí Writing có điểm trung bình thấp nhất**.
- Tích hợp AI Coach gọi Gemini API (`POST /api/analytics/roadmap` & `/api/analytics/study-plan`) để sinh lộ trình học 4 tuần cá nhân hóa.

## 2. Các File Đã Tạo / Cập Nhật
| File | Vai trò |
| :--- | :--- |
| `analytics.html` | Giao diện Dashboard phân tích năng lực, biểu đồ tiến độ, Skill Breakdown 4 tiêu chí Writing và AI Study Plan |
| `css/analytics.css` | Stylesheet cho trang Analytics (Dark theme, Glassmorphism, responsive grid, skill bars, roadmap cards) |
| `js/analytics.js` | Module `AnalyticsApp` tổng hợp dữ liệu Placement & Writing, tính trung bình 4 tiêu chí `TR/CC/LR/GRA`, vẽ biểu đồ Canvas và gọi API tạo lộ trình |
| `js/database.js` | Nâng cấp `MockDatabase` với `_syncRecord()` và `syncWithServer()` để đồng bộ hai chiều với server |
| `js/app.js` | Gọi `MockDatabase.syncWithServer()` khi khởi tạo ứng dụng |
| `index.html`, `writing.html` | Cập nhật thanh điều hướng (`nav-links`) kết nối đủ 3 trang: Placement Test, Writing Practice, Analytics |
| `config.json` | Bổ sung `analyticsRoadmapPrompt` và `studyPlanPrompt` cấu hình prompt tạo lộ trình học 4 tuần |
| `server.js` | Thêm các endpoint `POST /api/placement/results`, `GET /api/placement/history`, `POST /api/analytics/roadmap` và `POST /api/analytics/study-plan` |
| `tests/smoke.test.js` | Mở rộng bộ kiểm thử tự động kiểm tra trang Analytics, phần `#skill-breakdown` 4 tiêu chí Writing, đồng bộ kết quả và kiểm tra hợp lệ |

## 3. API & Schema Mới
- **`POST /api/placement/results`**:
  - Nhận bản ghi kết quả Placement Test, chống trùng lặp theo `id` (trả về `201` khi tạo mới, `200` nếu đã tồn tại), lưu vào `results/placement_results.json`.
- **`GET /api/placement/history`**:
  - Trả về mảng lịch sử các lần làm bài Placement Test.
- **`POST /api/analytics/roadmap` (và alias `POST /api/analytics/study-plan`)**:
  - Input: `{ weakAreas: [...], summary: { averageBand, reading, listening, writing, writingCriteria: { TR, CC, LR, GRA } } }`
  - Output JSON từ Gemini: `{ overview, targetBand, weeks: [{ week, focus, activities, milestone }], dailyMinutes, successMetrics }`.

## 4. Kết quả Kiểm thử (`npm test`)
- **10/10 bài kiểm thử trong `tests/smoke.test.js` đạt PASS** (9 test chạy trực tiếp + 1 test live Gemini tự động chạy khi có `GEMINI_API_KEY`).

## 5. Ghi chú bàn giao cho Phase 4 (Speaking Practice & Real Listening Audio)
- Hệ thống điều hướng và trang `analytics.html` đã sẵn sàng mở rộng thêm kỹ năng thứ 4 (**Speaking**).
- Ở Phase 4, khi bổ sung âm thanh thật (Audio/Web Speech hoặc file MP3) cho phần Listening trong Placement Test và trang luyện Speaking (`speaking.html`), có thể lưu lịch sử Speaking vào `results/speaking_results.json` để trang Analytics tổng hợp đủ 4 kỹ năng Nghe - Nói - Đọc - Viết.

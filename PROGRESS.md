# 📊 IELTS Master — Bảng Điều Phối & Tiến Độ Dự Án (Project Tracker)

> **Vai trò Điều phối (Project Coordinator):** Antigravity  
> **Đội ngũ Thực thi (Execution Agents):** Antigravity, Claude Code, OpenAI Codex  
> **Repository:** [Airbus0308/Web-tieng-anh](https://github.com/Airbus0308/Web-tieng-anh)  
> **Cập nhật lần cuối:** 2026-11-12

---

## 🗺️ Tổng Quan Lộ Trình (Master Roadmap)

| Phase | Hạng mục (Milestone) | Trạng thái | Người thực hiện | Báo cáo chi tiết | Commit |
| :--- | :--- | :---: | :---: | :--- | :---: |
| **Phase 1** | **Placement Test (Reading & Listening)** — 15 câu MCQ, chấm Band, lưu Mock DB | ✅ DONE | Antigravity | [phase-01-placement-test.md](progress/phase-01-placement-test.md) | `d7f50f9` |
| **Phase 2** | **Writing Task 2 AI Grader** — Giao diện viết, chấm 4 tiêu chí qua Gemini API, `config.json` | ✅ DONE | Antigravity | [phase-02-writing-task2-ai.md](progress/phase-02-writing-task2-ai.md) | `38baa5d` |
| **Phase 3** | **Backend Sync & Proficiency Analytics Dashboard** — Đồng bộ DB + Trang phân tích năng lực & lộ trình AI | 🟡 READY FOR HANDOFF | Claude Code / Codex | `progress/phase-03-analytics-dashboard.md` *(chờ tạo)* | — |
| **Phase 4** | **Speaking Practice & Real Listening Audio** — Thu âm Speaking chấm bằng Gemini + Audio cho Listening | ⚪ PLANNED | Claude Code / Codex | `progress/phase-04-speaking-and-audio.md` *(chờ tạo)* | — |
| **Phase 5** | **Inline Essay Correction & Writing Task 1** — Bôi đỏ lỗi trực tiếp trên câu + Học biểu đồ Task 1 | ⚪ PLANNED | Claude Code / Codex | `progress/phase-05-inline-correction-task1.md` *(chờ tạo)* | — |

---

## 🔄 Quy Trình Phối Hợp Giữa Điều Phối Viên & Các Agent (Workflow Protocol)

Mỗi khi hoàn thành một Phase, Agent thực thi (**Claude Code** hoặc **Codex**) **BẮT BUỘC** thực hiện đủ 4 bước trước khi bàn giao lại cho Điều phối viên:

1. **Chạy kiểm thử:** Tất cả tính năng mới phải có test trong `tests/smoke.test.js` và chạy `npm test` đạt **100% PASS**.
2. **Tạo file báo cáo tiến độ mới:** Tạo một file markdown mới trong thư mục `progress/` theo mẫu chuẩn:
   - Tên file: `progress/phase-XX-<ten-ngan-gon>.md`
   - Nội dung gồm: *Mục tiêu*, *Các file đã tạo/sửa*, *API/Schema mới*, *Kết quả test*, và *Ghi chú bàn giao cho Phase kế tiếp*.
3. **Cập nhật bảng `PROGRESS.md`:** Đổi trạng thái Phase vừa làm sang `✅ DONE`, điền link tới file báo cáo mới trong `progress/`, và chuyển Phase kế tiếp sang `🟡 READY FOR HANDOFF`.
4. **Commit & Push lên GitHub:** Commit với message rõ ràng (`feat(phase-X): ...`) và push lên `origin main` để Điều phối viên nghiệm thu.

---

## 📋 Nhiệm Vụ Đang Mở: Phase 3 (Giao cho Claude Code / Codex)

### Mục tiêu Phase 3: Đồng bộ Database & Trang Phân tích Năng lực (`analytics.html`)

#### 1. Đồng bộ hóa kết quả Placement Test về Backend (`server.js` & `js/database.js`)
- Thêm 2 endpoint vào `server.js`:
  - `POST /api/placement/results` — Nhận kết quả bài Placement Test và lưu nối vào `results/placement_results.json`.
  - `GET /api/placement/history` — Trả về danh sách các lần làm bài Placement Test.
- Cập nhật `MockDatabase` trong `js/database.js`:
  - Khi gọi `saveResult(result)`, vừa lưu `localStorage` vừa gửi `POST /api/placement/results` (không làm hỏng luồng nếu chạy tĩnh không có server).

#### 2. Xây dựng trang Phân tích Năng lực (`analytics.html`, `css/analytics.css`, `js/analytics.js`)
- Cập nhật thanh điều hướng (`nav-links`) ở `index.html`, `writing.html`, và `analytics.html` để có đủ 3 mục: **Placement Test** | **Writing Practice** | **Analytics**.
- Trang `analytics.html` hiển thị:
  1. **Overview Cards**: Estimated Overall Band (trung bình từ Reading, Listening, Writing), tổng số bài đã làm, thời gian luyện tập.
  2. **Skill Breakdown**: Biểu đồ thanh hoặc Radar so sánh Reading %, Listening %, và 4 tiêu chí Writing (`TR`, `CC`, `LR`, `GRA`).
  3. **Weak Areas Analysis**: Thống kê các câu làm sai theo cấp độ CEFR (`A2`, `B1`, `B2`) và tiêu chí Writing có điểm thấp nhất.
  4. **AI Personalized Study Plan**: Nút *"Generate AI Study Plan"* gọi `POST /api/analytics/study-plan` để Gemini tạo lộ trình học 4 tuần dựa trên dữ liệu điểm thật của học viên.

#### 3. Mở rộng `config.json` & `server.js`
- Thêm mục `studyPlanPrompt` vào `config.json` để cấu hình prompt sinh lộ trình học tập.
- Thêm endpoint `POST /api/analytics/study-plan` vào `server.js` sử dụng `generateWithRetry`.

#### 4. Nghiệm thu (Definition of Done)
- Thêm tối thiểu 3 bài test mới vào `tests/smoke.test.js` (`POST /api/placement/results`, `GET /api/placement/history`, `GET /analytics.html`).
- Chạy `npm test` PASS toàn bộ.
- Tạo báo cáo `progress/phase-03-analytics-dashboard.md` và cập nhật bảng trên trong `PROGRESS.md`.
- Push lên nhánh `main`.

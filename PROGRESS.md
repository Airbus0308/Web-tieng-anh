# 📊 IELTS Master — Bảng Điều Phối & Tiến Độ Dự Án (Project Tracker)

> **Vai trò Điều phối (Project Coordinator):** Antigravity  
> **Đội ngũ Thực thi (Execution Agents):** Antigravity, Claude Code, OpenAI Codex  
> **Repository:** [Airbus0308/Web-tieng-anh](https://github.com/Airbus0308/Web-tieng-anh)  
> **Cập nhật lần cuối:** 2026-11-13

---

## 🗺️ Tổng Quan Lộ Trình (Master Roadmap)

| Phase | Hạng mục (Milestone) | Trạng thái | Người thực hiện | Báo cáo chi tiết | Commit |
| :--- | :--- | :---: | :---: | :--- | :---: |
| **Phase 1** | **Placement Test (Reading & Listening)** — 15 câu MCQ, Audio thật khóa tua ngược, mở Transcript sau khi nộp | ✅ DONE | Antigravity | [phase-01-placement-test.md](progress/phase-01-placement-test.md) | `d7f50f9`, `c840741` |
| **Phase 2** | **Writing Task 2 AI Grader** — Giao diện viết, chấm 4 tiêu chí qua Gemini API, `config.json` | ✅ DONE | Antigravity | [phase-02-writing-task2-ai.md](progress/phase-02-writing-task2-ai.md) | `38baa5d` |
| **Phase 3** | **Backend Sync & Proficiency Analytics Dashboard** — Đồng bộ DB + Skill Breakdown 4 tiêu chí Writing & lộ trình AI | ✅ DONE | Codex & Antigravity | [phase-03-analytics-dashboard.md](progress/phase-03-analytics-dashboard.md) | `d9e97e0`, `8d7d3fa` |
| **Phase 4** | **Speaking Practice & AI Examiner** — Luyện nói Part 2/3, thu âm / Speech-to-Text, chấm 4 tiêu chí (`FC`, `LR`, `GRA`, `PR`) | ✅ DONE | Claude Code | [phase-04-speaking-practice.md](progress/phase-04-speaking-practice.md) | `574872a`, `56b9f63` |
| **Phase 5** | **Inline Essay Correction & Production Security** — Bôi đỏ sửa lỗi trực tiếp trên câu + Bảo mật Server & Rate Limit | 🟡 READY FOR HANDOFF | Claude Code / Codex | `progress/phase-05-inline-and-security.md` *(chờ tạo)* | — |

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

## 📋 Nhiệm Vụ Đang Mở: Phase 5 (Giao cho Codex / Claude Code)

### Mục tiêu Phase 5: Inline Essay Correction & Production Security Hardening

#### 1. Vá lỗ hổng bảo mật Server & Rate Limiting trong `server.js` (Chuẩn bị Public Launch)
- **Bảo vệ file nhạy cảm khỏi truy cập tĩnh (`express.static`)**:
  - Thêm middleware hoặc cấu hình chặn truy cập trực tiếp (trả về `403` hoặc `404`) đối với các đường dẫn nhạy cảm: `/.env`, `/.env.example`, `/server.js`, `/package.json`, `/package-lock.json`, `/CLAUDE.md`, `/AGENTS.md`, `/PROGRESS.md`, và các thư mục `/results/*`, `/progress/*`, `/tests/*`, `/scripts/*`.
  - Đảm bảo các trang frontend (`/index.html`, `/writing.html`, `/speaking.html`, `/analytics.html`), `/css/*`, `/js/*`, `/assets/*`, và `/config.json` vẫn phục vụ bình thường để không làm hỏng các bài kiểm thử hiện có.
- **Thêm Rate Limiting cho các API gọi Gemini**:
  - Viết middleware giới hạn tốc độ ngay trong `server.js` (sử dụng `Map` theo IP, cho phép cấu hình qua `process.env.RATE_LIMIT_MAX` mặc định 15 request / 15 phút) áp dụng cho `/api/writing/score`, `/api/speaking/score`, `/api/analytics/roadmap`, `/api/analytics/study-plan`.

#### 2. Bổ sung tính năng Chữa bài Chi tiết theo Câu — Inline Essay Corrections (`config.json`, `writing.html`, `js/writing.js`, `css/writing.css`)
- Mở rộng `responseFormat` trong `config.json` để yêu cầu Gemini trả thêm mảng `"corrections"` (tối đa 5 lỗi tiêu biểu trong bài viết):
  ```json
  "corrections": [
    {
      "original": "<exact phrase or sentence with error from essay>",
      "corrected": "<improved IELTS Band 8+ version>",
      "explanation": "<brief explanation of grammar/lexical fix>"
    }
  ]
  ```
- Trong `writing.html`, `js/writing.js`, và `css/writing.css`:
  - Thêm khu vực **"Sentence-Level Corrections & Upgrades"** ngay trong phần kết quả chấm Writing.
  - Hiển thị trực quan cụm từ gốc bị lỗi (gạch ngang màu đỏ) → cụm từ đã sửa (màu xanh lá) kèm giải thích ngữ pháp/từ vựng.

#### 3. Nghiệm thu (Definition of Done)
- Bổ sung kiểm thử vào `tests/smoke.test.js`:
  - Kiểm tra `GET /.env`, `GET /server.js`, `GET /package.json` trả về `403` hoặc `404`.
  - Kiểm tra schema `responseFormat` trong `config.json` có trường `corrections` và `writing.html` có vùng hiển thị chữa lỗi câu.
- Chạy `npm test` PASS 100%.
- Tạo báo cáo `progress/phase-05-inline-and-security.md` và cập nhật bảng trong `PROGRESS.md` (chuyển Phase 5 sang `✅ DONE`).
- Commit và push lên nhánh `main`.

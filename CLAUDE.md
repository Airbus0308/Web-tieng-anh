# 📘 Hướng dẫn Toàn diện dành cho AI Agent (Claude Code / OpenAI Codex)

Chào mừng bạn đến với dự án **IELTS Master** (`https://github.com/Airbus0308/Web-tieng-anh.git`).  
Tài liệu này giúp một Agent mới hoàn toàn nắm bắt 100% ngữ cảnh dự án chỉ trong 1 phút mà không cần biết lịch sử trước đó.

---

## 1. Bối cảnh & Kiến trúc Dự án (Project Overview)
**IELTS Master** là nền tảng tự học và chấm điểm IELTS ứng dụng AI (Google Gemini), được thiết kế tối giản, tốc độ cao, không dùng framework phức tạp ở Frontend:
- **Backend (`server.js`):** Node.js + Express (ES Modules `"type": "module"`).
  - Sử dụng SDK chính thức `@google/genai` (`new GoogleGenAI({ apiKey })`).
  - Luôn dùng hàm bọc `generateWithRetry(ai, request)` có sẵn trong `server.js` khi gọi Gemini để tự động retry lỗi `429`/`503`.
  - Mọi cấu hình model (`gemini-3.5-flash`), system instruction, tiêu chí chấm và danh sách đề mẫu đều nằm trong `config.json` (không hardcode prompt dài trong `server.js`).
  - Kết quả làm bài trên server được lưu dạng mảng JSON trong thư mục `results/` (sử dụng biến `resultsDir = process.env.IELTS_RESULTS_DIR || path.join(__dirname, 'results')` cùng 2 hàm tiện ích `readJsonArray(filePath)` và `writeJsonArray(filePath, records)` đã có sẵn trong `server.js`).
- **Frontend (`*.html`, `css/*.css`, `js/*.js`):**
  - Vanilla HTML5, CSS3, ES6 JavaScript.
  - Mỗi file JS viết theo mẫu **IIFE Module** (`const ModuleName = (() => { ... return { init, ... }; })();`).
  - Giao diện tuân thủ hệ thống Design Tokens (Dark Theme & Glassmorphism) khai báo ở đầu `css/main.css` (`--bg-primary`, `--bg-card`, `--bg-elevated`, `--accent-primary`, `--accent-teal`, `--accent-green`, `--accent-amber`, `--accent-red`).
  - Khi làm trang luyện kỹ năng mới (như `speaking.html`), hãy lấy **`writing.html`**, **`css/writing.css`**, và **`js/writing.js`** làm hình mẫu chuẩn (layout 2 cột: cột trái là đề bài + khu vực làm bài + kết quả chấm 4 tiêu chí, cột phải là hướng dẫn + lịch sử làm bài).

---

## 2. Thứ tự Đọc Tài liệu Bắt buộc khi Bắt đầu (Onboarding Steps)
Nếu bạn là Agent mới vừa vào dự án, hãy đọc theo đúng thứ tự sau trước khi viết code:
1. **`PROGRESS.md`** — Bảng điều phối trung tâm: xem các Phase đã `✅ DONE` và đọc kỹ yêu cầu chi tiết của Phase đang ở trạng thái `🟡 READY FOR HANDOFF`.
2. **Báo cáo mới nhất trong `progress/`** (`progress/phase-03-analytics-dashboard.md`) — Hiểu các API và cấu trúc dữ liệu vừa hoàn thành ở bước trước.
3. **`server.js` & `config.json`** — Nắm cách tổ chức route Express, đọc/ghi file JSON và cách ghép prompt Gemini.
4. **`writing.html` & `js/writing.js` & `analytics.html` & `js/analytics.js`** — Nắm cấu trúc thanh điều hướng (`<nav class="nav-links">`), cách gọi API chấm điểm, lưu `localStorage` fallback và cách trang Analytics tổng hợp điểm.

---

## 3. Quy tắc Bảo mật & GitHub Push
- **Không bao giờ commit:** `.env`, `node_modules/`, hoặc thư mục `results/`.
- **GitHub push:** Token dùng cho repo này nằm tại `/home/adminairbus/.config/ielts-master/github-token.txt` trên máy Linux/WSL hiện tại (ngoài repository, quyền file `600`). Chỉ đọc khi cần push và đã được người dùng cho phép; không in token ra log, không nhúng vào remote URL lâu dài, không commit token.

---

## 4. Quy trình Bàn giao Bắt buộc sau khi hoàn thành 1 Phase (4 Bước)
Khi hoàn thành nhiệm vụ của một Phase trong `PROGRESS.md`, bạn **BẮT BUỘC** thực hiện đủ 4 bước trước khi kết thúc:
1. **Viết & Chạy Kiểm thử (`tests/smoke.test.js`):**
   - Bổ sung các bài kiểm thử tự động cho trang mới và API mới vào `tests/smoke.test.js`.
   - Chạy lệnh `npm test` và đảm bảo **100% PASS** (0 fail).
2. **Tạo Báo cáo Tiến độ mới trong `progress/`:**
   - Tạo file `progress/phase-XX-<ten-phase>.md` theo đúng mẫu của `progress/phase-02-writing-task2-ai.md` và `progress/phase-03-analytics-dashboard.md`.
3. **Cập nhật bảng `PROGRESS.md`:**
   - Đổi trạng thái Phase vừa làm từ `🟡 READY FOR HANDOFF` sang `✅ DONE`, điền link tới file báo cáo vừa tạo và mã commit.
   - Đổi trạng thái Phase kế tiếp từ `⚪ PLANNED` sang `🟡 READY FOR HANDOFF`.
4. **Git Commit & Push:**
   - Commit với message chuẩn Conventional Commits (ví dụ: `feat(phase-4): add Speaking Practice AI examiner and analytics integration`) và push lên `origin main`.

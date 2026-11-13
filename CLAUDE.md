# Hướng dẫn dành cho AI Agent (Claude Code / OpenAI Codex)

Chào mừng bạn đến với dự án **IELTS Master**. Dự án này được điều phối thông qua hệ thống báo cáo tiến độ theo từng Phase.

## 1. Đọc tài liệu nào trước tiên?
Trước khi viết bất kỳ dòng code nào, hãy đọc:
1. **`PROGRESS.md`** — Bảng điều phối trung tâm, cho biết Phase nào đã xong (`✅ DONE`) và Phase nào đang chờ bạn thực hiện (`🟡 READY FOR HANDOFF`).
2. **File báo cáo mới nhất trong `progress/`** (ví dụ `progress/phase-02-writing-task2-ai.md`) — Nắm rõ kiến trúc, schema dữ liệu và các lưu ý từ Phase trước.
3. **`config.json` & `server.js`** — Hiểu cách dự án cấu hình prompt Gemini và tổ chức API.

## 2. Nguyên tắc Kiến trúc & Coding Style
- **Backend:** Node.js + Express sử dụng ES Modules (`import`/`export`, `"type": "module"`). Dùng SDK `@google/genai` (không dùng `@google/generative-ai` cũ). Mọi prompt AI mới phải đặt trong `config.json`, không hardcode trong `server.js`.
- **Frontend:** Vanilla HTML5, CSS3, ES6 JavaScript. Mỗi file JS trong `js/` viết theo mẫu **IIFE Module** (`const ModuleName = (() => { ... return { ... }; })();`).
- **Giao diện:** Tuân thủ hệ thống biến màu Dark Theme & Glassmorphism trong `css/main.css` (`--bg-primary`, `--bg-card`, `--accent-primary`, `--accent-teal`, `--accent-green`, `--accent-amber`, `--accent-red`).
- **Bảo mật:** Không bao giờ commit file `.env`, `node_modules/`, hoặc `results/`.
- **GitHub push:** Token dùng cho repo này nằm tại `/home/adminairbus/.config/ielts-master/github-token.txt` trên máy hiện tại (ngoài repository, quyền file `600`). Chỉ đọc khi cần push và đã được người dùng cho phép; không in token ra log, không nhúng vào remote URL, không commit token.

## 3. Quy trình Bàn giao Bắt buộc sau khi hoàn thành 1 Phase
Khi bạn hoàn thành nhiệm vụ của một Phase, **bắt buộc** thực hiện đủ 4 bước sau:
1. **Viết & chạy Test:** Bổ sung test vào `tests/smoke.test.js` và chạy `npm test` đảm bảo PASS 100%.
2. **Tạo báo cáo tiến độ mới:** Tạo file `progress/phase-XX-<slug>.md` theo đúng cấu trúc của `progress/phase-02-writing-task2-ai.md`.
3. **Cập nhật `PROGRESS.md`:**
   - Đánh dấu Phase vừa làm thành `✅ DONE`, gắn link tới file báo cáo vừa tạo và mã commit.
   - Đánh dấu Phase tiếp theo thành `🟡 READY FOR HANDOFF` và viết rõ yêu cầu kỹ thuật chi tiết cho Phase đó.
4. **Git Commit & Push:** Commit toàn bộ thay đổi và push lên `origin main` để Điều phối viên (Antigravity) kiểm tra và nghiệm thu.

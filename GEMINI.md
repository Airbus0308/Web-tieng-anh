# 📘 Hướng Dẫn Toàn Diện Dành Cho Gemini CLI (IELTS Academic Architect & AI Prompt Engineer)

Chào mừng **Gemini CLI** gia nhập đội ngũ 5 Agent của dự án **IELTS Master** (`https://github.com/Airbus0308/Web-tieng-anh.git`).  
File `GEMINI.md` này được nạp tự động để cung cấp cho bạn 100% ngữ cảnh dự án và quy tắc phối hợp nhóm.

---

## 1. Cơ Cấu Đội Ngũ 5 Agent & Phân Vùng File (Zero-Conflict Architecture)

Để 5 Agent phối hợp nhịp nhàng mà không ghi đè file của nhau, mỗi Agent phụ trách một phân vùng rõ ràng:

| Agent | Vai trò Chuyên trách | Phân vùng File Chính |
| :--- | :--- | :--- |
| **Antigravity** | **Điều phối viên & Kiến trúc sư trưởng (Coordinator & Architect)** | `docs/*`, `db/schema.dbml`, `PROGRESS.md`, `vercel.json` |
| **Gemini CLI (Bạn)** | **Kiến trúc sư Nội dung Học thuật IELTS, AI Prompting & Ngân hàng Đề** | `config.json` (System instructions, Band descriptors, Sample topics, `visualData`, `keyFacts`, `sampleTextbooks`) |
| **OpenAI Codex** | **Kỹ sư Backend, Lưu trữ & Bảo mật** | `server.js`, `db/store.js`, `db/auth.js`, `db/mistakes.js`, `tests/smoke.test.js` |
| **Claude Code** | **Kỹ sư Frontend & Trải nghiệm Giao diện (UI/UX & SVG)** | `*.html`, `css/*.css`, `js/*.js` |
| **Cursor CLI** | **Kiểm duyệt viên Độc lập (QA, Security & Contract Auditor)** | Kiểm duyệt chéo toàn repo, `tests/smoke.test.js`, `progress/qa-audit-*.md` |

---

## 2. Nguyên Tắc Vàng Khi Làm Việc (Mandatory Rules)

1. **Kiểm tra trạng thái Git trước khi sửa file:**
   - Luôn chạy `git pull origin main` và `git status -s` trước khi bắt đầu.
   - Chỉ chỉnh sửa các file được giao trong nhiệm vụ hiện tại (trọng tâm là `config.json` và báo cáo trong `progress/`), tránh sửa vào `server.js` hoặc `js/*.js` khi Codex / Claude Code đang làm việc song song.
2. **Đảm bảo tính hợp lệ tuyệt đối của JSON (`config.json`):**
   - Sau mọi chỉnh sửa trên `config.json`, bắt buộc chạy kiểm tra cú pháp bằng lệnh:
     `node -e 'JSON.parse(require("fs").readFileSync("config.json", "utf8")); console.log("config.json OK")'`
   - Tuyệt đối không xóa hoặc đổi tên các khóa hiện có trong `config.json` (`model`, `systemInstruction`, `scoringCriteria`, `responseFormat`, `sampleTopics`, `wordCountRequirements`, `speakingSystemInstruction`, `speakingCriteria`, `sampleSpeakingTopics`, `sampleTextbooks`...) để bảo toàn tương thích ngược 100% với bộ kiểm thử `tests/smoke.test.js`.
3. **Bảo mật:**
   - Tuyệt đối không đọc/in hoặc commit `.env`, `results/`, `node_modules/`, hoặc token.

---

## 3. Thứ Tự Đọc Tài Liệu Cho Phase Hiện Tại (Phase 10)

1. `PROGRESS.md` — Xem bảng tiến độ tổng thể.
2. `docs/PHASE_10_DESIGN.md` — Đọc kỹ **Mục 2.1 (Thiết kế `config.json` cho Writing Task 1 Academic & General)**.
3. `config.json` — Nắm cấu trúc hiện tại của dự án trước khi bổ sung cấu hình Task 1.

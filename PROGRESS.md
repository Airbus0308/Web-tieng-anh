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
| **Phase 5** | **Inline Essay Correction, Security & 3-Tier AI Engine** — Chữa lỗi trực tiếp + Khóa file nhạy cảm + AI 3 tầng (Gemini Pool → GitHub Models → Pollinations Free AI) | ✅ DONE | Codex & Antigravity | [phase-05-inline-and-security.md](progress/phase-05-inline-and-security.md) | `6940a77`, `0fd6800` |
| **Phase 6** | **Anti-Copy DRM & Exam Proctoring Security (`js/exam-security.js`)** — Chặn copy đề, chặn paste bài mẫu, chặn phím tắt/chuột phải, cảnh báo chuyển tab & đo tốc độ gõ phím thực tế | ✅ DONE | Codex | [phase-06-exam-security.md](progress/phase-06-exam-security.md) | `a69b37e` |
| **Phase 7** | **Astra AI Textbook & Personalized Mastery Hub (`study.html`)** — Kho giáo trình chuẩn + Upload tài liệu/YouTube + Đếm ngược ngày thi + Chuỗi 5 bước học tương tác (0% → 100% Mastery) | ✅ DONE | Claude Code | [phase-07-astra-study-hub.md](progress/phase-07-astra-study-hub.md) | `PENDING` |

---

## 🎯 Đặc Tả Kỹ Thuật Cho Giai Đoạn Mở Rộng (Phase 6 & Phase 7)

### 🛡️ Phase 6: Anti-Copy DRM & Exam Proctoring Security (`js/exam-security.js`, `css/main.css`, `server.js`)
Tham khảo kiến trúc bảo mật từ các nền tảng thi trực tuyến (HackerRank / Proctorio / SafeExamBrowser Web):
1. **Bảo vệ Nội dung Đề thi (Content DRM)**:
   - Áp dụng `user-select: none` cho toàn bộ vùng bài đọc Reading, câu hỏi trắc nghiệm, đề bài Writing và Cue Card Speaking.
   - Chặn sự kiện `copy`, `cut`, `contextmenu` (chuột phải), `dragstart`, và các tổ hợp phím tắt sao chép / soi mã nguồn (`Ctrl+C`, `Ctrl+U`, `Ctrl+S`, `Ctrl+P`, `F12`, `Ctrl+Shift+I`, `Ctrl+Shift+J`).
2. **Chống Gian lận Dán Bài Mẫu (Anti-Paste & Drop Guard)**:
   - Trên ô nhập bài thi (`#essay-input` ở `writing.html` và `#speaking-input` ở `speaking.html`), chặn hoàn toàn sự kiện `paste` (`Ctrl+V` / chuột phải Paste) và `drop` (kéo-thả văn bản từ ngoài vào), hiển thị thông báo cảnh báo trực quan yêu cầu học viên tự gõ hoặc dùng giọng nói.
3. **Giám sát Hành vi Thi (Proctoring & Keystroke Telemetry)**:
   - **Tab-Switch Detector**: Bắt sự kiện `document.addEventListener('visibilitychange')` và `window.addEventListener('blur')` khi đang trong phiên làm bài (Placement, Writing, Speaking); hiển thị huy hiệu `🛡️ Exam Integrity` trên thanh Header ghi nhận số lần chuyển tab (`Tab Switches: X`) và cảnh báo khi học viên rời trang.
   - **Keystroke Dynamics**: Theo dõi số lần gõ phím thật (`keydown`), tốc độ gõ trung bình (WPM), và phát hiện nếu độ dài văn bản tăng đột biến bất thường (> 25 ký tự trong 1 lần nhập không phải từ mic thu âm), gửi kèm metadata `integrity: { tabSwitches, keystrokes, pasteAttempts, flagged }` khi nộp bài lên server.

---

### 🎓 Phase 7: Astra AI Textbook & Personalized Mastery Hub (`study.html`, `css/study.css`, `js/study.js`, `server.js`)
Lấy cảm hứng từ mô hình **Exam Prep & Step-by-Step Mastery** của **Astra AI (`astra-ai.co/vi`)**:
1. **Nguồn Học Liệu Đa Kênh (Multi-Source Textbook Engine)**:
   - **Kho Giáo trình Chuẩn Tích hợp sẵn (`data/textbooks.json` hoặc `config.json`)**: Gồm các chủ đề/chương cốt lõi từ *Cambridge IELTS Academic*, *Mindset for IELTS*, *English Grammar in Use*, và *Academic Vocabulary in Use* (phân theo Band 4.5–5.5, 6.0–6.5, 7.0–8.0+).
   - **Tự nạp Tài liệu Cá nhân & Link YouTube / Bài báo**:
     - Cho phép học viên tải file tài liệu (`.txt`, `.md`, hoặc dán nội dung từ PDF/DOCX/đề thi cũ).
     - Cho phép dán URL bài báo tiếng Anh hoặc URL YouTube để server trích xuất nội dung/phụ đề (`POST /api/study/extract-source`) và đưa vào AI thiết kế bài học.
2. **Thiết lập Mục tiêu Cá nhân hóa (Exam Countdown & Knowledge Gap Targeting)**:
   - Cho phép chọn **Ngày thi mục tiêu (Exam Date)** + **Band mục tiêu (Target Band)**, tự động hiển thị đồng hồ đếm ngược số ngày còn lại và tự động đọc lỗ hổng kiến thức (`weakAreas`) từ Placement Test, Writing & Speaking để ưu tiên tạo bài học bù đắp đúng kỹ năng yếu nhất.
3. **Chuỗi 5 Bước Học Tập Tương Tác Kiểu Astra AI (Mastery Pipeline `0% → 100%`)**:
   Khi chọn 1 chương giáo trình hoặc tải tài liệu lên, AI (`POST /api/study/generate-unit` qua hệ thống AI 3 tầng) sinh ra một **Unit Học Tập Tương Tác** gồm 5 bước liên hoàn với thanh tiến độ **Thành thạo (`0% → 100%`)**:
   - **Bước 1 — 📖 Smart Lesson (Bài học thông minh — 20%)**: Lý thuyết cô đọng, cấu trúc câu ăn điểm, giải thích song ngữ Anh-Việt dễ hiểu.
   - **Bước 2 — 🗂️ Flashcards (Thẻ ghi nhớ từ vựng/cấu trúc — 40%)**: Giao diện lật thẻ 3D kèm phát âm và câu ví dụ Band 7.5+.
   - **Bước 3 — ⚡ True/False & Quick Quiz (Phản xạ Đúng/Sai & Trắc nghiệm — 60%)**: 5 câu hỏi kiểm tra nhanh kiến thức vừa học, chấm và giải thích ngay tại chỗ.
   - **Bước 4 — 🧩 Knowledge Gap Drill (Bài tập lấp lỗ hổng — 80%)**: Bài tập sửa câu lỗi / điền từ học thuật xoáy sâu vào lỗi ngữ pháp/từ vựng học viên hay mắc.
   - **Bước 5 — 🏆 Mini Mock Output (Thử thách Viết/Nói ngắn — 100%)**: Yêu cầu viết 1 đoạn ngắn (60–80 từ) hoặc trả lời 1 câu hỏi áp dụng từ vựng của bài học và được AI chấm điểm ngay để đạt **100% Mastery**.

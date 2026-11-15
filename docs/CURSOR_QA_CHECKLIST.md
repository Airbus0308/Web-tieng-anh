# 🛡️ Quy Trình & Tiêu Chuẩn Kiểm Duyệt Độc Lập (Cursor CLI — QA & Security Auditor)

> **Vai trò:** Kiểm duyệt viên Độc lập (Independent Code, Security & UX Auditor — Cursor CLI)  
> **Dự án:** IELTS Master (`https://github.com/Airbus0308/Web-tieng-anh.git`)  
> **Cơ cấu Đội ngũ 4 Agent:**
> - **Antigravity:** Điều phối viên & Kiến trúc sư Hệ thống (Project Coordinator & Architect)
> - **OpenAI Codex:** Kỹ sư Backend, Dữ liệu & Bảo mật (`server.js`, `db/*`, `config.json`)
> - **Claude Code:** Kỹ sư Frontend & Trải nghiệm Học tập (`*.html`, `css/*`, `js/*`)
> - **Cursor CLI:** Kiểm duyệt viên Độc lập — Kiểm tra chéo (Cross-Audit), Bảo mật, Hợp đồng API-UI & Kiểm thử Hồi quy (`tests/smoke.test.js`, `progress/qa-audit-*.md`)

---

## 1. Nguyên Tắc Làm Việc của Cursor CLI (Auditor Rules)

1. **Không xung đột Working Tree khi Agent khác đang code:**
   - Trước khi sửa file, luôn chạy `git status` để kiểm tra xem Claude Code hoặc Codex có đang sửa dở các file trong working tree hay không.
   - Khi đang ở chế độ **Kiểm duyệt (Audit Read-Only)**, chỉ đọc code, chạy test và ghi báo cáo vào `progress/qa-audit-phase-XX.md`. Chỉ sửa code trực tiếp khi phát hiện lỗi rõ ràng sau khi Agent thực thi đã commit xong.
2. **Không bao giờ đụng vào dữ liệu nhạy cảm:**
   - Tuyệt đối không đọc/in nội dung `.env`, `results/gemini_keys.json`, hoặc `/home/adminairbus/.config/ielts-master/github-token.txt` ra màn hình.
   - Không commit `.env`, `node_modules/`, hoặc `results/`.
3. **Mọi nhận định phải có bằng chứng (Evidence-Based Review):**
   - Mỗi phát hiện (Finding) phải trích dẫn chính xác `file:line`, mức độ nghiêm trọng (`CRITICAL` / `HIGH` / `MEDIUM` / `LOW`), kịch bản tái hiện lỗi, và đề xuất cách sửa cụ thể.

---

## 2. Danh Mục Kiểm Duyệt Trọng Tâm (Phase 9A & Phase 9B Audit Checklist)

### A. Kiểm duyệt Kiến trúc & Hợp đồng API – Frontend (`Contract Alignment`)
- [ ] **Khởi tạo Phiên (`GET /api/me`) trước các Request song song:**
  - Kiểm tra `js/auth-profile.js` và `js/study.js`: Khi trình duyệt mới chưa có cookie `im_uid`, frontend có đợi `GET /api/me` (hoặc cookie từ trang HTML) hoàn tất trước khi bắn hàng loạt `fetch` song song (`/api/study/diagnostic-status`, `/api/study/progress`, `/api/study/srs`) hay không? (Tránh tạo ra nhiều tài khoản `guest` rác cho cùng 1 tab).
- [ ] **Hợp đồng `POST /api/auth/redeem` và Xử lý Giới hạn 3 Thiết bị (`409 device_limit`):**
  - Backend (`db/auth.js`) trả về `409` kèm danh sách `devices` khi vượt quá `MAX_DEVICES_PER_USER = 3`.
  - Kiểm tra xem `js/auth-profile.js` có hiển thị danh sách thiết bị đang hoạt động và cho phép người dùng thu hồi (`DELETE /api/auth/sessions/:sessionId`) để đăng nhập lại hay không.
  - Lưu ý: Sau khi gọi `DELETE /api/auth/sessions/:sessionId`, kiểm tra xem thiết bị thứ 4 (chưa có session thuộc về chủ tài khoản đó) có quyền xóa session của tài khoản đích khi đang ở bước `409` hay không! *(Đây là điểm mấu chốt cần kiểm tra kỹ trong `db/auth.js`: nếu thiết bị thứ 4 đang là `guest` khác `userId` của passcode, gọi `DELETE /api/auth/sessions/:sessionId` sẽ bị chặn nếu API chỉ cho xóa session của `req.userId` hiện tại mà không nhận kèm `passcode` xác thực!)*
- [ ] **Luồng *"Học từ chính lỗi sai của tôi"* (`mistakeContext`):**
  - Kiểm tra nút `#btn-create-mistake-unit` trong `js/writing.js` và `js/speaking.js`: Payload gửi lên `POST /api/study/generate-unit` có khớp với schema `normalizeMistakeContext` trong `db/mistakes.js` (`sourceType`, `band`, `lowestCriterion`, `lowestCriterionScore`, `prompt`, `userText`, `corrections`, `suggestions`) hay không?
  - Khi chuyển hướng sang `study.html#unit=<id>`, nếu học viên chưa làm Placement Test (`unlocked === false`), `js/study.js` có cho phép mở thẳng `#classroom-view` cho bài học `source === 'mistakes'` mà không bị `#diagnostic-gate` chặn lại không?

### B. Kiểm duyệt Bảo mật (`Security & Data Isolation`)
- [ ] **Bảo mật Cookie & Passcode (`db/auth.js`, `db/store.js`):**
  - Cookie `im_uid` có bật `HttpOnly`, `SameSite=Lax`, và `Secure` trên môi trường production/Vercel không?
  - Passcode (`IELTS-XXXX-XXXX`) có được băm bằng `crypto.scrypt` kèm salt ngẫu nhiên và so sánh bằng `crypto.timingSafeEqual` không?
  - Session token có được băm `SHA-256` trước khi lưu vào `results/auth/sessions.json` / Upstash không?
  - Kiểm tra CSRF Origin check (`assertSameOrigin` hoặc tương đương) trên các route `POST`/`PATCH`/`DELETE`.
- [ ] **Cô lập dữ liệu Multi-Tenant (`server.js`):**
  - Kiểm tra toàn bộ các route `/api/placement/*`, `/api/writing/*`, `/api/speaking/*`, `/api/study/*`: Có còn route nào vô tình đọc/ghi vào file chung `results/*.json` thay vì qua `store.js` theo `req.userId` hay không?
- [ ] **Chống XSS trên Frontend (`js/study.js`, `js/auth-profile.js`, `js/writing.js`, `js/speaking.js`):**
  - Mọi dữ liệu do người dùng nhập (`displayName`, văn bản trích xuất từ `.pdf`/`.docx`, `userAttempt`, `userAgent`) hoặc do AI trả về khi đưa vào `innerHTML` có được bọc qua `escapeHtml()` không?

### C. Kiểm duyệt Giao diện & Trải nghiệm Học tập (`Study Cockpit & Focus Classroom`)
- [ ] **Bảo toàn DOM ID bắt buộc (`tests/smoke.test.js`):**
  - Toàn bộ các ID từ Phase 7 & Phase 8B (`#diagnostic-gate`, `#forethought-panel`, `#kbcp-commitment-box`, `#srs-due-panel`, `#tutor-feedback-panel`, `#exam-date`, `#target-band`, `#textbook-list`, `#lesson-section`...) có còn đầy đủ và hoạt động đúng trên `study.html` không?
- [ ] **Ngân hàng câu hỏi `config.json` & Chuẩn hóa (`server.js`):**
  - Kiểm tra 8 Unit trong `config.json`: Tất cả 32 câu `quiz` và 24 câu `drill` có `skillTag` hợp lệ và không trùng lặp nội dung giữa các Unit không?
- [ ] **Trích xuất `.pdf` / `.docx` phía Client (`study.html`, `js/study.js`):**
  - Nếu CDN của `pdfjs-dist` hoặc `mammoth` không tải được (offline/adblock), giao diện có bắt lỗi êm ái và hiển thị thông báo hướng dẫn người dùng dán văn bản trực tiếp thay vì làm treo trang không?

---

## 3. Mẫu Báo Cáo Kiểm Duyệt (`progress/qa-audit-phase-09.md`)

Sau khi hoàn tất kiểm duyệt và chạy `npm test`, Cursor CLI ghi kết quả vào `progress/qa-audit-phase-09.md` theo cấu trúc:

1. **Tổng quan Kết quả Kiểm duyệt:** (`PASS` / `PASS WITH MINOR ISSUES` / `CHANGES REQUESTED`) + Kết quả `npm test`.
2. **Bảng Đánh giá Theo Hạng mục:** (Kiến trúc & API Contract / Bảo mật & Cô lập dữ liệu / Giao diện & UX / Độ phủ Test).
3. **Danh sách Phát hiện Chi tiết (Findings):**
   - `[CRITICAL / HIGH / MEDIUM / LOW] Tiêu đề lỗi` — Vị trí (`file:line`), nguyên nhân, tác động, và bản vá đề xuất (hoặc đã vá).
4. **Kết luận Nghiệm thu:** Xác nhận Phase 9A & 9B đủ điều kiện đóng (`✅ VERIFIED`) hoặc danh sách mục cần sửa trước khi sang Phase 10.

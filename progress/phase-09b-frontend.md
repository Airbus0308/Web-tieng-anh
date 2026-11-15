# Phase 9B — Frontend: Learner Profile Pill, Sync Passcode, "Learn From My Mistakes" & PDF/DOCX

- **Trạng thái:** ✅ DONE (Frontend; backend xem [phase-09b-auth-storage-and-mistakes-backend.md](phase-09b-auth-storage-and-mistakes-backend.md))
- **Người thực hiện:** Claude Code
- **Ngày:** 2026-11-16
- **Đặc tả:** [docs/PHASE_9_DESIGN.md](../docs/PHASE_9_DESIGN.md) mục 9B-1 và 9B-3. Tài liệu này dùng cách đánh số 9B-x; không có các mục "2.3/2.5/2.6/3.2/3.3" như trong yêu cầu, nên hợp đồng được lấy từ `db/auth.js` và `db/mistakes.js` của Codex.

## Các thay đổi

| File | Nội dung |
| :--- | :--- |
| `js/auth-profile.js` (mới) | Module `AuthProfile`, nạp trước script trang trên cả 5 trang. **Pill `#user-profile-pill`** chèn đầu `.header-right` của `.app-header`; các trang không có `.nav-bar` nên dùng header hiện có. Pill hiển thị `[avatar · Tên · 🎯 Band đầu vào → mục tiêu · 🔥 streak]`, kèm ⚠ khi `storage === "ephemeral"`. **Modal** (`role="dialog"`, `aria-modal`, Esc để đóng, giữ focus trong modal): đổi tên hiển thị; tạo / tạo lại mã `IELTS-XXXX-XXXX` (chỉ hiện 1 lần, có nút sao chép); nhập mã từ thiết bị khác (gửi `localData`); danh sách thiết bị (x/3) có nút **Thu hồi**; đăng xuất (chỉ hiện với tài khoản đã có mã); cảnh báo `ephemeral`. **Lỗi 409 `device_limit`**: modal liệt kê các thiết bị của tài khoản đích, bấm **Thu hồi** sẽ thu hồi thiết bị đó và đăng nhập ngay trong cùng một bước. Có thêm `AuthProfile.createMistakeUnit()` dùng chung và `AuthProfile.updateProfile()` phát sự kiện `ielts:profile-updated`. Style tự nhúng (theo cách của `api-keys.js`). |
| `index.html`, `writing.html`, `speaking.html`, `study.html`, `analytics.html` | Nạp `js/auth-profile.js` trước script trang. Writing và Speaking có thêm nút `#btn-create-mistake-unit` "🎯 Tạo Bài Học Khắc Phục Lỗi Này" trong khu kết quả. |
| `js/writing.js` | Ghi nhớ kết quả đang hiển thị (kể cả khi mở lại từ lịch sử). `createMistakeUnit` gửi `mistakeContext { source: 'writing', recordId, prompt, overallBand, weakestCriterion, corrections (≤10 inline_corrections), suggestions }`. |
| `js/speaking.js` | Như trên với `source: 'speaking'`. Speaking không có câu sửa lỗi nên gửi tiêu chí yếu nhất, suggestions và `transcriptExcerpt` (≤1500 ký tự). |
| `js/study.js` | Lưu Unit cá nhân (AI từ tài liệu và học từ lỗi sai) vào `ielts_custom_units_v1` (tối đa 20). Mục **🎯 Bài học của tôi** ở tab Kho Khóa Học. `#unit=<id>` mở thẳng Phòng học cho Unit lỗi sai **ngay cả khi chưa làm Placement**; Phòng học ẩn Cổng Chẩn đoán, quay về Sảnh thì Cổng hiện lại. Mục tiêu, cam kết và streak đồng bộ lên `/api/me`; khi trình duyệt chưa có giá trị thì lấy từ hồ sơ tài khoản. **PDF/DOCX** được trích xuất ngay trên trình duyệt: `pdfjs-dist@3.11.174` và `mammoth@1.8.0` từ jsDelivr, chỉ tải khi chọn file; tối đa 10 MB và 60.000 ký tự; báo rõ trường hợp PDF scan ảnh không có chữ. |
| `study.html`, `css/study.css`, `css/writing.css` | Mục `#custom-units-section`; ô file nhận `.pdf`/`.docx`; style `.btn-mistake-unit`. |
| `db/auth.js` (backend, bổ sung nhỏ) | (1) `POST /api/auth/redeem` nhận `revokeSessionId`: khi tài khoản đích đã đủ 3 thiết bị, mã đúng cho phép thu hồi 1 phiên của tài khoản đó rồi cấp phiên mới; id không hợp lệ vẫn trả 409. Trước đây thiết bị mới (đang là khách) **không thể** thu hồi vì `DELETE /api/auth/sessions/:id` chỉ áp dụng cho phiên của chính mình. (2) `PATCH /api/me` nhận `commitment` (đã kiểm tra hợp lệ) và `streak` (gộp, không ghi đè). |
| `tests/smoke.test.js` | 5 test mới (xem phần Kiểm thử). |
| `docs/PHASE_9_DESIGN.md` | Cập nhật hợp đồng `redeem { revokeSessionId }` và các trường của `PATCH /api/me`. |

## Quyết định cần lưu ý

- **Tránh lẫn dữ liệu khi đổi tài khoản:** nhập mã thành công thì xoá lịch sử đã được gộp lên server (`ielts_placement_results`, `ielts_writing_history`, `ielts_speaking_history`, `ielts_study_progress`, `ielts_study_synced_placement`) để không đẩy lên lại. Đăng xuất thì xoá toàn bộ dữ liệu học viên trong `localStorage` để guest mới bắt đầu sạch. Khách không thấy nút đăng xuất (đăng xuất sẽ làm mất tiến độ không khôi phục được).
- **Header:** header của 5 trang vốn đã chật (Exam Shield, AI Keys, đồng hồ Writing). Ở bản gốc, trang Writing 1100px đã có menu và AI Keys xuống dòng. Vì vậy pill đầy đủ chỉ hiện ở ≥1480px; hẹp hơn thì thu còn avatar + 🔥 (Band vẫn có trong modal và `aria-label`). Menu chỉ chống xuống dòng ở ≥1100px. Không sửa `main.css`.
- `ielts_custom_units_v1` lưu theo trình duyệt, không theo tài khoản: Unit lỗi sai không tự sang thiết bị khác, nhưng tiến độ mastery của Unit đó thì có (qua `study_progress`).
- Chuyển hướng dùng đường dẫn tuyệt đối `/study.html#unit=<id>` (ứng dụng luôn chạy ở gốc domain).

## Kiểm thử

- `npm test`: 60 test, 58 pass, 0 fail, 2 skip (hai test Gemini trực tiếp cần `GEMINI_API_KEY`).
- Test mới:
  1. 5 trang nạp `auth-profile.js` trước script trang; module biên dịch được và có đủ các API / chuỗi cần thiết.
  2. Writing và Speaking có nút trong khu kết quả, đúng hàm và đúng trường dữ liệu.
  3. `study.js` có logic vượt Cổng cho Unit lỗi sai và trích xuất PDF/DOCX.
  4. `redeem` với `revokeSessionId` hợp lệ thì thành công và thu hồi đúng phiên; id sai vẫn 409.
  5. `PATCH /api/me` kiểm tra hợp lệ `commitment`/`streak` và gộp streak.
- Kiểm tra thủ công bằng Chrome headless trên server riêng:
  - Pill trên cả 5 trang ở 1600 / 1440 / 1280 / 1100px.
  - Modal của khách: tên, tạo mã, nhập mã, thiết bị 1/3, cảnh báo cho khách.
  - **Luồng trọn vẹn với code thật:** guest chưa làm Placement gọi `AuthProfile.createMistakeUnit` → server trả Unit fallback → `/study.html#unit=mistake_writing_…` mở thẳng Phòng học (không có Cổng, breadcrumb "Học từ lỗi sai"). Thực hiện bằng một trang thử tạm trong `assets/`, đã xoá sau khi chạy.
- **Chưa kiểm tra thủ công:** bấm tay trong modal (tạo mã, nhập mã, 409 → Thu hồi, đăng xuất) vì headless chỉ chụp ảnh tĩnh; các luồng này được test ở tầng API. Nút ở trang Writing/Speaking sau khi chấm bằng Gemini thật (máy không có key). Đọc file PDF/DOCX thật qua CDN. Dịch vụ Upstash thật.

# Phase 7 — Astra AI Textbook & Personalized Mastery Hub

- **Trạng thái:** ✅ DONE
- **Người thực hiện:** Claude Code
- **Ngày:** 2026-11-13
- **Commit triển khai:** xem bảng `PROGRESS.md`

## Mục tiêu

Xây trung tâm học tập cá nhân hóa `study.html` theo mô hình Astra AI: kho giáo trình chuẩn, nạp tài liệu cá nhân, đếm ngược ngày thi kèm gợi ý theo lỗ hổng kiến thức, và chuỗi học 5 bước với thanh Mastery `0% → 20% → 40% → 60% → 80% → 100%`.

## Các file đã tạo hoặc sửa

| File | Vai trò |
| :--- | :--- |
| `study.html`, `css/study.css` | Trang Study Hub: banner đếm ngược, kho giáo trình, nạp nguồn (dán / `.txt` `.md` / URL-YouTube), trình học 5 bước, sidebar tiến độ |
| `js/study.js` | IIFE `StudyApp`: mục tiêu + đếm ngược (`ielts_study_goal`), đọc điểm yếu từ ba API lịch sử, gợi ý Unit, trình phát 5 bước, lưu tiến độ (`ielts_study_progress` + server) |
| `config.json` | `sampleTextbooks` (4 bộ, 8 Unit, mỗi Unit có `content` và `sample` đủ 5 bước), `masterySteps`, `studyUnitPrompt`, `studyEvaluatePrompt` |
| `server.js` | Route `/study.html`, 5 API Study, bộ giới hạn tốc độ riêng, bảo vệ SSRF, timeout AI |
| `js/api-keys.js` | Tự gắn khóa API cho `generate-unit` và `evaluate-mini` |
| `index.html`, `writing.html`, `speaking.html`, `analytics.html` | Thêm `Study Hub` vào `nav.nav-links` |
| `tests/smoke.test.js` | 7 test mới cho Study Hub |
| `PROGRESS.md` | Phase 7 → `✅ DONE` |

## API

| Endpoint | Mô tả |
| :--- | :--- |
| `GET /api/study/config` | `sampleTextbooks`, `masterySteps`, giới hạn nguồn |
| `GET /api/study/progress` | Danh sách tiến độ từ `results/study_progress.json` |
| `POST /api/study/progress` | Upsert theo `unitId`; `mastery` ∈ {0,20,40,60,80,100}; không bao giờ hạ mức đã lưu |
| `POST /api/study/extract-source` | `{ text }` hoặc `{ url }` (bài báo hoặc YouTube lấy phụ đề); trả `{ sourceType, title, text, wordCount }`, cắt 12.000 ký tự |
| `POST /api/study/generate-unit` | `{ textbookId, unitId }` hoặc `{ sourceText, title }` + `weakAreas`, `targetBand`; dùng `generateWithKeyPool`, chuẩn hóa schema 5 bước |
| `POST /api/study/evaluate-mini` | Chấm Bước 5 bằng AI; nếu AI không khả dụng thì chấm cục bộ (số từ, từ mục tiêu) |

## Quyết định thiết kế

- **Fallback:** Unit trong kho giáo trình có `sample` đầy đủ 5 bước. Nút "Học ngay" mở tức thì từ cấu hình; nút "Tạo mới bằng AI" gọi `generate-unit`, nếu AI lỗi hoặc trả sai schema thì trả Unit mẫu kèm `fallback: true`. Nguồn cá nhân không có fallback nên trả lỗi rõ ràng.
- **Giới hạn tốc độ:** Study Hub dùng bucket riêng (30 yêu cầu / 15 phút / IP) thay vì dùng chung bucket 10 yêu cầu của chấm điểm, nên bài test rate-limit hiện có giữ nguyên và vẫn PASS.
- **SSRF (`extract-source`):** chỉ `http(s)`, chặn `localhost` và `.local`, phân giải DNS rồi chặn dải IP riêng/loopback/link-local, tự xử lý redirect (kiểm tra lại từng bước, tối đa 3), timeout 10 giây, tối đa 2 MB.
- **Timeout AI:** chấm Bước 5 tối đa 25 giây rồi chuyển sang chấm cục bộ; tạo Unit giáo trình tối đa 60 giây rồi dùng Unit mẫu.
- **Mở khóa từng bước:** lật hết thẻ (Bước 2), trả lời hết câu (Bước 3, 4), chấm xong (Bước 5) mới sang bước kế. Mastery lấy theo bước cao nhất đã hoàn thành.
- **Gợi ý Unit:** xếp điểm yếu theo mức độ (lỗi Placement, tiêu chí Writing/Speaking thấp nhất), ghép với bộ giáo trình có `focus` tương ứng và Band gần mục tiêu nhất, bỏ qua Unit đã 100%.
- Nội dung do AI hoặc người dùng đưa vào luôn được escape HTML trước khi hiển thị.

## Kết quả kiểm thử

- `npm test`: 31 test, 29 pass, 0 fail, 2 skip. Hai test bỏ qua là các test gọi Gemini thật đã có từ trước (cần `GEMINI_API_KEY`). Bảy test mới: trang + nav 5 trang, `GET /api/study/config` (kiểm tra cấu trúc đủ 5 bước của 8 Unit), `GET/POST /api/study/progress`, validation `generate-unit`, fallback sample, `extract-source` (kể cả chặn SSRF), `evaluate-mini` (validation + chấm cục bộ).
- Thử trên trình duyệt thật: mở Unit mẫu, lật thẻ, làm quiz/drill, chấm Bước 5, Mastery đi 0 → 20 → 40 → 60 → 80 → 100%, tiến độ lưu cả `localStorage` lẫn `results/study_progress.json`. Hai lỗi phát hiện và đã sửa trong lúc thử: thanh Mastery chậm một nhịp sau khi xong quiz/drill, và server lưu `miniScore: 0` thay vì `null`.
- Chưa kiểm tra hình ảnh trên di động và chưa thử `extract-source` với URL/YouTube thật.

## Ghi chú bàn giao

- Lấy phụ đề YouTube dựa vào dữ liệu trang xem video (không có API chính thức), có thể hỏng nếu YouTube đổi cấu trúc; khi không có phụ đề, giao diện báo lỗi và gợi ý dán transcript thủ công.
- Trong môi trường có khóa Gemini ở `results/gemini_keys.json` nhưng mạng chập chờn, lần chấm Bước 5 có thể mất tới 25 giây trước khi chuyển sang chấm cục bộ.
- Chưa có Phase 8 trong `PROGRESS.md`.

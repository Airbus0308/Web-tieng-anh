# Phase 8B — SRL-SLA 3-Stage Closed-Loop Study Hub UI

- **Trạng thái:** ✅ DONE
- **Người thực hiện:** Claude Code
- **Ngày:** 2026-11-15

## Mục tiêu và phạm vi

Triển khai giao diện cho chu trình tự điều chỉnh 3 giai đoạn (Zimmerman) trên Study Hub, dùng các API của Phase 8A. Không thay đổi backend.

## Các thay đổi

| File | Nội dung |
| :--- | :--- |
| `study.html` | Thanh 3 giai đoạn `#srl-stage-bar`; `#diagnostic-gate`; `#forethought-panel` gồm hồ sơ năng lực, `#kbcp-commitment-box` (form mục tiêu chuyển vào đây, các ID Phase 7 giữ nguyên), `#srs-due-panel`, `#recommended-curriculum`; sidebar có `#tutor-feedback-panel` và lịch sử lượng giá. |
| `js/study.js` | Đồng bộ Placement, cổng khóa, hồ sơ, KBCP + streak, hàng đợi SRS, giáo trình i+1; Feynman, Active Recall, SRS từ thẻ, Interleaving + gợi ý Socratic, gia sư AI; checkpoint COPES và báo cáo 3 chiều. |
| `css/study.css` | Style cho toàn bộ thành phần mới, có responsive. |
| `tests/smoke.test.js` | 3 test mới: cấu trúc `study.html`, `study.js` biên dịch được và có đủ API/kỹ thuật, selector trong `study.css`. |

## Hành vi chính

- **Đồng bộ và cổng:** đẩy các bản ghi `ielts_placement_results` có `id` chưa đồng bộ lên `POST /api/placement/results` (ghi nhớ trong `ielts_study_synced_placement`; lỗi mạng sẽ thử lại, bản ghi không hợp lệ không thử lại), sau đó gọi `diagnostic-status`. `unlocked === false` ẩn kho giáo trình, nguồn cá nhân và trình học, hiện cổng kèm liên kết `index.html`, `writing.html`, `speaking.html`.
- **Giai đoạn 1:** hồ sơ (Input Band, 4 kỹ năng, `weakAreas`, `calibrationIndex`); Target Band mặc định theo `recommendedTargetBand` khi chưa lưu mục tiêu; cam kết If-Then và streak 7 ngày T2–CN lưu `localStorage`; ôn SRS đến hạn với 4 mức đánh giá; Unit i+1 có `levelTag`, `targetWeakness`, `matchReasonVi`. Unit đầu tiên chưa hoàn thành được dùng làm gợi ý chính.
- **Giai đoạn 2:** Bước 1 có bảng nâng cấp Band và ô Feynman (`mode: "feynman"`); Bước 2 hiện câu khuyết, người học nhập từ rồi Kiểm tra trước khi lật, có IPA, `speechSynthesis`, và nút thêm SRS (`good` nếu nhớ đúng hoặc chưa thử, `again` nếu nhớ sai); Bước 3–4 có nhãn `skillTag` và gợi ý Socratic (`mode: "socratic"`, không gửi đáp án); khung gia sư luôn có mặt khi đang học.
- **Giai đoạn 3:** viết hoặc thu âm (`SpeechRecognition`), tối thiểu 30 từ, bắt buộc chọn `selfPredictedBand` và `selfDifficultyReason` trước khi nộp; báo cáo gồm so sánh 3 cột Band, 3 thanh tiêu chí, từ dùng và bỏ sót, sửa lỗi trực tiếp, `PASSED ✓` hoặc `NEEDS REVIEW ↻`. Sau khi chấm, làm mới lịch sử, tiến độ, hồ sơ và hàng đợi SRS.

## Quyết định cần lưu ý

- Bước 5 chỉ tính hoàn thành khi `passed`; nếu chưa đạt có nút chỉnh sửa và chấm lại. Điều này thay luồng `evaluate-mini` cũ (endpoint vẫn còn trong backend).
- Nếu `diagnostic-status` không truy cập được, giao diện mở giáo trình ngoại tuyến kèm thông báo thay vì khóa cứng.
- Câu Quick Quiz trong config hiện chưa có `skillTag`, nên hiển thị nhãn dự phòng "Core Concept Check"; Drill dùng nhãn thật.
- Đồng bộ Placement chỉ dành cho bản ghi có `id` (bản ghi từ `MockDatabase` luôn có).

## Kiểm thử

- `npm test`: 41 test, 39 pass, 0 fail, 2 skip (hai test Gemini trực tiếp cần `GEMINI_API_KEY`).
- Kiểm tra thủ công trên trình duyệt với server riêng: cổng khóa khi chưa có Placement; sau khi seed `localStorage` thì đồng bộ, mở khóa, hiện hồ sơ và 2 Unit đề xuất; chạy hết 5 bước (Feynman, Active Recall, thêm SRS, gợi ý Socratic, checkpoint) và nhận báo cáo `PASSED ✓` cùng lịch sử ở sidebar. Chưa kiểm tra thu âm thực tế bằng micro.

# Phase 8A — SRL-SLA Adaptive Backend Engine

- **Trạng thái:** ✅ DONE
- **Người thực hiện:** OpenAI Codex
- **Ngày:** 2026-11-15

## Mục tiêu và phạm vi

Cung cấp dữ liệu giáo trình và API cho chu trình chẩn đoán, học có phản hồi, lượng giá và ôn tập. Giao diện tích hợp các API thuộc Phase 8B.

## Các thay đổi

| File | Nội dung |
| :--- | :--- |
| `config.json` | Bổ sung cấp độ, điểm yếu, ví dụ nâng cấp band, câu hỏi Feynman, IPA, cloze và ba dạng bài interleaving cho 8 Unit; bổ sung prompt gia sư và checkpoint. |
| `server.js` | Chuẩn hóa và kiểm tra các trường Unit; sáu API SRL-SLA; lưu SRS, checkpoint, cập nhật mastery; giới hạn 30 yêu cầu AI Study / 15 phút / IP. |
| `tests/smoke.test.js` | Kiểm thử dữ liệu, cổng chẩn đoán, lịch SRS, gia sư, checkpoint, fallback và phản hồi AI giả lập. |

## Hợp đồng API và quyết định

- `GET /api/study/diagnostic-status`: khóa trạng thái khi chưa có Placement; vẫn trả hàng đợi SRS. Điểm Reading/Listening quy đổi từ phần trăm theo ngưỡng Placement; Writing/Speaking và các tiêu chí lấy trung bình từ lịch sử có sẵn. Kỹ năng chưa có dữ liệu là `null`. Input band là trung bình band Placement cùng band Writing/Speaking có sẵn; mục tiêu cao hơn khoảng 0,5 band. Chọn Unit có khoảng band giao với vùng mục tiêu và khớp điểm yếu, kèm mastery đã lưu. `calibrationIndex` là trung bình có dấu của các gap.
- `POST /api/study/tutor-feedback`: kiểm tra mode và đầu vào; AI qua key pool tối đa 20 giây, fallback hướng dẫn học viên tự giải thích mà không tự nhận đã hiểu.
- `GET /api/study/srs`, `POST /api/study/srs/review`: thời hạn again/hard/good/easy là 0/1/3/7 ngày; easy sau ít nhất hai lần ôn trước đó là 14 ngày. Mục khớp ID hoặc từ và Unit được cập nhật; các mục đến hạn so sánh bằng thời điểm UTC.
- `POST /api/study/checkpoint-evaluate`, `GET /api/study/checkpoints`: tối thiểu 30 từ; AI tối đa 25 giây hoặc dùng ước lượng cục bộ. Chỉ chấp nhận sửa lỗi AI có nguyên văn trong bài. Từ còn thiếu và lỗi được đưa vào SRS đến hạn ngay. Bài đạt từ 70 điểm cập nhật mastery 100 khi có unitId hợp lệ.
- Tất cả file kết quả nằm trong `IELTS_RESULTS_DIR`; kiểm thử dùng thư mục tạm riêng và không thay đổi file khóa hiện có.

## Kiểm thử

`npm test`: 38 test, 36 pass, 0 fail, 2 skip (hai test Gemini trực tiếp cần `GEMINI_API_KEY`). Test AI mới dùng provider giả lập; test fallback không gọi nhà cung cấp. Bao gồm lưu và đọc checkpoint, từ thiếu và sửa lỗi trong SRS, mastery, khoảng cách hiệu chuẩn, các mức lịch và bảo toàn trường Unit.

## Bàn giao và giới hạn

- UI Phase 8B cần áp dụng cổng `unlocked`; trạng thái chẩn đoán là API thông tin, các route Study hiện tại chưa bị khóa ở backend.
- Điểm cục bộ là heuristic dựa trên độ dài, số câu, từ mục tiêu và quiz; không thể đánh giá đầy đủ độ phù hợp nội dung hoặc ngữ pháp như giám khảo. Điểm và phản hồi nêu rõ đây là ước lượng.
- Hệ thống lưu JSON đồng bộ theo kiến trúc hiện tại; ba file checkpoint, SRS và tiến độ không tạo thành một giao dịch nguyên tử khi có lỗi ghi hoặc nhiều tiến trình server cùng hoạt động.
- Các bài drill ba kỹ năng trong Unit mẫu hiện dùng chung nội dung minh họa; có thể biên soạn thêm theo chủ đề từng Unit ở giai đoạn nội dung tiếp theo.

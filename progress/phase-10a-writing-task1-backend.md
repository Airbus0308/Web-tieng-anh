# Phase 10A — Writing Task 1 & Overall Writing Band (Backend)

- **Trạng thái:** ✅ Backend hoàn thành; Phase 10B frontend chờ bàn giao
- **Người thực hiện:** OpenAI Codex
- **Ngày:** 2026-11-16

## Phạm vi

Bổ sung ngân hàng đề Writing Task 1 Academic và General, cấu hình giám khảo riêng, chấm điểm theo học viên và tính band Writing kết hợp. Các trường cấu hình và luồng Task 2 cũ vẫn được giữ.

## Thay đổi

| File | Nội dung |
| :--- | :--- |
| `config.json` | Bốn tiêu chí TA/CC/LR/GRA, prompt Task 1, ngưỡng 150 từ; sáu đề bar, line, pie, table, process và formal letter; gắn TA cho hai Unit. |
| `server.js` | Mở rộng config và score; dựng prompt có dữ liệu và key facts; chuẩn hóa TA; lưu loại bài; API summary và tích hợp kết quả với chẩn đoán. |
| `db/mistakes.js` | Nhận tiêu chí TA dạng đối tượng hoặc chuỗi, gợi ý phù hợp báo cáo Academic/thư General khi fallback. |
| `tests/smoke.test.js` | Kiểm thử cấu trúc đề, số từ, prompt, chấm giả lập, lịch sử cũ, công thức, cách ly học viên và điểm yếu TA. |

## Hợp đồng và quyết định

- `GET /api/writing/config` giữ `model`, `wordCountRequirements`, `sampleTopics`, `criteria` của Task 2; thêm `task1WordCountRequirements`, `task1Criteria`, `sampleTask1Topics`. Dữ liệu biểu đồ là dữ liệu minh họa cho bài luyện, không phải thống kê thực tế.
- `POST /api/writing/score` mặc định Task 2 và tối thiểu 250 từ; Task 1 tối thiểu 150 từ. Với đề mẫu, prompt chứa dữ liệu, key facts, bullet points và tone tương ứng; đề tự nhập có thể cung cấp `visualSummary`. AI trả TR cho Task 1 được chuẩn hóa thành Task Achievement/TA. Không yêu cầu hay hiển thị overview cho thư General.
- Bản ghi theo `req.userId` lưu `taskNumber`, `subType`, `topicId`. Response bổ sung `writingBandSummary` mà không bỏ các trường cũ.
- `GET /api/writing/summary` phân loại bản ghi cũ không có taskNumber là Task 2, lấy điểm hợp lệ mới nhất theo timestamp và tính trung bình từng nhóm. Nếu đủ hai bài, `combinedOverallBand = roundToHalf((Task1 + 2 × Task2) / 3)`; nếu thiếu một bài, trả `null` và `estimatedSingleTaskBand`.
- Diagnostic trả thêm `writingBandSummary`, ưu tiên band kết hợp ở `profile.skills.writing` khi đủ hai bài, và xét TA trong điểm yếu và gợi ý Unit. Trạng thái khóa Placement không thay đổi.

## Kiểm thử

`npm test`: 64 test, 62 pass, 0 fail, 2 skip. Hai test Gemini trực tiếp được bỏ qua vì môi trường test không có `GEMINI_API_KEY`; các nhánh Task 1 và Task 2 mới được kiểm tra với provider giả lập. Kiểm thử bao gồm mốc 149/160/250 từ, các nguồn đề Academic/General và đề tự nhập, công thức 6.0 + 2×7.0 → 6.5, dữ liệu cũ và thiếu điểm, cách ly tài khoản, diagnostic và mistakeContext TA.

## Bàn giao và giới hạn

- Phase 10B cần dựng biểu đồ/bảng/quy trình từ `visualData`, hiển thị đề thư và kết nối `/api/writing/summary`; Task 1 General không có `has_clear_overview`.
- Chấm Writing vẫn dùng key pool hiện tại; khi không có nhà cung cấp khả dụng, API trả lỗi thay vì tự tạo điểm. Điểm trả về từ AI là đánh giá luyện tập, không phải kết quả kỳ thi IELTS chính thức.
- Các điểm trung bình theo task là trung bình số học của các band hợp lệ, làm tròn hai chữ số thập phân; chỉ band kết hợp được làm tròn về bước 0.5.

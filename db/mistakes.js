import crypto from 'node:crypto';

const clean = (v, limit = 500) => typeof v === 'string' ? v.trim().slice(0, limit) : '';
export function normalizeMistakeContext(raw) {
  if (!raw || typeof raw !== 'object' || !['writing','speaking'].includes(raw.source) || !clean(raw.recordId, 120)) return null;
  const criterion = raw.weakestCriterion && typeof raw.weakestCriterion === 'object' ? raw.weakestCriterion : {};
  return {
    source:raw.source, recordId:clean(raw.recordId,120), prompt:clean(raw.prompt,1000),
    overallBand:Number.isFinite(Number(raw.overallBand)) ? Number(raw.overallBand) : null,
    weakestCriterion:{ code:clean(criterion.code,30), score:Number.isFinite(Number(criterion.score)) ? Number(criterion.score) : null, feedback:clean(criterion.feedback,1000) },
    corrections:(Array.isArray(raw.corrections) ? raw.corrections : []).slice(0,10).filter(c => c && clean(c.original) && clean(c.correction)).map(c => ({ original:clean(c.original), correction:clean(c.correction), explanation:clean(c.explanation,1000) })),
    suggestions:(Array.isArray(raw.suggestions) ? raw.suggestions : []).slice(0,6).map(s => clean(s,500)).filter(Boolean), transcriptExcerpt:clean(raw.transcriptExcerpt,1500)
  };
}
export function mistakeUnitId(context) {
  if (/^[a-zA-Z0-9_-]{1,80}$/.test(context.recordId)) return `mistake_${context.source}_${context.recordId}`;
  const slug = context.recordId.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70);
  return `mistake_${context.source}_${slug}_${crypto.createHash('sha256').update(context.recordId).digest('hex').slice(0,10)}`;
}
export function buildFallbackMistakeUnit(context) {
  const corrections = context.corrections.filter(c => c.original.toLowerCase() !== c.correction.toLowerCase());
  const defaults = [
    {original:'People is concerned.', correction:'People are concerned.', explanation:'People là danh từ số nhiều.'},
    {original:'She go to school.', correction:'She goes to school.', explanation:'Chủ ngữ số ít cần động từ phù hợp.'},
    {original:'We must to act.', correction:'We must act.', explanation:'Sau động từ khiếm khuyết dùng nguyên mẫu không to.'},
    {original:'Many informations are useful.', correction:'Much information is useful.', explanation:'Information là danh từ không đếm được.'}
  ];
  const material = [...corrections, ...defaults].slice(0, Math.max(4, corrections.length));
  const examples = material.slice(0,4);
  const focus = context.weakestCriterion.code || (context.source === 'writing' ? 'GRA' : 'FC');
  const notes = context.weakestCriterion.feedback || context.suggestions.join(' ') || 'So sánh cấu trúc gốc với cách diễn đạt chính xác, sau đó tự vận dụng vào câu mới.';
  const flashcards = examples.map(c => ({front:c.correction, back:c.explanation || 'So sánh với câu gốc và tự giải thích điểm khác biệt.', example:c.correction, ipa:'', clozeSentence:`Sửa câu: ${c.original} → ___`}));
  const quiz = examples.map((c,i) => ({type:'mcq', question:`Chọn cách diễn đạt chính xác (${i+1}).`, options:[c.original,c.correction], answer:1, explanation:c.explanation || 'Đối chiếu cấu trúc và cách dùng từ.', skillTag:i % 2 ? 'Grammar (GRA)' : 'Lexical (LR)'}));
  const tags = ['Reading Paraphrase','Grammar Error Fix (GRA)','Lexical Collocation (LR)'];
  const drill = [
    {instruction:'Chọn câu có cùng ý với câu mẫu.',sentence:'The policy reduced pollution.',options:['The policy lowered pollution.','The policy increased pollution.','The policy had no effect.'],answer:0,explanation:'Lowered diễn đạt lại reduced.',skillTag:tags[0]},
    {instruction:'Chọn câu đã sửa đúng.',sentence:examples[0].original,options:[examples[0].original,examples[0].correction],answer:1,explanation:examples[0].explanation || 'Đối chiếu câu gốc với câu sửa.',skillTag:tags[1]},
    {instruction:'Chọn kết hợp từ phù hợp.',sentence:'Governments should ___ climate change.',options:['mitigate','make','do'],answer:0,explanation:'Mitigate climate change là kết hợp từ phù hợp.',skillTag:tags[2]}
  ];
  const title = `Học từ lỗi ${context.source === 'writing' ? 'Writing' : 'Speaking'}: ${focus}`;
  const lesson = { titleEn:'Learn from your mistakes', titleVi:title, explanationEn:'Compare each correction with the original and explain the difference in your own words.', explanationVi:notes + ' Các câu ví dụ bổ sung chỉ để luyện tập, không nhất thiết trích từ bài của bạn.', formulas:[], commonMistakes:corrections.map(c => ({wrong:c.original,right:c.correction,noteVi:c.explanation})), bandUpgradeExamples:examples.slice(0,2).map(c => ({bandLow:c.original,bandHigh:c.correction,analysisVi:c.explanation || 'So sánh cấu trúc và cách dùng từ.'})), feynmanPromptVi:'Hãy giải thích bằng lời của bạn một điểm cần cải thiện và nêu một câu mới minh họa.' };
  const vocabulary = flashcards;
  return {title, source:'mistakes', levelTag:'Intermediate', targetWeakness:[focus], lesson, theory:lesson, vocabulary, flashcards, quiz, drill, challenge:{ prompt:context.prompt || 'Viết lại một đoạn ngắn, vận dụng các điểm đã ôn.', minWords:50,maxWords:80,targetWords:corrections.slice(0,3).map(c => c.correction)} };
}

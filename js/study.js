/**
 * Study Hub (Phase 7) — Astra-style personalized mastery.
 * Library → source → 5-step unit (0% → 100% mastery) with exam countdown and knowledge-gap targeting.
 */
const StudyApp = (() => {
  const GOAL_KEY = 'ielts_study_goal';
  const PROGRESS_KEY = 'ielts_study_progress';
  const STEP_META = [
    { step: 1, key: 'lesson', label: 'Smart Lesson', icon: '📖', mastery: 20 },
    { step: 2, key: 'flashcards', label: 'Flashcards', icon: '🗂️', mastery: 40 },
    { step: 3, key: 'quiz', label: 'Quick Quiz', icon: '⚡', mastery: 60 },
    { step: 4, key: 'drill', label: 'Gap Drill', icon: '🧩', mastery: 80 },
    { step: 5, key: 'challenge', label: 'Mini Output', icon: '🏆', mastery: 100 }
  ];

  const state = {
    config: null,
    steps: STEP_META,
    progress: [],          // merged server + local records
    weak: [],              // [{ key, label, detail }]
    suggested: null,       // { textbookId, unitId }
    unit: null, unitId: null, unitTitle: '', unitSource: 'textbook', provider: '',
    step: 1,
    session: null,         // per-unit UI state
    sourceTab: 'paste',
    fileText: '', fileName: ''
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const readStorage = (key, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
  };
  const writeStorage = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };
  const countWords = text => (String(text).trim().match(/\S+/g) || []).length;

  async function getJson(url, fallback) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch { return fallback; }
  }

  async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /* ── Goal & countdown ───────────────────────────────────── */

  function daysUntil(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }

  function renderCountdown() {
    const days = daysUntil($('exam-date').value);
    const number = $('countdown-number');
    const label = $('countdown-label');
    number.classList.remove('urgent');
    if (days == null) { number.textContent = '—'; label.textContent = 'Chưa đặt ngày thi'; return; }
    if (days < 0) { number.textContent = '0'; label.textContent = 'Ngày thi đã qua — hãy đặt ngày mới'; return; }
    number.textContent = String(days);
    number.classList.toggle('urgent', days <= 14);
    label.textContent = days === 0 ? 'Hôm nay là ngày thi!' : `ngày nữa tới kỳ thi · mục tiêu Band ${$('target-band').value}`;
  }

  function saveGoal() {
    writeStorage(GOAL_KEY, { examDate: $('exam-date').value, targetBand: $('target-band').value });
    renderCountdown();
    computeSuggestion();
    renderLibrary();
  }

  function loadGoal() {
    const goal = readStorage(GOAL_KEY, {});
    if (goal.examDate) $('exam-date').value = goal.examDate;
    if (goal.targetBand) $('target-band').value = goal.targetBand;
    renderCountdown();
  }

  /* ── Knowledge gaps ─────────────────────────────────────── */

  const CRITERIA_LABEL = { TR: 'Task Response', CC: 'Coherence & Cohesion', LR: 'Lexical Resource', GRA: 'Grammar Range & Accuracy', FC: 'Fluency & Coherence', PR: 'Pronunciation' };

  function lowestCriterion(records, aliases = {}) {
    const buckets = {};
    records.forEach(record => {
      const list = record?.result?.criteria || record?.criteria;
      if (!Array.isArray(list)) return;
      list.forEach(item => {
        const abbr = String(item?.abbreviation || '').toUpperCase().trim();
        const score = Number(item?.score);
        if (abbr && Number.isFinite(score)) (buckets[abbr] ||= []).push(score);
      });
    });
    const ranked = Object.entries(buckets)
      .map(([abbr, scores]) => ({ abbr, avg: scores.reduce((a, b) => a + b, 0) / scores.length }))
      .sort((a, b) => a.avg - b.avg);
    const first = ranked[0];
    return first ? { ...first, key: aliases[first.abbr] || first.abbr } : null;
  }

  async function loadWeaknesses() {
    const [placement, writing, speaking] = await Promise.all([
      getJson('/api/placement/history', []),
      getJson('/api/writing/history', []),
      getJson('/api/speaking/history', [])
    ]);
    const weak = [];
    const gaps = {};
    (Array.isArray(placement) ? placement : []).flatMap(r => r.weakAreas || []).forEach(area => {
      const level = String(area.difficulty || '').toUpperCase();
      if (level) gaps[level] = (gaps[level] || 0) + 1;
    });
    const gapTotal = Object.values(gaps).reduce((a, b) => a + b, 0);
    if (gapTotal) weak.push({ key: 'placement', label: 'Reading & Listening', detail: `${gapTotal} câu sai trong Placement`, weight: gapTotal });
    const w = lowestCriterion(Array.isArray(writing) ? writing : []);
    if (w) weak.push({ key: w.key, label: `Writing · ${CRITERIA_LABEL[w.abbr] || w.abbr}`, detail: `Band ${w.avg.toFixed(1)}`, weight: 9 - w.avg });
    const s = lowestCriterion(Array.isArray(speaking) ? speaking : [], { FC: 'CC' });
    if (s && s.abbr !== 'PR') weak.push({ key: s.key, label: `Speaking · ${CRITERIA_LABEL[s.abbr] || s.abbr}`, detail: `Band ${s.avg.toFixed(1)}`, weight: 9 - s.avg });
    weak.sort((a, b) => b.weight - a.weight);
    state.weak = weak;
  }

  function parseBand(str, fallback) { const n = parseFloat(String(str)); return Number.isFinite(n) ? n : fallback; }

  function savedMastery(unitId) {
    return state.progress.find(p => p.unitId === unitId)?.mastery || 0;
  }

  /** Pick the unit that best matches the biggest weakness and the target band. */
  function computeSuggestion() {
    state.suggested = null;
    const books = state.config?.sampleTextbooks || [];
    const target = parseBand($('target-band').value, 7);
    const keys = state.weak.length ? state.weak.map(w => w.key) : ['vocabulary'];
    for (const key of keys) {
      const candidates = books
        .filter(b => (b.focus || []).includes(key) || (key === 'LR' && b.focus?.includes('vocabulary')))
        .sort((a, b) => Math.abs((a.bandMin + a.bandMax) / 2 - target) - Math.abs((b.bandMin + b.bandMax) / 2 - target));
      for (const book of candidates) {
        const unit = book.units.find(u => savedMastery(u.id) < 100);
        if (unit) { state.suggested = { textbookId: book.id, unitId: unit.id, reason: key }; return; }
      }
    }
    const book = books[0];
    if (book) state.suggested = { textbookId: book.id, unitId: book.units[0].id, reason: 'default' };
  }

  function renderGaps() {
    const list = $('gap-list');
    const button = $('btn-open-suggested');
    if (!state.weak.length) {
      list.innerHTML = 'Chưa có dữ liệu luyện tập. Làm Placement, Writing hoặc Speaking để AI xác định lỗ hổng — tạm thời gợi ý Unit nền tảng.';
    } else {
      list.innerHTML = state.weak.map(w => `<span class="gap-chip">${esc(w.label)} · ${esc(w.detail)}</span>`).join('');
    }
    const found = state.suggested && findUnit(state.suggested.textbookId, state.suggested.unitId);
    button.hidden = !found;
    if (found) button.textContent = `Học Unit gợi ý: ${found.unit.title.slice(0, 48)}…`;
  }

  /* ── Library ────────────────────────────────────────────── */

  function findUnit(textbookId, unitId) {
    const book = (state.config?.sampleTextbooks || []).find(b => b.id === textbookId);
    const unit = book?.units.find(u => u.id === unitId);
    return book && unit ? { book, unit } : null;
  }

  function renderLibrary() {
    const host = $('textbook-list');
    const books = state.config?.sampleTextbooks || [];
    if (!books.length) { host.textContent = 'Không tải được kho giáo trình.'; return; }
    host.innerHTML = books.map(book => `
      <div class="textbook">
        <div class="textbook-head">
          <span class="textbook-title">${esc(book.title)}</span>
          <span class="band-chip">Band ${esc(book.bandRange)} · ${esc(book.skill)}</span>
        </div>
        ${book.units.map(unit => {
          const mastery = savedMastery(unit.id);
          const suggested = state.suggested?.unitId === unit.id;
          return `<div class="unit-row ${suggested ? 'suggested' : ''}">
            <span class="unit-title">${suggested ? '⭐ ' : ''}${esc(unit.title)} <span class="muted">(Band ${esc(unit.bandRange)})</span></span>
            ${mastery ? `<span class="unit-badge">${mastery}% Mastery</span>` : ''}
            <span class="unit-actions">
              <button type="button" class="btn-small" data-action="open-sample" data-book="${esc(book.id)}" data-unit="${esc(unit.id)}">Học ngay</button>
              <button type="button" class="btn-small" data-action="generate" data-book="${esc(book.id)}" data-unit="${esc(unit.id)}">Tạo mới bằng AI</button>
            </span>
          </div>`;
        }).join('')}
      </div>`).join('');
  }

  /* ── Progress ───────────────────────────────────────────── */

  function mergeProgress(serverList) {
    const map = new Map();
    [...readStorage(PROGRESS_KEY, []), ...(Array.isArray(serverList) ? serverList : [])].forEach(rec => {
      if (!rec?.unitId) return;
      const prev = map.get(rec.unitId);
      if (!prev || (rec.mastery || 0) >= (prev.mastery || 0)) map.set(rec.unitId, rec);
    });
    state.progress = [...map.values()];
  }

  function renderProgress() {
    const list = $('progress-list');
    $('progress-count').textContent = String(state.progress.length);
    if (!state.progress.length) { list.innerHTML = '<p class="muted">Chưa có Unit nào.</p>'; return; }
    list.innerHTML = state.progress
      .slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 12)
      .map(p => `<div class="progress-item">
        <div class="p-title">${esc(p.title || p.unitId)}</div>
        <div class="progress-bar"><div style="width:${Number(p.mastery) || 0}%"></div></div>
        <div class="p-meta">${Number(p.mastery) || 0}% Mastery${p.miniScore != null ? ` · Mini ${esc(p.miniScore)}/100` : ''}</div>
      </div>`).join('');
  }

  async function persistProgress(mastery) {
    const record = {
      unitId: state.unitId, title: state.unitTitle, source: state.unitSource, mastery,
      steps: [...state.session.done].sort(), miniScore: state.session.evaluation?.score ?? null,
      updatedAt: new Date().toISOString()
    };
    const local = readStorage(PROGRESS_KEY, []).filter(r => r.unitId !== record.unitId);
    const previous = readStorage(PROGRESS_KEY, []).find(r => r.unitId === record.unitId);
    record.mastery = Math.max(mastery, previous?.mastery || 0);
    local.push(record);
    writeStorage(PROGRESS_KEY, local);
    try { await postJson('/api/study/progress', record); } catch { /* offline: localStorage already has it */ }
    mergeProgress(await getJson('/api/study/progress', []));
    renderProgress();
    renderLibrary();
  }

  /* ── Lesson player ──────────────────────────────────────── */

  function newSession() {
    return { done: new Set(), flipped: new Set(), known: new Set(), quiz: {}, drill: {}, answer: '', evaluation: null, error: '' };
  }

  function openUnit({ unit, unitId, title, source, provider }) {
    state.unit = unit;
    state.unitId = unitId;
    state.unitTitle = title || unit.title;
    state.unitSource = source;
    state.provider = provider || '';
    state.session = newSession();
    state.step = 1;
    const saved = savedMastery(unitId);
    STEP_META.filter(s => s.mastery <= saved).forEach(s => state.session.done.add(s.step));
    $('lesson-section').hidden = false;
    $('lesson-title').textContent = state.unitTitle;
    $('lesson-provider').textContent = provider ? `Nguồn AI: ${provider}` : '';
    renderPlayer();
    $('lesson-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function currentMastery() {
    let best = 0;
    state.session.done.forEach(n => { best = Math.max(best, STEP_META[n - 1].mastery); });
    return best;
  }

  function stepComplete(step) {
    const s = state.session;
    const unit = state.unit;
    if (s.done.has(step)) return true;
    if (step === 1) return true;
    if (step === 2) return unit.flashcards.every((_, i) => s.flipped.has(i));
    if (step === 3) return unit.quiz.every((_, i) => s.quiz[i] != null);
    if (step === 4) return unit.drill.every((_, i) => s.drill[i] != null);
    return !!s.evaluation;
  }

  function markDone(step) {
    if (state.session.done.has(step)) return;
    state.session.done.add(step);
    persistProgress(currentMastery());
  }

  function renderPlayer() {
    const mastery = currentMastery();
    $('mastery-percent').textContent = `${mastery}%`;
    const fill = $('mastery-fill');
    fill.style.width = `${mastery}%`;
    fill.classList.toggle('complete', mastery === 100);
    $('step-dots').innerHTML = STEP_META.map(s => {
      const cls = [state.session.done.has(s.step) ? 'done' : '', state.step === s.step ? 'current' : ''].join(' ');
      return `<li class="${cls}" data-step="${s.step}">${s.icon}<br>${s.mastery}%</li>`;
    }).join('');
    $('step-body').innerHTML = renderStep(state.step);
    updateNav();
    if (state.step === 5) bindChallenge();
  }

  function updateNav() {
    const prev = $('btn-prev');
    const next = $('btn-next');
    prev.disabled = state.step === 1;
    const complete = stepComplete(state.step);
    if (state.step === 5) {
      next.textContent = 'Hoàn tất Unit ✓';
      next.disabled = !state.session.evaluation;
    } else {
      next.textContent = 'Tiếp tục →';
      next.disabled = !complete;
    }
    next.title = next.disabled ? 'Hoàn thành bước này để mở khóa' : '';
  }

  function renderStep(step) {
    const unit = state.unit;
    const meta = STEP_META[step - 1];
    const head = `<h3 class="step-title">${meta.icon} Bước ${step} — ${meta.label} (${meta.mastery}% Mastery)</h3>`;
    if (step === 1) return head + renderLesson(unit.lesson);
    if (step === 2) return head + renderFlashcards(unit.flashcards);
    if (step === 3) return head + `<p class="q-sub">Trả lời cả ${unit.quiz.length} câu để mở khóa bước tiếp theo.</p>` + renderQuestions(unit.quiz, 'quiz');
    if (step === 4) return head + `<p class="q-sub">${unit.drill.length} bài tập xoáy vào điểm yếu của bạn.</p>` + renderQuestions(unit.drill, 'drill');
    return head + renderChallenge(unit.challenge);
  }

  function renderLesson(lesson) {
    const mistakes = (lesson.commonMistakes || []).map(m =>
      `<div class="mistake-row"><span class="wrong">${esc(m.wrong)}</span> → <span class="right">${esc(m.right)}</span><br><span class="muted">${esc(m.noteVi)}</span></div>`).join('');
    return `
      <div class="lesson-block"><strong>${esc(lesson.titleEn)}</strong> · ${esc(lesson.titleVi)}</div>
      <div class="lesson-block"><strong>🇬🇧</strong> ${esc(lesson.explanationEn)}</div>
      <div class="lesson-block"><strong>🇻🇳</strong> ${esc(lesson.explanationVi)}</div>
      ${lesson.formulas?.length ? `<strong>Công thức áp dụng</strong><ul class="formula-list">${lesson.formulas.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${mistakes ? `<strong>Lỗi thường gặp</strong>${mistakes}` : ''}`;
  }

  function renderFlashcards(cards) {
    const s = state.session;
    return `<p class="q-sub">Bấm vào thẻ để lật (${s.flipped.size}/${cards.length}). Lật hết các thẻ để mở khóa bước tiếp theo.</p>
      <div class="flashcard-grid">${cards.map((c, i) => `
        <div class="flashcard-wrap">
          <button type="button" class="flashcard ${s.flipped.has(i) ? 'flipped' : ''}" data-card="${i}" aria-label="Lật thẻ ${esc(c.front)}">
            <div class="flashcard-inner">
              <div class="flashcard-face front"><span class="front-word">${esc(c.front)}</span><span class="hint">bấm để lật</span></div>
              <div class="flashcard-face back"><strong>${esc(c.back)}</strong>${c.example ? `<span class="example">“${esc(c.example)}”</span>` : ''}</div>
            </div>
          </button>
          <button type="button" class="btn-known ${s.known.has(i) ? 'known' : ''}" data-known="${i}">${s.known.has(i) ? '✓ Đã thuộc' : 'Đánh dấu đã thuộc'}</button>
        </div>`).join('')}</div>`;
  }

  function renderQuestions(items, kind) {
    const answers = state.session[kind];
    const correctCount = items.filter((q, i) => answers[i] === q.answer).length;
    const answered = Object.keys(answers).length;
    return items.map((q, i) => {
      const chosen = answers[i];
      const done = chosen != null;
      const text = kind === 'drill' ? `${q.instruction ? `<p class="q-sub">${esc(q.instruction)}</p>` : ''}<p class="q-text">${esc(q.sentence)}</p>`
        : `<p class="q-text">${i + 1}. ${esc(q.question)}</p>`;
      return `<div class="q-card">${text}
        <div class="q-options">${q.options.map((o, j) => {
          const cls = done ? (j === q.answer ? 'correct' : (j === chosen ? 'wrong' : '')) : '';
          return `<button type="button" class="q-option ${cls}" data-kind="${kind}" data-q="${i}" data-opt="${j}" ${done ? 'disabled' : ''}>${esc(o)}</button>`;
        }).join('')}</div>
        ${done ? `<div class="q-feedback ${chosen === q.answer ? 'ok' : 'bad'}"><strong>${chosen === q.answer ? '✓ Chính xác!' : '✗ Chưa đúng.'}</strong> ${esc(q.explanation)}</div>` : ''}
      </div>`;
    }).join('') + (answered === items.length ? `<p class="step-summary">Kết quả: ${correctCount}/${items.length} câu đúng.</p>` : '');
  }

  function renderChallenge(challenge) {
    const s = state.session;
    const ev = s.evaluation;
    const targets = (challenge.targetWords || []);
    const used = new Set((ev?.usedWords || []).map(w => w.toLowerCase()));
    return `<p class="lesson-block">${esc(challenge.prompt)}</p>
      <div>${targets.map(w => `<span class="target-chip ${used.has(w.toLowerCase()) ? 'used' : ''}">${esc(w)}</span>`).join('')}</div>
      <textarea id="challenge-input" class="study-input study-textarea challenge-input" placeholder="Viết câu trả lời của bạn bằng tiếng Anh..." ${ev ? 'readonly' : ''}>${esc(s.answer)}</textarea>
      <div class="challenge-meta"><span id="challenge-count">${countWords(s.answer)} từ (mục tiêu ${challenge.minWords}–${challenge.maxWords})</span>
        <button type="button" class="btn-primary" id="btn-evaluate" ${ev ? 'disabled' : ''}>Chấm điểm</button></div>
      <p class="step-error" id="challenge-error">${esc(s.error)}</p>
      ${ev ? `<div class="eval-card"><div class="eval-band">Band ${esc(ev.band)} · ${esc(ev.score)}/100</div>
        <p>${esc(ev.feedbackVi)}</p><p>${esc(ev.feedbackEn)}</p>
        ${ev.improved ? `<p><strong>Gợi ý bản tốt hơn:</strong> ${esc(ev.improved)}</p>` : ''}
        <p class="muted">Chấm bởi: ${esc(ev.provider || '')}</p></div>` : ''}`;
  }

  function bindChallenge() {
    const input = $('challenge-input');
    const button = $('btn-evaluate');
    if (!input || !button) return;
    input.addEventListener('input', () => {
      state.session.answer = input.value;
      const c = state.unit.challenge;
      $('challenge-count').textContent = `${countWords(input.value)} từ (mục tiêu ${c.minWords}–${c.maxWords})`;
    });
    button.addEventListener('click', evaluateChallenge);
  }

  async function evaluateChallenge() {
    const s = state.session;
    const c = state.unit.challenge;
    const button = $('btn-evaluate');
    const err = $('challenge-error');
    s.answer = $('challenge-input').value;
    const minClient = Math.max(20, Math.floor(c.minWords * 0.6));
    if (countWords(s.answer) < minClient) { s.error = `Hãy viết ít nhất ${minClient} từ.`; err.textContent = s.error; return; }
    s.error = '';
    err.textContent = '';
    button.disabled = true;
    button.textContent = 'Đang chấm...';
    try {
      const result = await postJson('/api/study/evaluate-mini', {
        answer: s.answer, prompt: c.prompt, targetWords: c.targetWords, unitTitle: state.unitTitle,
        minWords: c.minWords, maxWords: c.maxWords
      });
      s.evaluation = result;
      s.done.add(5);
      persistProgress(currentMastery());
      renderPlayer();
    } catch (e) {
      s.error = e.message;
      button.disabled = false;
      button.textContent = 'Chấm điểm';
      err.textContent = e.message;
    }
  }

  function goStep(n) {
    if (n < 1 || n > 5) return;
    // Only allow jumping forward to steps whose previous steps are complete.
    for (let i = 1; i < n; i++) if (!stepComplete(i)) return;
    state.step = n;
    renderPlayer();
  }

  function onNext() {
    if (!stepComplete(state.step)) return;
    if (state.step < 5) {
      markDone(state.step);
      state.step += 1;
      renderPlayer();
    } else {
      $('step-body').insertAdjacentHTML('beforeend', '<p class="step-summary">🎉 Bạn đã đạt 100% Mastery cho Unit này!</p>');
    }
  }

  function onStepBodyClick(event) {
    const card = event.target.closest('[data-card]');
    const known = event.target.closest('[data-known]');
    const option = event.target.closest('.q-option');
    const s = state.session;
    if (card) {
      s.flipped.add(Number(card.dataset.card));
      renderPlayer();
    } else if (known) {
      const i = Number(known.dataset.known);
      if (s.known.has(i)) s.known.delete(i); else s.known.add(i);
      s.flipped.add(i);
      renderPlayer();
    } else if (option && !option.disabled) {
      s[option.dataset.kind][Number(option.dataset.q)] = Number(option.dataset.opt);
      const kindStep = option.dataset.kind === 'quiz' ? 3 : 4;
      if (stepComplete(kindStep)) markDone(kindStep);
      renderPlayer();
    }
  }

  /* ── Opening units ──────────────────────────────────────── */

  function openSample(textbookId, unitId) {
    const found = findUnit(textbookId, unitId);
    if (!found?.unit.sample) return;
    openUnit({ unit: found.unit.sample, unitId, title: found.unit.title, source: 'textbook', provider: 'Built-in sample unit' });
  }

  const weakLabels = () => state.weak.map(w => w.label);

  async function generateFromTextbook(button, textbookId, unitId) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Đang tạo...';
    try {
      const data = await postJson('/api/study/generate-unit', {
        textbookId, unitId, weakAreas: weakLabels(), targetBand: parseBand($('target-band').value, null)
      });
      const found = findUnit(textbookId, unitId);
      openUnit({ unit: data.unit, unitId: found?.unit.id || data.unitId, title: found?.unit.title || data.unit.title, source: 'textbook', provider: data.fallback ? `${data.provider} (AI không khả dụng)` : data.provider });
    } catch (e) {
      alertInline(`Không tạo được bài học: ${e.message}`);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function alertInline(message) {
    const status = $('source-status');
    status.textContent = message;
    status.classList.add('step-error');
  }

  async function generateFromSource() {
    const status = $('source-status');
    const button = $('btn-source-generate');
    status.classList.remove('step-error');
    status.textContent = '';
    let payload;
    if (state.sourceTab === 'paste') payload = { text: $('source-text').value };
    else if (state.sourceTab === 'file') payload = { text: state.fileText, title: state.fileName };
    else payload = { url: $('source-url').value.trim() };
    if (!payload.text && !payload.url) { alertInline('Hãy nhập nội dung, chọn file hoặc dán URL.'); return; }
    button.disabled = true;
    try {
      status.textContent = 'Đang trích xuất nội dung...';
      const source = await postJson('/api/study/extract-source', payload);
      status.textContent = `Đã trích xuất ${source.wordCount} từ. Đang thiết kế bài học bằng AI...`;
      const data = await postJson('/api/study/generate-unit', {
        sourceText: source.text, title: source.title, weakAreas: weakLabels(), targetBand: parseBand($('target-band').value, null)
      });
      status.textContent = 'Hoàn tất!';
      openUnit({ unit: data.unit, unitId: data.unitId, title: data.unit.title || source.title, source: source.sourceType, provider: data.provider });
    } catch (e) {
      alertInline(e.message);
    } finally {
      button.disabled = false;
    }
  }

  function onFileChosen(event) {
    const file = event.target.files?.[0];
    const info = $('source-file-info');
    state.fileText = '';
    if (!file) { info.textContent = 'Chưa chọn file.'; return; }
    if (!/\.(txt|md)$/i.test(file.name)) { info.textContent = 'Chỉ hỗ trợ file .txt hoặc .md.'; return; }
    if (file.size > 1024 * 1024) { info.textContent = 'File quá lớn (tối đa 1 MB).'; return; }
    const reader = new FileReader();
    reader.onload = () => {
      state.fileText = String(reader.result || '');
      state.fileName = file.name.replace(/\.(txt|md)$/i, '');
      info.textContent = `${file.name} — ${countWords(state.fileText)} từ.`;
    };
    reader.onerror = () => { info.textContent = 'Không đọc được file.'; };
    reader.readAsText(file);
  }

  function switchTab(tab) {
    state.sourceTab = tab;
    document.querySelectorAll('.source-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.source-pane').forEach(p => { p.hidden = p.dataset.pane !== tab; });
  }

  /* ── Init ───────────────────────────────────────────────── */

  async function init() {
    loadGoal();
    state.config = await getJson('/api/study/config', null);
    if (state.config?.masterySteps?.length === 5) {
      state.steps = state.config.masterySteps;
    }
    mergeProgress(await getJson('/api/study/progress', []));
    renderProgress();
    computeSuggestion();
    renderLibrary();
    renderGaps();
    loadWeaknesses().then(() => { computeSuggestion(); renderLibrary(); renderGaps(); });

    $('btn-save-goal').addEventListener('click', saveGoal);
    $('exam-date').addEventListener('change', renderCountdown);
    $('target-band').addEventListener('change', renderCountdown);
    $('btn-open-suggested').addEventListener('click', () => state.suggested && openSample(state.suggested.textbookId, state.suggested.unitId));
    $('textbook-list').addEventListener('click', event => {
      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'open-sample') openSample(btn.dataset.book, btn.dataset.unit);
      else generateFromTextbook(btn, btn.dataset.book, btn.dataset.unit);
    });
    document.querySelectorAll('.source-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('source-file').addEventListener('change', onFileChosen);
    $('btn-source-generate').addEventListener('click', generateFromSource);
    $('step-body').addEventListener('click', onStepBodyClick);
    $('step-dots').addEventListener('click', event => {
      const li = event.target.closest('[data-step]');
      if (li) goStep(Number(li.dataset.step));
    });
    $('btn-prev').addEventListener('click', () => goStep(state.step - 1));
    $('btn-next').addEventListener('click', onNext);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init, daysUntil, openSample };
})();

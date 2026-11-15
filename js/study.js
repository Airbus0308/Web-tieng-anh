/**
 * Study Hub (Phase 7 + 8B) — Astra-style personalized mastery with an SRL-SLA 3-stage closed loop:
 * Forethought (diagnostic gate, KBCP, SRS) → Performance (5-step unit, Feynman, Active Recall, Interleaving, Socratic tutor)
 * → Self-Reflection (output checkpoint with COPES metacognitive calibration).
 * Phase 9A — Progressive Disclosure: a Study Cockpit dashboard (#hub-view) and a LearnHouse-style
 * Focus Classroom (#classroom-view); setView() is the single source of truth for which one is shown.
 */
const StudyApp = (() => {
  const GOAL_KEY = 'ielts_study_goal';
  const PROGRESS_KEY = 'ielts_study_progress';
  const PLACEMENT_KEY = 'ielts_placement_results';
  const SYNCED_KEY = 'ielts_study_synced_placement';
  const COMMIT_KEY = 'ielts_study_commitment';
  const STREAK_KEY = 'ielts_study_streak';
  const LAST_UNIT_KEY = 'ielts_study_last_unit';
  const HUB_TAB_KEY = 'ielts_study_hub_tab';
  const CUSTOM_UNITS_KEY = 'ielts_custom_units_v1'; // shared with js/auth-profile.js (mistake units)
  const MAX_CUSTOM_UNITS = 20;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_SOURCE_CHARS = 60000;
  const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
  const SRS_PREVIEW = 3;
  const STEP_META = [
    { step: 1, key: 'lesson', label: 'Deep Lesson & Feynman', icon: '📖', mastery: 20 },
    { step: 2, key: 'flashcards', label: 'Active Recall & SRS', icon: '🗂️', mastery: 40 },
    { step: 3, key: 'quiz', label: 'Quick Quiz', icon: '⚡', mastery: 60 },
    { step: 4, key: 'drill', label: 'Interleaved Skill Mixer', icon: '🧩', mastery: 80 },
    { step: 5, key: 'challenge', label: 'Output Checkpoint', icon: '🏆', mastery: 100 }
  ];

  const state = {
    config: null,
    steps: STEP_META,
    progress: [],          // merged server + local records
    weak: [],              // [{ key, label, detail }]
    suggested: null,       // { textbookId, unitId }
    unit: null, unitId: null, unitTitle: '', unitSource: 'textbook', provider: '', textbookId: null,
    view: 'hub', hubTab: 'courses', srsExpanded: false,
    step: 1,
    session: null,         // per-unit UI state
    sourceTab: 'paste',
    diag: null, locked: false, srs: null, checkpoints: [],
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
    $('band-target').textContent = $('target-band').value;
    if (days == null) { number.textContent = '—'; label.textContent = 'Chưa đặt ngày thi'; return; }
    if (days < 0) { number.textContent = '0'; label.textContent = 'Ngày thi đã qua — hãy đặt ngày mới'; return; }
    number.textContent = String(days);
    number.classList.toggle('urgent', days <= 14);
    label.textContent = days === 0 ? 'Hôm nay là ngày thi!' : `ngày nữa tới kỳ thi · mục tiêu Band ${$('target-band').value}`;
  }

  function saveGoal() {
    writeStorage(GOAL_KEY, { examDate: $('exam-date').value, targetBand: $('target-band').value });
    syncProfile({ examDate: $('exam-date').value || null, targetBand: parseBand($('target-band').value, null) });
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
    const rec = (state.diag?.recommendedCurriculum || []).find(u => savedMastery(u.id) < 100 && findUnit(u.textbookId, u.id));
    if (rec) { state.suggested = { textbookId: rec.textbookId, unitId: rec.id, reason: 'i+1' }; return; }
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

  const SKILL_ICON = [[/listen|read/i, '🎧', 'reading'], [/writ/i, '✍️', 'writing'], [/gram/i, '🧩', 'grammar'], [/vocab|lexi/i, '📚', 'vocab']];

  function skillLook(skill) {
    const hit = SKILL_ICON.find(([re]) => re.test(String(skill || '')));
    return hit ? { icon: hit[1], cls: hit[2] } : { icon: '📖', cls: 'default' };
  }

  function unitStatus(mastery) {
    if (mastery >= 100) return { icon: '✓', label: 'PASSED ✓', cls: 'passed' };
    if (mastery > 0) return { icon: '◐', label: `${mastery}%`, cls: 'progress' };
    return { icon: '○', label: 'Chưa học', cls: 'new' };
  }

  /** Frappe LMS-style course cards: cover, band chip, aggregate progress, primary CTA and a collapsible unit list. */
  function renderLibrary() {
    const host = $('textbook-list');
    const books = state.config?.sampleTextbooks || [];
    if (!books.length) { host.textContent = 'Không tải được kho giáo trình.'; return; }
    host.innerHTML = books.map(book => {
      const masteries = book.units.map(u => savedMastery(u.id));
      const percent = Math.round(masteries.reduce((a, b) => a + b, 0) / (masteries.length || 1));
      const next = book.units.find(u => savedMastery(u.id) < 100) || book.units[0];
      const cta = percent >= 100 ? 'Ôn lại' : masteries.some(Boolean) ? 'Tiếp tục' : 'Bắt đầu';
      const isSuggested = state.suggested?.textbookId === book.id;
      const look = skillLook(book.skill);
      return `<article class="course-card ${isSuggested ? 'is-suggested' : ''}">
        <div class="course-cover skill-${look.cls}">
          <span class="course-icon" aria-hidden="true">${look.icon}</span>
          ${isSuggested ? '<span class="course-flag">⭐ Gợi ý cho bạn</span>' : ''}
        </div>
        <div class="course-body">
          <h3 class="course-title">${esc(book.title)}</h3>
          <div class="course-meta"><span class="band-chip">Band ${esc(book.bandRange)} · ${esc(book.skill)}</span></div>
          <div class="course-progress">
            <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="Tiến độ bộ sách"><div style="width:${percent}%"></div></div>
            <span class="muted">${book.units.length} Unit · ${percent}% hoàn thành</span>
          </div>
          <button type="button" class="btn-primary course-cta" data-action="open-sample" data-book="${esc(book.id)}" data-unit="${esc(next.id)}">${cta}: ${esc(next.title.split('—')[0].trim())}</button>
          <details class="course-units" ${isSuggested ? 'open' : ''}>
            <summary>Danh sách Unit (${book.units.length})</summary>
            ${book.units.map(unit => {
              const mastery = savedMastery(unit.id);
              const st = unitStatus(mastery);
              const suggested = state.suggested?.unitId === unit.id;
              return `<div class="unit-row ${suggested ? 'suggested' : ''}">
                <span class="unit-status ${st.cls}" title="${esc(st.label)}" aria-hidden="true">${st.icon}</span>
                <span class="unit-title">${suggested ? '⭐ ' : ''}${esc(unit.title)} <span class="muted">(Band ${esc(unit.bandRange)})</span>${unit.levelTag ? ` <span class="level-chip">${esc(unit.levelTag)}</span>` : ''}</span>
                <span class="unit-badge ${st.cls}">${esc(st.label)}</span>
                <span class="unit-actions">
                  <button type="button" class="btn-small" data-action="open-sample" data-book="${esc(book.id)}" data-unit="${esc(unit.id)}">Học ngay</button>
                  <button type="button" class="btn-small" data-action="generate" data-book="${esc(book.id)}" data-unit="${esc(unit.id)}">Tạo mới bằng AI</button>
                </span>
              </div>`;
            }).join('')}
          </details>
        </div>
      </article>`;
    }).join('');
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

  /** Canvas-style To-Do: resume the unit in progress (saved in ielts_study_last_unit). */
  function renderTodo() {
    const button = $('btn-continue-unit');
    const last = readStorage(LAST_UNIT_KEY, null);
    const mastery = last?.unitId ? savedMastery(last.unitId) : 0;
    const show = !!last?.unit && mastery < 100 && !state.locked;
    button.hidden = !show;
    if (show) button.textContent = `▶ Tiếp tục: ${String(last.title || 'Unit').slice(0, 42)} (${mastery}%)`;
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
    renderTodo();
    renderLibrary();
    renderCustomUnits();
  }

  /* ── Lesson player ──────────────────────────────────────── */

  function newSession() {
    return {
      done: new Set(), flipped: new Set(), known: new Set(), quiz: {}, drill: {}, answer: '', evaluation: null, error: '',
      spoken: '', selfBand: '', selfReason: '', listening: false, flash: '',
      recall: {}, recallText: {}, srsAdded: new Set(), hints: {}, feynman: { text: '', result: null, loading: false, error: '' }
    };
  }

  function openUnit({ unit, unitId, title, source, provider, textbookId = null }, { push = true } = {}) {
    if (state.locked && source !== 'mistakes') return;
    stopRecording();
    state.unit = unit;
    state.unitId = unitId;
    state.unitTitle = title || unit.title;
    state.unitSource = source;
    state.provider = provider || '';
    state.textbookId = textbookId;
    state.session = newSession();
    const saved = savedMastery(unitId);
    STEP_META.filter(s => s.mastery <= saved).forEach(s => state.session.done.add(s.step));
    state.step = Math.min(5, state.session.done.size + 1);
    const record = { unit, unitId, title: state.unitTitle, source, provider: state.provider, textbookId, savedAt: new Date().toISOString() };
    writeStorage(LAST_UNIT_KEY, record);
    if (source !== 'textbook') saveCustomUnit(record);
    $('tutor-reply').innerHTML = '';
    $('lesson-title').textContent = state.unitTitle;
    $('lesson-provider').textContent = provider ? `Nguồn AI: ${provider}` : '';
    renderBreadcrumb();
    setView('classroom', { push });
    renderPlayer();
    $('lesson-title').focus({ preventScroll: true });
  }

  /* ── Views: Study Cockpit (hub) ↔ Focus Classroom ───────── */

  const unitHash = id => `#unit=${encodeURIComponent(id)}`;

  function setView(view, { push = false } = {}) {
    state.view = view === 'classroom' && state.unit ? 'classroom' : 'hub';
    const inClassroom = state.view === 'classroom';
    $('classroom-view').hidden = !inClassroom || (state.locked && state.unitSource !== 'mistakes');
    $('hub-view').hidden = inClassroom || state.locked || !state.ready;
    $('diagnostic-gate').hidden = !state.locked || inClassroom; // focus mode hides the gate for gate-exempt mistake units
    if (inClassroom && push && location.hash !== unitHash(state.unitId)) {
      history.pushState({ view: 'classroom', unitId: state.unitId }, '', unitHash(state.unitId));
    }
    if (!inClassroom) stopRecording();
    window.scrollTo({ top: 0, behavior: 'auto' });
    renderStageBar();
  }

  function renderBreadcrumb() {
    const book = state.textbookId && (state.config?.sampleTextbooks || []).find(b => b.id === state.textbookId);
    const middle = book ? book.title.split('—')[0].trim() : (state.unitSource === 'mistakes' ? 'Học từ lỗi sai' : 'Tài liệu cá nhân');
    $('classroom-breadcrumb').innerHTML = `<span>Kho khóa học</span><span aria-hidden="true">›</span><span>${esc(middle)}</span><span aria-hidden="true">›</span><strong>${esc(state.unitTitle)}</strong>`;
  }

  function backToHub() {
    const id = state.unitId;
    if (history.state?.view === 'classroom') history.back();
    else {
      history.replaceState(null, '', location.pathname + location.search);
      showHub(id);
    }
  }

  function showHub(focusUnitId) {
    setView('hub');
    renderTodo();
    const target = focusUnitId && document.querySelector(`#hub-view [data-action="open-sample"][data-unit="${CSS.escape(focusUnitId)}"]`);
    (target || $('tab-courses')).focus({ preventScroll: true });
  }

  function onPopState() {
    const match = /^#unit=(.+)$/.exec(location.hash);
    if (match && state.unit && decodeURIComponent(match[1]) === state.unitId) setView('classroom');
    else if (!match && state.view === 'classroom') showHub(state.unitId);
    else if (match) restoreFromHash();
  }

  /* ── Personal units (AI from sources + "Learn From My Mistakes") ── */

  function customUnitMap() {
    const map = readStorage(CUSTOM_UNITS_KEY, {});
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }

  function saveCustomUnit(record) {
    const map = customUnitMap();
    map[record.unitId] = { ...record, savedAt: new Date().toISOString() };
    const kept = Object.values(map).filter(r => r?.unitId && r.unit)
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))).slice(0, MAX_CUSTOM_UNITS);
    writeStorage(CUSTOM_UNITS_KEY, Object.fromEntries(kept.map(r => [r.unitId, r])));
    renderCustomUnits();
  }

  function renderCustomUnits() {
    const host = $('custom-units-list');
    if (!host) return;
    const units = Object.values(customUnitMap()).filter(r => r?.unitId && r.unit)
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    $('custom-units-section').hidden = !units.length;
    host.innerHTML = units.map(r => {
      const st = unitStatus(savedMastery(r.unitId));
      const mistakes = r.source === 'mistakes';
      return `<div class="unit-row ${mistakes ? 'mistake-unit' : ''}">
        <span class="unit-status ${st.cls}" aria-hidden="true">${st.icon}</span>
        <span class="unit-title">${mistakes ? '🎯 ' : '📝 '}${esc(r.title || r.unit.title || 'Unit')}
          <span class="muted">${mistakes ? 'Học từ lỗi sai' : 'Tài liệu cá nhân'} · ${esc(String(r.savedAt || '').slice(0, 10))}</span></span>
        <span class="unit-badge ${st.cls}">${esc(st.label)}</span>
        <span class="unit-actions"><button type="button" class="btn-small" data-action="open-custom" data-unit="${esc(r.unitId)}">Học ngay</button></span>
      </div>`;
    }).join('');
  }

  /** Mistake units are allowed to bypass the diagnostic gate (decision 0.2-3 in docs/PHASE_9_DESIGN.md). */
  function findStoredUnit(id) {
    const last = readStorage(LAST_UNIT_KEY, null);
    if (last?.unitId === id && last.unit) return last;
    const custom = customUnitMap()[id];
    return custom?.unit ? custom : null;
  }

  const hashUnitId = () => { const m = /^#unit=(.+)$/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; };
  const hashIsMistakeUnit = () => { const id = hashUnitId(); return !!id && findStoredUnit(id)?.source === 'mistakes'; };

  /** Reopen the unit named in the URL hash from ielts_study_last_unit / ielts_custom_units_v1 (AI and mistake units too). */
  function restoreFromHash() {
    const id = hashUnitId();
    if (!id) return false;
    const stored = findStoredUnit(id);
    if (stored && (!state.locked || stored.source === 'mistakes')) { openUnit(stored, { push: false }); return true; }
    if (state.locked) return false;
    const book = (state.config?.sampleTextbooks || []).find(b => b.units.some(u => u.id === id));
    if (book) { openSample(book.id, id, { push: false }); return state.view === 'classroom'; }
    history.replaceState(null, '', location.pathname + location.search);
    return false;
  }

  function continueLastUnit() {
    const last = readStorage(LAST_UNIT_KEY, null);
    if (last?.unit) openUnit(last);
  }

  /* ── Profile sync with /api/me (js/auth-profile.js) ──────── */

  function syncProfile(patch) {
    if (window.AuthProfile?.updateProfile) window.AuthProfile.updateProfile(patch);
  }

  /** Fill empty local goal/commitment from the account profile and merge server streak days (other devices). */
  function applyServerProfile(me) {
    if (!me) return;
    const goal = readStorage(GOAL_KEY, {});
    if (!goal.examDate && me.examDate) $('exam-date').value = me.examDate;
    if (!goal.targetBand && me.targetBand != null) {
      const value = Number(me.targetBand).toFixed(1);
      if ([...$('target-band').options].some(o => o.value === value)) $('target-band').value = value;
    }
    if ((!goal.examDate && me.examDate) || (!goal.targetBand && me.targetBand != null)) {
      writeStorage(GOAL_KEY, { examDate: $('exam-date').value, targetBand: $('target-band').value });
      renderCountdown();
    }
    if (!readStorage(COMMIT_KEY, null) && me.commitment?.time) { writeStorage(COMMIT_KEY, me.commitment); loadCommitment(); }
    if (Array.isArray(me.streak) && me.streak.length) {
      const days = new Set(readStorage(STREAK_KEY, []));
      const before = days.size;
      me.streak.forEach(d => days.add(d));
      if (days.size !== before) { writeStorage(STREAK_KEY, [...days].sort().slice(-120)); renderStreak(); }
    }
  }

  function switchHubTab(tab, { focus = false } = {}) {
    state.hubTab = tab === 'create' ? 'create' : 'courses';
    writeStorage(HUB_TAB_KEY, state.hubTab);
    document.querySelectorAll('.hub-tab').forEach(b => {
      const active = b.dataset.hubTab === state.hubTab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
      if (active && focus) b.focus();
    });
    $('panel-courses').hidden = state.hubTab !== 'courses';
    $('panel-create').hidden = state.hubTab !== 'create';
  }

  function onHubTabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    switchHubTab(state.hubTab === 'courses' ? 'create' : 'courses', { focus: true });
  }

  function renderStepOutline() {
    $('step-outline').innerHTML = STEP_META.map(m => {
      const done = state.session.done.has(m.step);
      const cls = [done ? 'done' : '', state.step === m.step ? 'current' : ''].join(' ');
      return `<li class="${cls}"><button type="button" data-step="${m.step}" ${state.step === m.step ? 'aria-current="step"' : ''}>
        <span class="outline-icon">${done ? '✓' : m.icon}</span><span>${m.label}</span><em>${m.mastery}%</em></button></li>`;
    }).join('');
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
    return !!s.evaluation?.passed;
  }

  function markDone(step) {
    if (state.session.done.has(step)) return;
    state.session.done.add(step);
    markStreak();
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
    renderStepOutline();
    updateNav();
    if (state.step !== 5) stopRecording();
    renderStageBar();
  }

  function updateNav() {
    const prev = $('btn-prev');
    const next = $('btn-next');
    prev.disabled = state.step === 1;
    const complete = stepComplete(state.step);
    if (state.step === 5) {
      next.textContent = 'Hoàn tất Unit ✓';
      next.disabled = !stepComplete(5);
    } else {
      next.textContent = 'Tiếp tục →';
      next.disabled = !complete;
    }
    next.title = next.disabled ? 'Hoàn thành bước này để mở khóa' : '';
  }

  function renderStep(step) {
    const unit = state.unit;
    const meta = STEP_META[step - 1];
    const head = `<h3 class="step-title">${meta.icon} Bước ${step} — ${meta.label} (${meta.mastery}% Mastery)</h3>${state.session.flash ? `<p class="step-error">${esc(state.session.flash)}</p>` : ''}`;
    if (step === 1) return head + renderLesson(unit.lesson);
    if (step === 2) return head + renderFlashcards(unit.flashcards);
    if (step === 3) return head + `<p class="q-sub">Trả lời cả ${unit.quiz.length} câu (đan xen kỹ năng) để mở khóa bước tiếp theo.</p>` + renderQuestions(unit.quiz, 'quiz');
    if (step === 4) return head + `<p class="q-sub">${unit.drill.length} bài tập trộn Reading Paraphrase, GRA và LR (Interleaving).</p>` + renderQuestions(unit.drill, 'drill');
    return head + renderChallenge(unit.challenge);
  }

  const BAND_OPTIONS = ['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0', '8.5'];
  const DIFFICULTY_REASONS = ['Nhớ từ vựng nhưng chưa biết ghép câu', 'Ngữ pháp còn lúng túng', 'Bí ý tưởng triển khai', 'Áp lực thời gian'];
  const MIN_OUTPUT_WORDS = 30;

  function renderTutorResult(r) {
    return `<div class="tutor-result ${r.understood ? 'ok' : ''}">
      ${r.understood ? '<strong>✓ Bạn đã nắm được ý chính.</strong>' : ''}
      ${r.replyVi ? `<p>${esc(r.replyVi)}</p>` : ''}
      ${r.correction ? `<p><strong>Gợi ý sửa:</strong> ${esc(r.correction)}</p>` : ''}
      ${r.explanationVi ? `<p class="muted">${esc(r.explanationVi)}</p>` : ''}
      ${r.socraticHintVi ? `<p>💡 <strong>Gợi ý bậc thang:</strong> ${esc(r.socraticHintVi)}</p>` : ''}
      ${r.followUpQuestion ? `<p>❓ ${esc(r.followUpQuestion)}</p>` : ''}
      <p class="muted">Nguồn: ${esc(r.provider || '')}</p></div>`;
  }

  function renderFeynman(lesson) {
    if (!lesson.feynmanPromptVi) return '';
    const f = state.session.feynman;
    return `<div class="feynman-box" id="feynman-box">
      <strong>💡 Thử thách Feynman</strong>
      <p class="lesson-block">${esc(lesson.feynmanPromptVi)}</p>
      <textarea id="feynman-input" class="study-input study-textarea" rows="3" placeholder="Giải thích lại quy tắc bằng 1–2 câu của riêng bạn, kèm một ví dụ...">${esc(f.text)}</textarea>
      <div class="challenge-meta"><span class="step-error">${esc(f.error)}</span>
        <button type="button" class="btn-primary" id="btn-feynman-check" ${f.loading ? 'disabled' : ''}>${f.loading ? 'Đang kiểm tra...' : 'Kiểm tra độ hiểu với Gia sư AI'}</button></div>
      ${f.result ? renderTutorResult(f.result) : ''}</div>`;
  }

  function renderLesson(lesson) {
    const mistakes = (lesson.commonMistakes || []).map(m =>
      `<div class="mistake-row"><span class="wrong">${esc(m.wrong)}</span> → <span class="right">${esc(m.right)}</span><br><span class="muted">${esc(m.noteVi)}</span></div>`).join('');
    const upgrades = (lesson.bandUpgradeExamples || []).map(u => `
      <div class="band-row">
        <div class="band-low"><span class="band-tag low">Band 5.5</span> ${esc(u.bandLow)}</div>
        <div class="band-high"><span class="band-tag high">Band 7.5+</span> ${esc(u.bandHigh)}</div>
        <p class="muted band-analysis">${esc(u.analysisVi)}</p>
      </div>`).join('');
    return `
      <div class="lesson-block"><strong>${esc(lesson.titleEn)}</strong> · ${esc(lesson.titleVi)}</div>
      <div class="lesson-block"><strong>🇬🇧</strong> ${esc(lesson.explanationEn)}</div>
      <div class="lesson-block"><strong>🇻🇳</strong> ${esc(lesson.explanationVi)}</div>
      ${lesson.formulas?.length ? `<strong>Công thức áp dụng</strong><ul class="formula-list">${lesson.formulas.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${upgrades ? `<div class="band-upgrade"><strong>📈 Bảng Nâng Cấp Câu theo Band</strong>${upgrades}</div>` : ''}
      ${mistakes ? `<strong>Lỗi thường gặp</strong>${mistakes}` : ''}
      ${renderFeynman(lesson)}`;
  }

  function renderFlashcards(cards) {
    const s = state.session;
    return `<p class="q-sub">Active Recall: đọc câu khuyết, tự nhớ từ còn thiếu rồi bấm Kiểm tra trước khi lật thẻ. Lật hết các thẻ để mở khóa bước tiếp theo (${s.flipped.size}/${cards.length}).</p>
      <div class="flashcard-grid">${cards.map((c, i) => {
        const cloze = !!c.clozeSentence;
        const flipped = s.flipped.has(i);
        const recall = s.recall[i];
        const front = cloze
          ? `<span class="hint">Điền từ còn thiếu</span><span class="cloze">${esc(c.clozeSentence)}</span><span class="hint">Gợi nghĩa: ${esc(c.back)}</span>`
          : `<span class="front-word">${esc(c.front)}</span>${c.ipa ? `<span class="ipa">${esc(c.ipa)}</span>` : ''}<span class="hint">bấm để lật</span>`;
        const back = `<span class="front-word">${esc(c.front)}</span>${c.ipa ? `<span class="ipa">${esc(c.ipa)}</span>` : ''}<strong>${esc(c.back)}</strong>${c.example ? `<span class="example">“${esc(c.example)}”</span>` : ''}`;
        const recallRow = cloze && !recall && !flipped
          ? `<div class="recall-row"><input type="text" class="study-input recall-input" data-recall-input="${i}" value="${esc(s.recallText[i] || '')}" placeholder="Nhập từ còn thiếu" autocomplete="off" aria-label="Từ còn thiếu của thẻ ${i + 1}">
              <button type="button" class="btn-small" data-recall-check="${i}">Kiểm tra</button></div>`
          : '';
        const recallResult = recall ? `<div class="recall-result ${recall.ok ? 'ok' : 'bad'}">${recall.ok ? '✓ Nhớ chính xác!' : `✗ Đáp án: ${esc(c.front)}`}</div>` : '';
        return `<div class="flashcard-wrap">
          <button type="button" class="flashcard ${flipped ? 'flipped' : ''}" data-card="${i}" aria-label="Lật thẻ ${i + 1}">
            <div class="flashcard-inner">
              <div class="flashcard-face front">${front}</div>
              <div class="flashcard-face back">${back}</div>
            </div>
          </button>
          ${recallRow}${recallResult}
          <div class="card-actions">
            ${flipped || !cloze ? `<button type="button" class="btn-small" data-speak="${i}">🔊 Nghe phát âm</button>` : ''}
            <button type="button" class="btn-small" data-srs-add="${i}" ${s.srsAdded.has(i) ? 'disabled' : ''}>${s.srsAdded.has(i) ? '✓ Đã vào lịch ôn' : '➕ Đưa vào lịch ôn SRS'}</button>
          </div>
          <button type="button" class="btn-known ${s.known.has(i) ? 'known' : ''}" data-known="${i}">${s.known.has(i) ? '✓ Đã thuộc' : 'Đánh dấu đã thuộc'}</button>
        </div>`;
      }).join('')}</div>`;
  }

  function renderHint(hint) {
    if (!hint) return '';
    if (hint.loading) return '<div class="tutor-result"><p class="muted">Gia sư đang suy nghĩ...</p></div>';
    if (hint.error) return `<p class="step-error">${esc(hint.error)}</p>`;
    return renderTutorResult(hint.result);
  }

  function renderQuestions(items, kind) {
    const answers = state.session[kind];
    const correctCount = items.filter((q, i) => answers[i] === q.answer).length;
    const answered = Object.keys(answers).length;
    return items.map((q, i) => {
      const chosen = answers[i];
      const done = chosen != null;
      const tag = q.skillTag || (kind === 'quiz' ? 'Core Concept Check' : 'Mixed Skill');
      const text = kind === 'drill' ? `${q.instruction ? `<p class="q-sub">${esc(q.instruction)}</p>` : ''}<p class="q-text">${esc(q.sentence)}</p>`
        : `<p class="q-text">${i + 1}. ${esc(q.question)}</p>`;
      const key = `${kind}:${i}`;
      return `<div class="q-card"><span class="skill-tag">🔀 ${esc(tag)}</span>${text}
        <div class="q-options">${q.options.map((o, j) => {
          const cls = done ? (j === q.answer ? 'correct' : (j === chosen ? 'wrong' : '')) : '';
          return `<button type="button" class="q-option ${cls}" data-kind="${kind}" data-q="${i}" data-opt="${j}" ${done ? 'disabled' : ''}>${esc(o)}</button>`;
        }).join('')}</div>
        ${done ? `<div class="q-feedback ${chosen === q.answer ? 'ok' : 'bad'}"><strong>${chosen === q.answer ? '✓ Chính xác!' : '✗ Chưa đúng.'}</strong> ${esc(q.explanation)}</div>` : ''}
        <button type="button" class="btn-small btn-tutor-hint" data-hint="${key}" ${state.session.hints[key]?.loading ? 'disabled' : ''}>💬 Hỏi Gia sư AI Socratic</button>
        ${renderHint(state.session.hints[key])}
      </div>`;
    }).join('') + (answered === items.length ? `<p class="step-summary">Kết quả: ${correctCount}/${items.length} câu đúng.</p>` : '');
  }

  function effectiveOutput() {
    const s = state.session;
    return (s.answer.trim() ? s.answer : s.spoken).trim();
  }

  const criteriaBar = (label, value) => {
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="crit-row"><span>${label}</span><div class="crit-track"><div style="width:${v}%"></div></div><strong>${v}</strong></div>`;
  };
  const bandText = v => (Number(v) > 0 ? Number(v).toFixed(1) : '—');

  function renderCheckpointReport(ev) {
    const meta = ev.metacognition || {};
    const used = ev.usedTargetWords || [];
    const missed = ev.missedTargetWords || [];
    const corrections = ev.inlineCorrections || [];
    const cb = ev.criteriaBreakdown || {};
    const gap = Number(meta.calibrationGap);
    return `<div class="eval-card checkpoint-report ${ev.passed ? 'passed' : 'review'}">
      <div class="report-head">
        <span class="status-badge ${ev.passed ? 'passed' : 'review'}">${ev.passed ? 'PASSED ✓' : 'NEEDS REVIEW ↻'}</span>
        <span class="eval-band">${esc(ev.score)}/100</span>
      </div>
      <div class="band-compare" aria-label="Đối chiếu 3 cột Band">
        <div class="band-col"><span>Band Đầu vào</span><strong>${bandText(ev.inputBand)}</strong></div>
        <span class="band-arrow">➔</span>
        <div class="band-col"><span>Band Tự dự đoán</span><strong>${bandText(meta.selfPredictedBand)}</strong></div>
        <span class="band-arrow">➔</span>
        <div class="band-col actual"><span>Band Thực tế</span><strong>${bandText(ev.outputBand)}</strong></div>
      </div>
      <p class="muted">Chênh lệch so với đầu vào: ${Number(ev.bandDelta) > 0 ? '+' : ''}${esc(ev.bandDelta)} · Lệch so với dự đoán: ${Number.isFinite(gap) ? `${gap > 0 ? '+' : ''}${gap}` : '—'}</p>
      ${meta.calibrationFeedbackVi ? `<p class="calibration-feedback">🪞 ${esc(meta.calibrationFeedbackVi)}</p>` : ''}
      ${meta.selfDifficultyReason ? `<p class="muted">Trở ngại bạn nêu: ${esc(meta.selfDifficultyReason)}</p>` : ''}
      <div class="crit-list">
        ${criteriaBar('Task Achievement', cb.taskAchievement)}
        ${criteriaBar('Lexical Resource', cb.lexicalResource)}
        ${criteriaBar('Grammar Accuracy', cb.grammarAccuracy)}
      </div>
      <div class="word-report">
        <div><strong>Từ đã dùng:</strong> ${used.length ? used.map(w => `<span class="target-chip used">${esc(w)}</span>`).join('') : '<span class="muted">chưa có</span>'}</div>
        <div><strong>Từ bỏ sót:</strong> ${missed.length ? missed.map(w => `<span class="target-chip missed">${esc(w)}</span>`).join('') : '<span class="muted">không có</span>'}</div>
        ${missed.length || corrections.length ? '<p class="muted">🔁 Các từ bỏ sót và lỗi câu đã được tự động đẩy vào lịch ôn SRS.</p>' : ''}
      </div>
      ${corrections.length ? `<div class="corrections"><strong>Sửa lỗi câu trực tiếp</strong>${corrections.map(c => `
        <div class="correction-row"><del>${esc(c.original)}</del> → <ins>${esc(c.correction)}</ins><br><span class="muted">${esc(c.explanationVi)}</span></div>`).join('')}</div>` : ''}
      ${ev.feedbackVi ? `<p>${esc(ev.feedbackVi)}</p>` : ''}${ev.feedbackEn ? `<p class="muted">${esc(ev.feedbackEn)}</p>` : ''}
      ${ev.nextActionVi ? `<p><strong>Việc tiếp theo:</strong> ${esc(ev.nextActionVi)}</p>` : ''}
      <p class="muted">Chấm bởi: ${esc(ev.provider || '')}${/local/i.test(ev.provider || '') ? ' (ước lượng cục bộ, không thay thế giám khảo)' : ''}</p>
      ${ev.passed ? '' : '<button type="button" class="btn-secondary" id="btn-retry-checkpoint">↻ Chỉnh sửa và chấm lại</button>'}
    </div>`;
  }

  function renderChallenge(challenge) {
    const s = state.session;
    const ev = s.evaluation;
    const targets = challenge.targetWords || [];
    const used = new Set((ev?.usedTargetWords || []).map(w => w.toLowerCase()));
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const readonly = ev ? 'readonly' : '';
    return `<p class="lesson-block">${esc(challenge.prompt)}</p>
      <div>${targets.map(w => `<span class="target-chip ${used.has(w.toLowerCase()) ? 'used' : ''}">${esc(w)}</span>`).join('')}</div>
      <textarea id="challenge-input" class="study-input study-textarea challenge-input" placeholder="Viết đoạn văn học thuật bằng tiếng Anh (tối thiểu ${MIN_OUTPUT_WORDS} từ)..." ${readonly}>${esc(s.answer)}</textarea>
      <div class="record-row">
        <button type="button" class="btn-secondary" id="btn-record" ${ev || !SR ? 'disabled' : ''} title="${SR ? '' : 'Trình duyệt không hỗ trợ nhận dạng giọng nói'}">${s.listening ? '⏹ Dừng thu âm' : '🎙️ Thu âm trả lời bằng giọng nói'}</button>
        <span class="muted">${SR ? 'Nói tiếng Anh, bản ghi sẽ hiện bên dưới.' : 'Trình duyệt này không hỗ trợ thu âm; hãy viết bài.'}</span>
      </div>
      <textarea id="spoken-transcript" class="study-input study-textarea" rows="3" placeholder="Bản ghi giọng nói (có thể chỉnh sửa)..." ${readonly}>${esc(s.spoken)}</textarea>
      <div class="challenge-meta"><span id="challenge-count">${countWords(effectiveOutput())} từ (tối thiểu ${MIN_OUTPUT_WORDS}; gợi ý ${challenge.minWords}–${challenge.maxWords})</span></div>
      <div class="calibration-box">
        <strong>🪞 Tự Đánh Giá Siêu Nhận Thức (COPES)</strong>
        <label class="goal-field">Bạn tự dự đoán bài trả lời này của mình đạt Band mấy?
          <select id="self-predicted-band" class="study-input" ${ev ? 'disabled' : ''}>
            <option value="">-- Chọn Band --</option>${BAND_OPTIONS.map(b => `<option value="${b}" ${s.selfBand === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select></label>
        <label class="goal-field">Trở ngại lớn nhất khi bạn làm bài này là gì?
          <select id="self-difficulty-reason" class="study-input" ${ev ? 'disabled' : ''}>
            <option value="">-- Chọn trở ngại --</option>${DIFFICULTY_REASONS.map(r => `<option value="${esc(r)}" ${s.selfReason === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
          </select></label>
      </div>
      <div class="challenge-meta"><span></span>
        <button type="button" class="btn-primary" id="btn-evaluate" ${ev ? 'disabled' : ''}>Nộp và Chấm điểm</button></div>
      <p class="step-error" id="challenge-error">${esc(s.error)}</p>
      ${ev ? renderCheckpointReport(ev) : ''}`;
  }

  let recognizer = null;
  function stopRecording() {
    if (recognizer) { try { recognizer.stop(); } catch { /* already stopped */ } recognizer = null; }
    if (state.session) state.session.listening = false;
  }

  function toggleRecording() {
    const s = state.session;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (recognizer) { stopRecording(); renderPlayer(); return; }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = event => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) text += `${event.results[i][0].transcript} `;
      if (!text.trim()) return;
      s.spoken = `${s.spoken.trim()} ${text.trim()}`.trim();
      const box = $('spoken-transcript');
      if (box) box.value = s.spoken;
      updateChallengeCount();
    };
    rec.onerror = event => { s.error = event.error === 'not-allowed' ? 'Chưa cấp quyền micro cho trình duyệt.' : `Lỗi thu âm: ${event.error}`; };
    rec.onend = () => { recognizer = null; s.listening = false; if (state.session === s && state.step === 5) renderPlayer(); };
    try { rec.start(); recognizer = rec; s.listening = true; s.error = ''; } catch (e) { s.error = e.message; }
    renderPlayer();
  }

  function updateChallengeCount() {
    const c = state.unit.challenge;
    const el = $('challenge-count');
    if (el) el.textContent = `${countWords(effectiveOutput())} từ (tối thiểu ${MIN_OUTPUT_WORDS}; gợi ý ${c.minWords}–${c.maxWords})`;
  }

  function quizTally() {
    const s = state.session;
    const results = [...(state.unit.quiz || []).map((q, i) => s.quiz[i] === q.answer), ...(state.unit.drill || []).map((q, i) => s.drill[i] === q.answer)];
    return { quizScore: results.filter(Boolean).length, quizTotal: results.length };
  }

  async function evaluateChallenge() {
    const s = state.session;
    const c = state.unit.challenge;
    const button = $('btn-evaluate');
    const err = $('challenge-error');
    const fail = message => { s.error = message; err.textContent = message; };
    if (countWords(effectiveOutput()) < MIN_OUTPUT_WORDS) { fail(`Hãy viết hoặc nói ít nhất ${MIN_OUTPUT_WORDS} từ.`); return; }
    if (!s.selfBand || !s.selfReason) { fail('Hãy hoàn thành phần Tự Đánh Giá Siêu Nhận Thức trước khi nộp.'); return; }
    stopRecording();
    s.error = '';
    err.textContent = '';
    button.disabled = true;
    button.textContent = 'Đang chấm...';
    const ctx = currentBandContext();
    try {
      const result = await postJson('/api/study/checkpoint-evaluate', {
        unitId: state.unitId, unitTitle: state.unitTitle, inputBand: ctx.inputBand, targetBand: ctx.targetBand,
        selfPredictedBand: Number(s.selfBand), selfDifficultyReason: s.selfReason, ...quizTally(),
        writtenOutput: s.answer, spokenTranscript: s.spoken, targetWords: c.targetWords, prompt: c.prompt
      });
      s.evaluation = result;
      if (result.passed) { s.done.add(5); persistProgress(currentMastery()); }
      markStreak();
      renderPlayer();
      refreshAfterCheckpoint();
    } catch (e) {
      button.disabled = false;
      button.textContent = 'Nộp và Chấm điểm';
      fail(e.message);
    }
  }

  function goStep(n) {
    if (n < 1 || n > 5) return;
    // Only allow jumping forward to steps whose previous steps are complete.
    for (let i = 1; i < n; i++) if (!stepComplete(i)) return;
    state.step = n;
    state.session.flash = '';
    renderPlayer();
  }

  function onNext() {
    if (!stepComplete(state.step)) return;
    if (state.step < 5) {
      markDone(state.step);
      state.step += 1;
      state.session.flash = '';
      renderPlayer();
    } else {
      $('step-body').insertAdjacentHTML('beforeend', '<p class="step-summary">🎉 Bạn đã đạt 100% Mastery cho Unit này!</p>');
    }
  }

  const normalizeWord = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, ' ').trim();

  function speak(text) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  async function runTutorHint(key) {
    const s = state.session;
    const [kind, idx] = key.split(':');
    const item = state.unit[kind]?.[Number(idx)];
    if (!item) return;
    const chosen = s[kind][Number(idx)];
    const options = (item.options || []).map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`).join(' | ');
    s.hints[key] = { loading: true };
    renderPlayer();
    let hint;
    try {
      const result = await askTutor({
        mode: 'socratic',
        stepContext: `Bước ${kind === 'quiz' ? 3 : 4} — ${kind === 'quiz' ? 'Quick Quiz' : 'Interleaved Drill'} · ${item.skillTag || ''}`,
        userQuestion: `${kind === 'drill' ? `${item.instruction || ''} ${item.sentence}` : item.question} Options: ${options}`,
        userAttempt: chosen != null ? `Tôi chọn: ${item.options[chosen]}` : ''
      });
      hint = { result };
    } catch (e) { hint = { error: e.message }; }
    s.hints[key] = hint;
    if (state.session === s) renderPlayer();
  }

  async function runFeynmanCheck() {
    const s = state.session;
    const f = s.feynman;
    if (countWords(f.text) < 8) { f.error = 'Hãy viết 1–2 câu (ít nhất 8 từ) bằng lời của bạn.'; renderPlayer(); return; }
    f.error = '';
    f.loading = true;
    renderPlayer();
    try {
      f.result = await askTutor({ mode: 'feynman', stepContext: 'Bước 1 — Deep Lesson (Feynman)', userQuestion: state.unit.lesson.feynmanPromptVi || '', userAttempt: f.text });
    } catch (e) { f.error = e.message; }
    f.loading = false;
    if (state.session === s) renderPlayer();
  }

  async function addCardToSrs(i) {
    const s = state.session;
    const card = state.unit.flashcards[i];
    try {
      await postJson('/api/study/srs/review', {
        word: card.front, meaning: card.back, example: card.example || '', unitId: state.unitId, source: 'lesson',
        quality: s.recall[i]?.ok === false ? 'again' : 'good'
      });
      s.srsAdded.add(i);
      s.flash = '';
      markStreak();
      refreshSrs();
    } catch (e) { s.flash = `Không thêm được vào lịch ôn: ${e.message}`; }
    if (state.session === s) renderPlayer();
  }

  function onStepBodyClick(event) {
    const s = state.session;
    const t = event.target;
    let el;
    if ((el = t.closest('[data-recall-check]'))) {
      const i = Number(el.dataset.recallCheck);
      const typed = normalizeWord(s.recallText[i]);
      if (!typed) return;
      s.recall[i] = { ok: typed === normalizeWord(state.unit.flashcards[i].front) };
      s.flipped.add(i);
      renderPlayer();
    } else if ((el = t.closest('[data-speak]'))) {
      if (!speak(state.unit.flashcards[Number(el.dataset.speak)].front)) { s.flash = 'Trình duyệt không hỗ trợ phát âm.'; renderPlayer(); }
    } else if ((el = t.closest('[data-srs-add]'))) {
      addCardToSrs(Number(el.dataset.srsAdd));
    } else if ((el = t.closest('[data-hint]'))) {
      runTutorHint(el.dataset.hint);
    } else if (t.closest('#btn-feynman-check')) {
      runFeynmanCheck();
    } else if (t.closest('#btn-record')) {
      toggleRecording();
    } else if (t.closest('#btn-evaluate')) {
      evaluateChallenge();
    } else if (t.closest('#btn-retry-checkpoint')) {
      s.evaluation = null;
      renderPlayer();
    } else if ((el = t.closest('[data-card]'))) {
      s.flipped.add(Number(el.dataset.card));
      renderPlayer();
    } else if ((el = t.closest('[data-known]'))) {
      const i = Number(el.dataset.known);
      if (s.known.has(i)) s.known.delete(i); else s.known.add(i);
      s.flipped.add(i);
      renderPlayer();
    } else if ((el = t.closest('.q-option')) && !el.disabled) {
      s[el.dataset.kind][Number(el.dataset.q)] = Number(el.dataset.opt);
      const kindStep = el.dataset.kind === 'quiz' ? 3 : 4;
      if (stepComplete(kindStep)) markDone(kindStep);
      renderPlayer();
    }
  }

  /** Persist free-text and select values without re-rendering (keeps focus while typing). */
  function onStepBodyInput(event) {
    const s = state.session;
    const t = event.target;
    if (!s || !t) return;
    if (t.id === 'challenge-input') { s.answer = t.value; updateChallengeCount(); }
    else if (t.id === 'spoken-transcript') { s.spoken = t.value; updateChallengeCount(); }
    else if (t.id === 'self-predicted-band') s.selfBand = t.value;
    else if (t.id === 'self-difficulty-reason') s.selfReason = t.value;
    else if (t.id === 'feynman-input') s.feynman.text = t.value;
    else if (t.dataset?.recallInput != null) s.recallText[Number(t.dataset.recallInput)] = t.value;
  }

  /* ── Opening units ──────────────────────────────────────── */

  function openSample(textbookId, unitId, opts) {
    const found = findUnit(textbookId, unitId);
    if (state.locked || !found?.unit.sample) return;
    openUnit({ unit: found.unit.sample, unitId, title: found.unit.title, source: 'textbook', provider: 'Built-in sample unit', textbookId }, opts);
  }

  const weakLabels = () => state.weak.map(w => w.label);

  async function generateFromTextbook(button, textbookId, unitId) {
    const original = button.textContent;
    const hubStatus = $('hub-status');
    hubStatus.classList.remove('step-error');
    hubStatus.textContent = 'Đang tạo bài học bằng AI...';
    button.disabled = true;
    button.textContent = 'Đang tạo...';
    try {
      const data = await postJson('/api/study/generate-unit', {
        textbookId, unitId, weakAreas: weakLabels(), targetBand: parseBand($('target-band').value, null)
      });
      const found = findUnit(textbookId, unitId);
      hubStatus.textContent = '';
      openUnit({ unit: data.unit, unitId: found?.unit.id || data.unitId, title: found?.unit.title || data.unit.title, source: 'textbook', provider: data.fallback ? `${data.provider} (AI không khả dụng)` : data.provider, textbookId });
    } catch (e) {
      const status = $('hub-status');
      status.textContent = `Không tạo được bài học: ${e.message}`;
      status.classList.add('step-error');
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

  /** Load a UMD library from the CDN once, only when the learner actually picks a PDF/DOCX file. */
  const scriptCache = {};
  function loadScript(url, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    scriptCache[url] ||= new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = url;
      tag.async = true;
      tag.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(`${globalName} không khả dụng`)));
      tag.onerror = () => { delete scriptCache[url]; reject(new Error('Không tải được thư viện đọc file (kiểm tra kết nối mạng).')); };
      document.head.appendChild(tag);
    });
    return scriptCache[url];
  }

  async function extractPdfText(file) {
    const pdfjsLib = await loadScript(PDFJS_URL, 'pdfjsLib');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    let total = 0;
    for (let i = 1; i <= pdf.numPages && total < MAX_SOURCE_CHARS; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      const text = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
      pages.push(text);
      total += text.length;
    }
    return pages.join('\n\n');
  }

  async function extractDocxText(file) {
    const mammoth = await loadScript(MAMMOTH_URL, 'mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return String(result.value || '');
  }

  async function onFileChosen(event) {
    const file = event.target.files?.[0];
    const info = $('source-file-info');
    state.fileText = '';
    if (!file) { info.textContent = 'Chưa chọn file.'; return; }
    const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] || '').toLowerCase();
    if (!['txt', 'md', 'pdf', 'docx'].includes(ext)) { info.textContent = 'Chỉ hỗ trợ file .txt, .md, .pdf hoặc .docx.'; return; }
    if (file.size > MAX_FILE_BYTES) { info.textContent = 'File quá lớn (tối đa 10 MB).'; return; }
    const token = (state.fileToken = (state.fileToken || 0) + 1);
    info.textContent = ext === 'pdf' || ext === 'docx' ? `Đang đọc ${file.name}...` : '';
    try {
      let text;
      if (ext === 'pdf') text = await extractPdfText(file);
      else if (ext === 'docx') text = await extractDocxText(file);
      else text = await file.text();
      if (token !== state.fileToken) return; // a newer file was chosen meanwhile
      text = text.replace(/\n{3,}/g, '\n\n').trim();
      const truncated = text.length > MAX_SOURCE_CHARS;
      state.fileText = text.slice(0, MAX_SOURCE_CHARS);
      state.fileName = file.name.replace(/\.[a-z0-9]+$/i, '');
      info.textContent = !state.fileText
        ? (ext === 'pdf' ? 'Không tìm thấy chữ trong PDF (có thể là bản scan ảnh).' : 'File không có nội dung văn bản.')
        : `${file.name} — ${countWords(state.fileText)} từ${truncated ? ` (đã cắt còn ${MAX_SOURCE_CHARS.toLocaleString('vi-VN')} ký tự đầu)` : ''}.`;
    } catch (e) {
      if (token === state.fileToken) info.textContent = `Không đọc được file: ${e.message}`;
    }
  }

  function switchTab(tab) {
    state.sourceTab = tab;
    document.querySelectorAll('.source-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.source-pane').forEach(p => { p.hidden = p.dataset.pane !== tab; });
  }

  /* ── SRL-SLA: tutor, streak, commitment ─────────────────── */

  function currentBandContext() {
    return { inputBand: state.diag?.profile?.inputBand ?? null, targetBand: parseBand($('target-band').value, null) };
  }

  function askTutor({ mode, userQuestion = '', userAttempt = '', stepContext = '' }) {
    const ctx = currentBandContext();
    return postJson('/api/study/tutor-feedback', {
      mode, unitTitle: state.unitTitle, stepContext, userQuestion, userAttempt, inputBand: ctx.inputBand, targetBand: ctx.targetBand
    });
  }

  async function askTutorFromPanel() {
    const input = $('tutor-input');
    const status = $('tutor-status');
    const text = input.value.trim();
    if (!text) { status.textContent = 'Hãy nhập câu hỏi hoặc câu cần sửa.'; return; }
    const button = $('btn-tutor-ask');
    button.disabled = true;
    status.textContent = 'Gia sư đang suy nghĩ...';
    try {
      const meta = STEP_META[state.step - 1];
      const result = await askTutor({ mode: 'socratic', userQuestion: text, stepContext: `Bước ${state.step} — ${meta.label}` });
      $('tutor-reply').innerHTML = renderTutorResult(result);
      status.textContent = '';
    } catch (e) {
      status.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  }

  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  function markStreak() {
    const days = new Set(readStorage(STREAK_KEY, []));
    const today = dateKey(new Date());
    if (!days.has(today)) syncProfile({ streak: [today] });
    days.add(today);
    writeStorage(STREAK_KEY, [...days].sort().slice(-120));
    renderStreak();
  }

  function renderStreak() {
    const bar = $('streak-bar');
    if (!bar) return;
    const days = new Set(readStorage(STREAK_KEY, []));
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const todayKey = dateKey(now);
    bar.innerHTML = labels.map((label, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const key = dateKey(d);
      const cls = [days.has(key) ? 'done' : '', key === todayKey ? 'today' : ''].join(' ');
      return `<li class="${cls}"><span>${label}</span><strong>${days.has(key) ? '✓' : '·'}</strong></li>`;
    }).join('');
    let streak = 0;
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(dateKey(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
    $('streak-count').textContent = `${streak} ngày liên tiếp`;
    const svgImg = $('streak-stats-svg');
    if (svgImg) {
      const datesParam = encodeURIComponent([...days].sort().slice(-120).join(','));
      svgImg.src = `/api/study/streak-stats.svg?dates=${datesParam}&t=${Date.now()}`;
    }
  }

  function loadCommitment() {
    const c = readStorage(COMMIT_KEY, null);
    if (!c) return;
    if (c.time) $('commit-time').value = c.time;
    if (c.minutes) $('commit-minutes').value = c.minutes;
    $('commit-status').textContent = `Cam kết hiện tại: Nếu đến ${c.time} mỗi ngày, tôi sẽ học ít nhất ${c.minutes} phút tại bàn học.`;
  }

  function saveCommitment() {
    const time = $('commit-time').value;
    const minutes = Math.round(Number($('commit-minutes').value));
    const status = $('commit-status');
    if (!/^\d{2}:\d{2}$/.test(time) || !(minutes >= 5 && minutes <= 240)) {
      status.textContent = 'Hãy chọn giờ học và số phút từ 5 đến 240.';
      return;
    }
    writeStorage(COMMIT_KEY, { time, minutes });
    syncProfile({ commitment: { time, minutes } });
    status.textContent = `Đã lưu: Nếu đến ${time} mỗi ngày, tôi sẽ học ít nhất ${minutes} phút tại bàn học.`;
  }

  /* ── Stage 1: diagnostic gate, profile, curriculum ──────── */

  async function syncPlacementResults() {
    const local = readStorage(PLACEMENT_KEY, []);
    if (!Array.isArray(local) || !local.length) return;
    const synced = new Set(readStorage(SYNCED_KEY, []));
    const pending = local.filter(r => r && typeof r === 'object' && typeof r.id === 'string' && !synced.has(r.id)).slice(-20);
    for (const record of pending) {
      try { await postJson('/api/placement/results', record); synced.add(record.id); }
      catch (e) { if (!(e instanceof TypeError)) synced.add(record.id); /* invalid record: do not retry; network error: retry later */ }
    }
    writeStorage(SYNCED_KEY, [...synced]);
  }

  function renderStageBar() {
    const stage = state.view !== 'classroom' ? 1 : (state.step === 5 ? 3 : 2);
    document.querySelectorAll('.srl-stage').forEach(el => {
      const n = Number(el.dataset.stage);
      el.classList.toggle('current', n === stage);
      el.classList.toggle('done', n < stage);
    });
  }

  function applyGate() {
    const d = state.diag;
    state.locked = !!d && !d.unlocked;
    state.ready = true;
    $('hub-loading').hidden = true;
    $('diagnostic-gate').hidden = !state.locked;
    const notice = $('diagnostic-notice');
    notice.hidden = !!d;
    if (!d) notice.textContent = 'Không kết nối được máy chủ chẩn đoán nên giáo trình tạm mở ở chế độ ngoại tuyến. Hãy tải lại trang khi có mạng.';
    $('recommended-curriculum').hidden = !(d && d.unlocked);
    setView(state.view);
    renderTodo();
  }

  const fmtBand = v => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(1));

  function renderProfile() {
    const p = state.diag?.profile;
    const host = $('profile-body');
    $('band-input').textContent = fmtBand(p?.inputBand);
    if (!p) { host.textContent = 'Chưa có hồ sơ.'; return; }
    const counts = state.diag.counts || {};
    const skills = [['reading', 'Reading'], ['listening', 'Listening'], ['writing', 'Writing'], ['speaking', 'Speaking']];
    const ci = Number(p.calibrationIndex) || 0;
    let calibration = 'Chưa có lượng giá nào để hiệu chuẩn.';
    if (state.checkpoints.length) {
      calibration = Math.abs(ci) < 0.25 ? 'Bạn tự đánh giá khá chính xác.'
        : ci < 0 ? 'Bạn có xu hướng tự đánh giá cao hơn kết quả thực tế.' : 'Bạn có xu hướng tự đánh giá thấp hơn kết quả thực tế.';
    }
    host.innerHTML = `
      <div class="profile-grid">
        <div class="profile-stat main"><span>Input Band</span><strong>${fmtBand(p.inputBand)}</strong><em>Mục tiêu gợi ý ${fmtBand(p.recommendedTargetBand)}</em></div>
        ${skills.map(([k, label]) => `<div class="profile-stat"><span>${label}</span><strong>${fmtBand(p.skills?.[k])}</strong></div>`).join('')}
      </div>
      <div class="profile-row"><strong>Điểm yếu:</strong> ${p.weakAreas?.length ? p.weakAreas.map(w => `<span class="gap-chip">${esc(w)}</span>`).join('') : '<span class="muted">Chưa xác định</span>'}</div>
      <div class="profile-row"><strong>Chỉ số hiệu chuẩn (calibrationIndex):</strong> ${ci > 0 ? '+' : ''}${ci.toFixed(1)} <span class="muted">${esc(calibration)}</span></div>
      <p class="muted">Dữ liệu: ${esc(counts.placement || 0)} Placement · ${esc(counts.writing || 0)} Writing · ${esc(counts.speaking || 0)} Speaking</p>`;
  }

  function applyDefaultTarget() {
    const rec = state.diag?.profile?.recommendedTargetBand;
    if (rec == null || readStorage(GOAL_KEY, {}).targetBand) return;
    const select = $('target-band');
    const value = Number(rec).toFixed(1);
    if ([...select.options].some(o => o.value === value)) { select.value = value; renderCountdown(); }
  }

  function renderRecommended() {
    const host = $('recommended-list');
    const list = state.diag?.recommendedCurriculum || [];
    if (!list.length) { host.innerHTML = '<p class="muted">Chưa có Unit khớp vùng i+1. Hãy làm thêm Writing hoặc Speaking để hồ sơ chính xác hơn.</p>'; return; }
    host.innerHTML = list.map((u, i) => `
      <div class="unit-row recommended ${i === 0 ? 'suggested' : ''}">
        <div class="rec-info">
          <div class="rec-title">${i === 0 ? '⭐ ' : ''}${esc(u.title)}</div>
          <div class="rec-meta"><span class="level-chip">${esc(u.levelTag || 'Unit')}</span>
            ${(u.targetWeakness || []).map(w => `<span class="gap-chip">${esc(w)}</span>`).join('')}
            <span class="muted">${esc(u.textbookTitle || '')} · Band ${esc(u.bandRange || '')}</span></div>
          <div class="muted">${esc(u.matchReasonVi || '')}</div>
        </div>
        ${savedMastery(u.id) ? `<span class="unit-badge">${savedMastery(u.id)}% Mastery</span>` : ''}
        <span class="unit-actions"><button type="button" class="btn-small" data-action="open-sample" data-book="${esc(u.textbookId)}" data-unit="${esc(u.id)}">Học ngay</button></span>
      </div>`).join('');
  }

  async function loadDiagnostic() {
    await syncPlacementResults();
    state.diag = await getJson('/api/study/diagnostic-status', null);
    applyGate();
    if (state.diag?.unlocked) {
      renderProfile();
      renderRecommended();
      applyDefaultTarget();
      await refreshSrs();
    }
  }

  /* ── Spaced repetition queue ────────────────────────────── */

  const SRS_RATINGS = [
    { quality: 'again', label: 'Quên / again', hint: 'Ôn lại ngay' },
    { quality: 'hard', label: 'Khó / hard', hint: '1 ngày' },
    { quality: 'good', label: 'Nhớ tốt / good', hint: '3 ngày' },
    { quality: 'easy', label: 'Rất dễ / easy', hint: '7 ngày' }
  ];

  async function refreshSrs() {
    state.srs = await getJson('/api/study/srs', null);
    renderSrsDue();
  }

  function renderSrsDue() {
    const host = $('srs-due-list');
    const due = state.srs?.dueToday;
    $('srs-due-count').textContent = String(due?.length || 0);
    if (!due) { host.innerHTML = '<p class="muted">Không tải được hàng đợi ôn tập.</p>'; return; }
    if (!due.length) { host.innerHTML = '<p class="muted">🎉 Không có thẻ nào đến hạn hôm nay.</p>'; return; }
    const visible = state.srsExpanded ? due : due.slice(0, SRS_PREVIEW);
    host.innerHTML = visible.map(item => `
      <div class="srs-item" data-item="${esc(item.itemId)}">
        <div class="srs-word">${esc(item.word)}</div>
        ${item.meaning ? `<div class="muted">${esc(item.meaning)}</div>` : ''}
        ${item.example ? `<div class="muted srs-example">${esc(item.example)}</div>` : ''}
        <div class="srs-rate">${SRS_RATINGS.map(r => `<button type="button" class="btn-small srs-${r.quality}" data-srs-rate="${r.quality}" data-item-id="${esc(item.itemId)}" title="${r.hint}">${r.label}</button>`).join('')}</div>
      </div>`).join('') + (due.length > SRS_PREVIEW
      ? `<button type="button" class="btn-small srs-more" data-srs-more>${state.srsExpanded ? 'Thu gọn' : `Xem tất cả (${due.length})`}</button>` : '');
  }

  async function onSrsRate(event) {
    if (event.target.closest('[data-srs-more]')) { state.srsExpanded = !state.srsExpanded; renderSrsDue(); return; }
    const button = event.target.closest('[data-srs-rate]');
    if (!button || !state.srs) return;
    const quality = button.dataset.srsRate;
    const itemId = button.dataset.itemId;
    button.disabled = true;
    try {
      await postJson('/api/study/srs/review', { itemId, quality });
      markStreak();
      const due = state.srs.dueToday;
      const index = due.findIndex(x => x.itemId === itemId);
      if (index >= 0) {
        const [item] = due.splice(index, 1);
        if (quality === 'again') due.push(item);
      }
      renderSrsDue();
    } catch (e) {
      button.disabled = false;
      $('srs-due-list').insertAdjacentHTML('afterbegin', `<p class="step-error">${esc(e.message)}</p>`);
    }
  }

  /* ── Stage 3 history ────────────────────────────────────── */

  async function loadCheckpoints() {
    const list = await getJson('/api/study/checkpoints', []);
    state.checkpoints = Array.isArray(list) ? list : [];
    renderCheckpointHistory();
  }

  function renderCheckpointHistory() {
    const host = $('checkpoint-history');
    $('checkpoint-count').textContent = String(state.checkpoints.length);
    if (!state.checkpoints.length) { host.innerHTML = '<p class="muted">Chưa có lượng giá nào.</p>'; return; }
    host.innerHTML = state.checkpoints.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 8).map(c => `
      <div class="progress-item checkpoint-item">
        <div class="p-title">${esc(c.unitTitle || c.unitId || 'Checkpoint')}</div>
        <div class="p-meta"><span class="status-badge small ${c.passed ? 'passed' : 'review'}">${c.passed ? 'PASSED ✓' : 'NEEDS REVIEW ↻'}</span>
          Band ${bandText(c.inputBand)} ➔ ${bandText(c.metacognition?.selfPredictedBand)} ➔ <strong>${bandText(c.outputBand)}</strong> · ${esc(c.score)}/100</div>
        <div class="p-meta">${esc(String(c.timestamp || '').slice(0, 10))}</div>
      </div>`).join('');
  }

  async function refreshAfterCheckpoint() {
    await loadCheckpoints();
    mergeProgress(await getJson('/api/study/progress', []));
    renderTodo();
    renderLibrary();
    renderCustomUnits();
    if (!state.locked && state.diag?.unlocked) {
      state.diag = await getJson('/api/study/diagnostic-status', state.diag);
      renderProfile();
      renderRecommended();
      await refreshSrs();
    }
  }

  /* ── Init ───────────────────────────────────────────────── */

  async function init() {
    loadGoal();
    loadCommitment();
    renderStreak();
    renderStageBar();
    state.config = await getJson('/api/study/config', null);
    if (state.config?.masterySteps?.length === 5) {
      state.steps = state.config.masterySteps;
    }
    mergeProgress(await getJson('/api/study/progress', []));
    computeSuggestion();
    renderLibrary();
    renderGaps();
    loadWeaknesses().then(() => { computeSuggestion(); renderLibrary(); renderGaps(); });
    loadCheckpoints();
    switchHubTab(/^#create/.test(location.hash) ? 'create' : readStorage(HUB_TAB_KEY, 'courses'));
    renderCustomUnits();
    window.AuthProfile?.ready?.then(applyServerProfile);
    loadDiagnostic().then(() => {
      computeSuggestion(); renderLibrary(); renderGaps(); renderProfile();
      if (!state.locked || hashIsMistakeUnit()) restoreFromHash();
    });
    $('custom-units-list').addEventListener('click', event => {
      const btn = event.target.closest('[data-action="open-custom"]');
      const stored = btn && findStoredUnit(btn.dataset.unit);
      if (stored) openUnit(stored);
    });

    $('btn-back-to-hub').addEventListener('click', backToHub);
    $('btn-continue-unit').addEventListener('click', continueLastUnit);
    window.addEventListener('popstate', onPopState);
    document.querySelectorAll('.hub-tab').forEach(b => {
      b.addEventListener('click', () => switchHubTab(b.dataset.hubTab));
      b.addEventListener('keydown', onHubTabKey);
    });
    $('step-outline').addEventListener('click', event => {
      const btn = event.target.closest('[data-step]');
      if (btn) goStep(Number(btn.dataset.step));
    });

    $('btn-save-goal').addEventListener('click', saveGoal);
    $('btn-save-commitment').addEventListener('click', saveCommitment);
    $('btn-gate-refresh').addEventListener('click', () => loadDiagnostic().then(() => { computeSuggestion(); renderLibrary(); renderGaps(); }));
    $('btn-tutor-ask').addEventListener('click', askTutorFromPanel);
    $('srs-due-list').addEventListener('click', onSrsRate);
    $('recommended-list').addEventListener('click', event => {
      const btn = event.target.closest('[data-action="open-sample"]');
      if (btn) openSample(btn.dataset.book, btn.dataset.unit);
    });
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
    $('step-body').addEventListener('input', onStepBodyInput);
    $('step-body').addEventListener('change', onStepBodyInput);
    $('step-dots').addEventListener('click', event => {
      const li = event.target.closest('[data-step]');
      if (li) goStep(Number(li.dataset.step));
    });
    $('btn-prev').addEventListener('click', () => goStep(state.step - 1));
    $('btn-next').addEventListener('click', onNext);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init, daysUntil, openSample, setView };
})();

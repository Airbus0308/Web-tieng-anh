/**
 * Phase 9B — Learner Profile Pill, Sync Passcode modal, device sessions and the shared
 * "Learn From My Mistakes" launcher. Loaded on all 5 pages before the page script.
 *
 * Identity is an HttpOnly cookie (`im_uid`) issued by the server, so this module never sees a token:
 * it only calls same-origin APIs (`/api/me`, `/api/auth/*`) and renders the result.
 */
const AuthProfile = (() => {
  const CUSTOM_UNITS_KEY = 'ielts_custom_units_v1';
  const MAX_CUSTOM_UNITS = 20;
  /** Learner history that the server now owns after a passcode merge (cleared locally to avoid re-uploading). */
  const MERGED_KEYS = ['ielts_placement_results', 'ielts_writing_history', 'ielts_speaking_history', 'ielts_study_progress', 'ielts_study_synced_placement'];
  /** Everything that belongs to one learner — cleared on sign-out so the next guest starts clean. */
  const LEARNER_KEYS = [...MERGED_KEYS, 'ielts_study_goal', 'ielts_study_commitment', 'ielts_study_streak', 'ielts_study_last_unit', CUSTOM_UNITS_KEY];
  /** Sent to POST /api/auth/redeem as `localData` (server merges and de-duplicates). */
  const LOCAL_DATA_KEYS = ['ielts_placement_results', 'ielts_writing_history', 'ielts_speaking_history', 'ielts_study_progress', 'ielts_study_goal', 'ielts_study_commitment', 'ielts_study_streak'];

  const state = { me: null, inputBand: null, modalOpen: false, lastFocus: null, newPasscode: '', pendingRedeem: null, busy: false, message: null };
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const readJson = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };
  const removeKeys = keys => keys.forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });

  async function api(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; err.data = data; throw err; }
    return data;
  }

  /* ── Derived profile values ─────────────────────────────── */

  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /** Current streak from the union of server profile dates and this device's study days. */
  function currentStreak() {
    const days = new Set([...(Array.isArray(state.me?.streak) ? state.me.streak : []), ...readJson('ielts_study_streak', [])]);
    const cursor = new Date();
    if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (days.has(dateKey(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
    return streak;
  }

  function targetBand() {
    const t = state.me?.targetBand ?? readJson('ielts_study_goal', {}).targetBand;
    return t == null || t === '' || !Number.isFinite(Number(t)) ? null : Number(t);
  }

  /** "5.5 → 7.0", "→ 7.0" or "Chưa đặt mục tiêu" — never a bare "— → —". */
  function bandText() {
    const input = state.inputBand, target = targetBand();
    if (input == null && target == null) return 'Chưa đặt mục tiêu';
    return input == null ? `Mục tiêu ${fmtBand(target)}` : `${fmtBand(input)} → ${fmtBand(target)}`;
  }

  const fmtBand = v => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(1));
  const initials = name => (String(name || '').trim().split(/\s+/).filter(Boolean).slice(-1)[0] || 'H').charAt(0).toUpperCase();

  function deviceName(label) {
    const ua = String(label || '');
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'thiết bị khác';
    return `${browser} · ${os}`;
  }

  const fmtTime = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }); };

  /* ── Header pill ────────────────────────────────────────── */

  function mountPill() {
    const header = document.querySelector('.nav-bar') || document.querySelector('.app-header');
    if (!header || document.getElementById('user-profile-pill')) return;
    let host = header.querySelector('.header-right');
    if (!host) { host = document.createElement('div'); host.className = 'header-right'; header.appendChild(host); }
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.id = 'user-profile-pill';
    pill.className = 'profile-pill';
    pill.setAttribute('aria-haspopup', 'dialog');
    pill.addEventListener('click', openModal);
    host.prepend(pill);
    renderPill();
  }

  function renderPill() {
    const pill = document.getElementById('user-profile-pill');
    if (!pill) return;
    const me = state.me;
    const guest = !me || me.role === 'guest';
    const ephemeral = me?.storage === 'ephemeral';
    pill.classList.toggle('is-guest', guest);
    pill.classList.toggle('is-ephemeral', ephemeral);
    const name = guest ? 'Khách' : (me.displayName || 'Học viên');
    const band = bandText();
    pill.innerHTML = `
      <span class="pp-avatar" aria-hidden="true">${guest ? '👤' : esc(initials(me.displayName))}</span>
      <span class="pp-text">
        <span class="pp-name">${esc(name)}${guest ? '<span class="pp-cta"> · Lưu tiến độ</span>' : ''}</span>
        <span class="pp-meta"><span class="pp-band" title="Band đầu vào → Band mục tiêu">🎯 ${esc(band)}</span><span class="pp-streak" title="Chuỗi ngày học liên tiếp">🔥 ${currentStreak()}</span></span>
      </span>
      <span class="pp-streak-compact" aria-hidden="true">🔥 ${currentStreak()}</span>
      ${ephemeral ? '<span class="pp-warn" title="Dữ liệu đang lưu tạm thời">⚠</span>' : ''}`;
    pill.setAttribute('aria-label', `Hồ sơ học viên: ${name}, Band ${band}, chuỗi ${currentStreak()} ngày${ephemeral ? ', cảnh báo: dữ liệu lưu tạm thời' : ''}`);
  }

  async function refresh() {
    try {
      state.me = await api('/api/me');
    } catch { state.me = null; }
    renderPill();
    if (state.modalOpen) renderModal();
    resolveReady(state.me);
    return state.me;
  }

  async function loadInputBand() {
    try {
      const d = await api('/api/study/diagnostic-status');
      state.inputBand = d?.profile?.inputBand ?? null;
      renderPill();
    } catch { /* optional decoration */ }
  }

  /* ── Modal ──────────────────────────────────────────────── */

  function ensureModal() {
    let backdrop = document.getElementById('profile-modal-backdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'profile-modal-backdrop';
    backdrop.className = 'pm-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = '<div class="pm-dialog" id="profile-modal" role="dialog" aria-modal="true" aria-labelledby="pm-title" tabindex="-1"></div>';
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
    backdrop.addEventListener('keydown', onModalKey);
    const dialog = backdrop.querySelector('#profile-modal');
    dialog.addEventListener('click', onModalClick);
    dialog.addEventListener('submit', onModalSubmit);
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function openModal() {
    state.lastFocus = document.activeElement;
    state.modalOpen = true;
    state.message = null;
    ensureModal().hidden = false;
    renderModal();
    document.getElementById('profile-modal').focus();
    refresh();
  }

  function closeModal() {
    state.modalOpen = false;
    state.newPasscode = '';
    state.pendingRedeem = null;
    const backdrop = document.getElementById('profile-modal-backdrop');
    if (backdrop) backdrop.hidden = true;
    (state.lastFocus || document.getElementById('user-profile-pill'))?.focus?.();
  }

  function onModalKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
    if (event.key !== 'Tab') return;
    const focusables = [...document.querySelectorAll('#profile-modal button:not([disabled]), #profile-modal input:not([disabled])')];
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function messageHtml() {
    const m = state.message;
    return m ? `<p class="pm-msg ${m.ok ? 'ok' : 'bad'}" role="status">${esc(m.text)}</p>` : '';
  }

  function devicesHtml(devices, currentId, { revokeAction }) {
    if (!devices?.length) return '<p class="pm-muted">Chưa có thiết bị nào.</p>';
    return `<ul class="pm-devices">${devices.map(d => {
      const current = d.id === currentId;
      return `<li class="pm-device ${current ? 'current' : ''}">
        <div><strong>${esc(deviceName(d.label))}</strong>${current ? ' <span class="pm-badge">Thiết bị này</span>' : ''}
          <div class="pm-muted">Hoạt động: ${esc(fmtTime(d.lastSeenAt))}</div></div>
        ${current ? '' : `<button type="button" class="pm-btn danger" data-pm="${revokeAction}" data-session="${esc(d.id)}" ${state.busy ? 'disabled' : ''}>Thu hồi</button>`}
      </li>`;
    }).join('')}</ul>`;
  }

  function renderModal() {
    const dialog = document.getElementById('profile-modal');
    if (!dialog) return;
    const me = state.me;
    const guest = !me || me.role === 'guest';
    const busy = state.busy ? 'disabled' : '';
    const ephemeral = me?.storage === 'ephemeral'
      ? `<div class="pm-alert" role="alert"><strong>⚠ Dữ liệu đang lưu tạm thời.</strong> Máy chủ chưa cấu hình kho lưu trữ bền vững (Upstash), nên tiến độ có thể mất khi máy chủ khởi động lại. Hãy báo quản trị viên.</div>` : '';
    const pending = state.pendingRedeem;
    const limitBlock = pending ? `
      <section class="pm-section pm-limit" aria-live="polite">
        <h3>Tài khoản đã đăng nhập trên ${esc(pending.maxDevices)} thiết bị</h3>
        <p class="pm-muted">Chọn một thiết bị cũ để thu hồi; thiết bị này sẽ đăng nhập ngay sau đó.</p>
        ${devicesHtml(pending.devices, null, { revokeAction: 'revoke-and-redeem' })}
        <button type="button" class="pm-btn ghost" data-pm="cancel-redeem">Hủy</button>
      </section>` : '';
    const codeBlock = state.newPasscode ? `
      <div class="pm-code-box">
        <div class="pm-muted">Mã đồng bộ của bạn (chỉ hiển thị 1 lần — hãy lưu lại):</div>
        <code class="pm-code" id="pm-new-code">${esc(state.newPasscode)}</code>
        <button type="button" class="pm-btn" data-pm="copy-code">Sao chép</button>
      </div>` : '';

    dialog.innerHTML = `
      <div class="pm-head">
        <h2 id="pm-title">👤 Hồ sơ học viên</h2>
        <button type="button" class="pm-close" data-pm="close" aria-label="Đóng">×</button>
      </div>
      ${ephemeral}
      ${messageHtml()}
      ${limitBlock}
      <section class="pm-section">
        <div class="pm-summary">
          <span class="pm-avatar" aria-hidden="true">${guest ? '👤' : esc(initials(me?.displayName))}</span>
          <div>
            <div class="pm-name">${esc(guest ? 'Khách (chưa có mã đồng bộ)' : me.displayName)}</div>
            <div class="pm-muted">🎯 ${esc(bandText())} · 🔥 ${currentStreak()} ngày · Vai trò: ${esc(me?.role || 'guest')}</div>
          </div>
        </div>
        ${me ? `<form class="pm-row" data-form="name">
          <label class="pm-label" for="pm-name-input">Tên hiển thị</label>
          <input id="pm-name-input" class="pm-input" maxlength="120" value="${esc(me.displayName || '')}" required>
          <button type="submit" class="pm-btn" ${busy}>Lưu tên</button>
        </form>` : '<p class="pm-muted">Không kết nối được máy chủ hồ sơ.</p>'}
      </section>

      <section class="pm-section">
        <h3>🔑 Mã đồng bộ</h3>
        ${guest
          ? '<p class="pm-muted">Tạo mã để giữ tiến độ và học tiếp trên điện thoại hoặc máy khác (tối đa 3 thiết bị).</p>'
          : `<p class="pm-muted">Tài khoản đã có mã (kết thúc bằng <strong>…${esc(me.passcodeHint || '????')}</strong>). Tạo mã mới sẽ vô hiệu hóa mã cũ.</p>`}
        ${codeBlock}
        <button type="button" class="pm-btn primary" data-pm="create-code" ${busy}>${guest ? 'Tạo mã đồng bộ' : 'Tạo mã mới'}</button>
      </section>

      ${guest ? `<section class="pm-section">
        <h3>📲 Nhập mã từ thiết bị khác</h3>
        <p class="pm-muted">Tiến độ trên thiết bị này sẽ được gộp vào tài khoản đó.</p>
        <form class="pm-row" data-form="redeem">
          <label class="pm-label" for="pm-code-input">Mã đồng bộ</label>
          <input id="pm-code-input" class="pm-input pm-code-input" placeholder="IELTS-XXXX-XXXX" autocomplete="off" spellcheck="false" maxlength="15" required>
          <button type="submit" class="pm-btn primary" ${busy}>Đồng bộ</button>
        </form>
      </section>` : ''}

      ${me ? `<section class="pm-section">
        <h3>💻 Thiết bị đang đăng nhập (${me.devices?.length || 0}/3)</h3>
        ${devicesHtml(me.devices, me.currentSessionId, { revokeAction: 'revoke' })}
      </section>` : ''}

      ${me ? `<section class="pm-section pm-footer">
        ${guest
          ? '<p class="pm-muted">Bạn đang là khách: nếu xóa dữ liệu trình duyệt mà chưa tạo mã, tiến độ sẽ không khôi phục được.</p>'
          : `<button type="button" class="pm-btn ghost" data-pm="logout" ${busy}>Đăng xuất khỏi thiết bị này</button>`}
      </section>` : ''}`;
  }

  async function withBusy(fn) {
    if (state.busy) return;
    state.busy = true;
    renderModal();
    try { await fn(); } finally { state.busy = false; renderModal(); }
  }

  const say = (text, ok = false) => { state.message = { text, ok }; };

  const ERRORS = {
    invalid_passcode: 'Mã đồng bộ không đúng hoặc đã bị thay bằng mã mới.',
    too_many_attempts: 'Nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.',
    account_not_guest: 'Thiết bị này đang đăng nhập tài khoản khác. Hãy đăng xuất trước khi nhập mã.',
    session_revoked: 'Phiên của thiết bị này đã bị thu hồi. Hãy tải lại trang.',
    origin_mismatch: 'Yêu cầu bị chặn vì không đến từ trang IELTS Master.',
    invalid_display_name: 'Tên hiển thị không hợp lệ (1–120 ký tự).'
  };
  const errorText = e => ERRORS[e?.data?.error] || e?.message || 'Có lỗi xảy ra.';

  function collectLocalData() {
    const data = {};
    LOCAL_DATA_KEYS.forEach(key => { const v = readJson(key, null); if (v != null) data[key] = v; });
    return data;
  }

  async function redeem(passcode, revokeSessionId) {
    try {
      await api('/api/auth/redeem', { method: 'POST', body: { passcode, localData: collectLocalData(), ...(revokeSessionId ? { revokeSessionId } : {}) } });
      removeKeys(MERGED_KEYS);
      state.pendingRedeem = null;
      say('Đồng bộ thành công! Đang tải lại dữ liệu của bạn...', true);
      renderModal();
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      if (e.status === 409 && e.data?.error === 'device_limit') {
        state.pendingRedeem = { passcode, devices: e.data.devices || [], maxDevices: e.data.maxDevices || 3 };
        say('Tài khoản đã đạt giới hạn thiết bị. Hãy thu hồi một thiết bị cũ bên dưới.');
      } else say(errorText(e));
    }
  }

  async function onModalClick(event) {
    const btn = event.target.closest('[data-pm]');
    if (!btn) return;
    const action = btn.dataset.pm;
    if (action === 'close') return closeModal();
    if (action === 'cancel-redeem') { state.pendingRedeem = null; state.message = null; return renderModal(); }
    if (action === 'copy-code') {
      try { await navigator.clipboard.writeText(state.newPasscode); say('Đã sao chép mã.', true); }
      catch { say('Không sao chép tự động được — hãy chép tay mã ở trên.'); }
      return renderModal();
    }
    if (action === 'create-code') return withBusy(async () => {
      try { state.newPasscode = (await api('/api/auth/passcode', { method: 'POST' })).passcode; say('Đã tạo mã đồng bộ.', true); await refresh(); }
      catch (e) { say(errorText(e)); }
    });
    if (action === 'revoke') return withBusy(async () => {
      try { await api(`/api/auth/sessions/${encodeURIComponent(btn.dataset.session)}`, { method: 'DELETE' }); say('Đã thu hồi thiết bị.', true); await refresh(); }
      catch (e) { say(errorText(e)); }
    });
    if (action === 'revoke-and-redeem' && state.pendingRedeem) return withBusy(() => redeem(state.pendingRedeem.passcode, btn.dataset.session));
    if (action === 'logout') return withBusy(async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); removeKeys(LEARNER_KEYS); location.reload(); }
      catch (e) { say(errorText(e)); }
    });
  }

  function onModalSubmit(event) {
    event.preventDefault();
    const form = event.target.closest('[data-form]');
    if (!form) return;
    if (form.dataset.form === 'name') {
      const displayName = form.querySelector('#pm-name-input').value.trim();
      withBusy(async () => {
        try { await api('/api/me', { method: 'PATCH', body: { displayName } }); say('Đã lưu tên hiển thị.', true); await refresh(); }
        catch (e) { say(errorText(e)); }
      });
    } else if (form.dataset.form === 'redeem') {
      const passcode = form.querySelector('#pm-code-input').value.trim().toUpperCase();
      if (!/^IELTS-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(passcode)) { say('Mã có dạng IELTS-XXXX-XXXX.'); renderModal(); return; }
      withBusy(() => redeem(passcode));
    }
  }

  /* ── Profile sync used by Study Hub ─────────────────────── */

  /** PATCH /api/me then notify every listener (pill, study.js). Failures are non-fatal: localStorage stays the cache. */
  async function updateProfile(patch) {
    try {
      const profile = await api('/api/me', { method: 'PATCH', body: patch });
      state.me = { ...(state.me || {}), ...profile };
    } catch { /* offline: keep local values */ }
    renderPill();
    window.dispatchEvent(new CustomEvent('ielts:profile-updated', { detail: state.me }));
    return state.me;
  }

  /* ── Learn From My Mistakes ─────────────────────────────── */

  function saveCustomUnit(record) {
    if (!record?.unitId || !record.unit) return;
    const map = readJson(CUSTOM_UNITS_KEY, {});
    const store = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    store[record.unitId] = { ...record, savedAt: new Date().toISOString() };
    const kept = Object.values(store).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))).slice(0, MAX_CUSTOM_UNITS);
    writeJson(CUSTOM_UNITS_KEY, Object.fromEntries(kept.map(r => [r.unitId, r])));
  }

  function customUnits() {
    const map = readJson(CUSTOM_UNITS_KEY, {});
    return map && typeof map === 'object' && !Array.isArray(map) ? Object.values(map).filter(r => r?.unitId && r.unit) : [];
  }

  /** Lowest-scoring criterion from a list of { abbreviation, score, feedback }. */
  function weakestCriterion(criteria) {
    const list = (Array.isArray(criteria) ? criteria : [])
      .map(c => ({ code: String(c?.abbreviation || c?.abbr || '').toUpperCase(), score: Number(c?.score), feedback: String(c?.feedback || '') }))
      .filter(c => c.code && Number.isFinite(c.score))
      .sort((a, b) => a.score - b.score);
    return list[0] || null;
  }

  /**
   * POST /api/study/generate-unit { mistakeContext } → save the unit to ielts_custom_units_v1 →
   * open study.html#unit=<id> (the Focus Classroom opens it even before a Placement Test).
   */
  async function createMistakeUnit(context, button) {
    const original = button?.innerHTML;
    if (button) { button.disabled = true; button.textContent = '⏳ Đang tạo bài học khắc phục...'; }
    try {
      const data = await api('/api/study/generate-unit', { method: 'POST', body: { mistakeContext: context } });
      if (!data?.unitId || !data.unit) throw new Error('Máy chủ không trả về bài học.');
      saveCustomUnit({ unitId: data.unitId, unit: data.unit, title: data.unit.title, source: 'mistakes', provider: data.provider || '' });
      location.href = `/study.html#unit=${encodeURIComponent(data.unitId)}`;
      return data;
    } catch (e) {
      if (button) { button.disabled = false; button.innerHTML = original; }
      throw new Error(`Không tạo được bài học: ${errorText(e)}`);
    }
  }

  /* ── Styles (self-contained, like api-keys.js) ───────────── */

  function injectStyles() {
    if (document.getElementById('auth-profile-styles')) return;
    const style = document.createElement('style');
    style.id = 'auth-profile-styles';
    style.textContent = `
      .profile-pill { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; max-width: 220px; padding: 4px 12px 4px 4px; margin-right: 8px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 0.78rem; font-weight: 600; text-align: left; line-height: 1.25; color: var(--text-primary, #f0f2f8); background: var(--bg-card, #1a2035); border: 1px solid var(--border-accent, rgba(99,102,241,.3)); transition: border-color .2s; white-space: nowrap; }
      .profile-pill:hover, .profile-pill:focus-visible { border-color: var(--accent-primary, #818cf8); outline: none; }
      .profile-pill.is-ephemeral { border-color: var(--accent-amber, #fbbf24); }
      .pp-avatar, .pm-avatar { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: 0 0 auto; border-radius: 50%; font-weight: 800; color: #fff; background: linear-gradient(135deg, var(--accent-secondary, #6366f1), var(--accent-teal, #2dd4bf)); }
      .pp-text { display: flex; flex-direction: column; min-width: 0; }
      .pp-name { overflow: hidden; text-overflow: ellipsis; }
      .pp-cta { color: var(--accent-teal, #2dd4bf); }
      .pp-meta { display: flex; gap: 8px; font-size: 0.7rem; font-weight: 500; }
      .pp-band { color: var(--accent-primary, #818cf8); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; }
      .pp-streak { color: var(--accent-orange, #fb923c); }
      .pp-warn { color: var(--accent-amber, #fbbf24); }
      .pp-streak-compact { display: none; color: var(--accent-orange, #fb923c); }
      /* The shared header already carries 5 links, Exam Shield and AI Keys: the pill collapses before anything overflows. */
      @media (min-width: 1101px) { .app-header .nav-link, .app-header .logo-text { white-space: nowrap; } }
      @media (max-width: 1480px) {
        .app-header .nav-links { gap: 2px; }
        .app-header .nav-link { padding-left: 10px; padding-right: 10px; }
        .app-header .header-right { gap: 10px; }
        .profile-pill { padding-right: 10px; }
        .profile-pill .pp-text { display: none; }
        .profile-pill .pp-streak-compact { display: inline; }
      }
      .pm-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-start; justify-content: center; padding: max(24px, env(safe-area-inset-top)) 16px 24px; overflow-y: auto; background: rgba(5, 8, 18, 0.72); backdrop-filter: blur(6px); }
      .pm-backdrop[hidden] { display: none !important; }
      .pm-dialog { width: min(560px, 100%); padding: 20px; border-radius: 18px; color: var(--text-secondary, #94a3b8); background: var(--bg-secondary, #111827); border: 1px solid var(--border-accent, rgba(99,102,241,.3)); box-shadow: 0 20px 60px rgba(0,0,0,.5); outline: none; }
      .pm-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .pm-head h2 { margin: 0; font-size: 1.15rem; color: var(--text-primary, #f0f2f8); }
      .pm-close { width: 34px; height: 34px; border-radius: 10px; cursor: pointer; font-size: 1.3rem; color: var(--text-secondary, #94a3b8); background: var(--bg-elevated, #222b45); border: 0; }
      .pm-section { padding: 14px 0; border-top: 1px solid var(--border-medium, rgba(148,163,184,.15)); }
      .pm-section h3 { margin: 0 0 8px; font-size: 0.95rem; color: var(--text-primary, #f0f2f8); }
      .pm-summary { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
      .pm-summary .pm-avatar { width: 44px; height: 44px; font-size: 1.2rem; }
      .pm-name { font-weight: 700; color: var(--text-primary, #f0f2f8); }
      .pm-muted { margin: 4px 0 10px; font-size: 0.82rem; color: var(--text-secondary, #94a3b8); }
      .pm-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .pm-label { flex: 1 1 100%; font-size: 0.78rem; }
      .pm-input { flex: 1 1 200px; min-width: 0; padding: 9px 12px; border-radius: 10px; font: inherit; color: var(--text-primary, #f0f2f8); background: var(--bg-input, #151c30); border: 1px solid rgba(148,163,184,.25); }
      .pm-input:focus { outline: none; border-color: var(--accent-primary, #818cf8); }
      .pm-code-input { text-transform: uppercase; letter-spacing: 0.08em; font-variant-numeric: tabular-nums; }
      .pm-btn { padding: 8px 14px; border-radius: 10px; cursor: pointer; font: inherit; font-size: 0.85rem; font-weight: 600; color: var(--text-primary, #f0f2f8); background: var(--bg-elevated, #222b45); border: 1px solid rgba(129,140,248,.5); }
      .pm-btn.primary { background: var(--accent-secondary, #6366f1); border-color: transparent; }
      .pm-btn.danger { border-color: var(--accent-red, #f87171); color: var(--accent-red, #f87171); }
      .pm-btn.ghost { background: none; }
      .pm-btn[disabled] { opacity: .55; cursor: wait; }
      .pm-btn:focus-visible, .pm-close:focus-visible { outline: 2px solid var(--accent-teal, #2dd4bf); outline-offset: 2px; }
      .pm-code-box { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 4px 0 12px; padding: 12px; border-radius: 12px; background: rgba(45,212,191,.08); border: 1px dashed var(--accent-teal, #2dd4bf); }
      .pm-code-box .pm-muted { flex: 1 1 100%; margin: 0; }
      .pm-code { font-size: 1.3rem; font-weight: 800; letter-spacing: 0.1em; color: var(--accent-teal, #2dd4bf); user-select: all; }
      .pm-devices { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .pm-device { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--bg-elevated, #222b45); }
      .pm-device strong { color: var(--text-primary, #f0f2f8); font-size: 0.88rem; }
      .pm-device.current { border: 1px solid var(--accent-green, #34d399); }
      .pm-device .pm-muted { margin: 2px 0 0; }
      .pm-badge { padding: 1px 8px; border-radius: 999px; font-size: 0.7rem; color: var(--accent-green, #34d399); border: 1px solid var(--accent-green, #34d399); }
      .pm-alert { margin-bottom: 12px; padding: 10px 12px; border-radius: 12px; font-size: 0.85rem; line-height: 1.5; color: var(--text-primary, #f0f2f8); background: rgba(251,191,36,.12); border: 1px solid var(--accent-amber, #fbbf24); }
      .pm-msg { margin: 0 0 10px; padding: 8px 12px; border-radius: 10px; font-size: 0.85rem; }
      .pm-msg.ok { color: var(--accent-green, #34d399); background: rgba(52,211,153,.1); }
      .pm-msg.bad { color: var(--accent-red, #f87171); background: rgba(248,113,113,.1); }
      .pm-limit { border-top-color: var(--accent-amber, #fbbf24); }
      .pm-footer { display: flex; justify-content: flex-end; }
    `;
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    mountPill();
    refresh();
    loadInputBand();
    window.addEventListener('ielts:profile-updated', renderPill);
    window.addEventListener('storage', e => { if (!e.key || e.key === 'ielts_study_streak' || e.key === 'ielts_study_goal') renderPill(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { ready, refresh, updateProfile, createMistakeUnit, weakestCriterion, saveCustomUnit, customUnits, renderPill, CUSTOM_UNITS_KEY };
})();

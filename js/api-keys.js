/**
 * IELTS Master — Universal Multi-Provider AI Key Pool & Auto-Rotation UI Manager
 *
 * Supports keys from:
 *  - Google Gemini (AIzaSy... or gemini:...)
 *  - ChatGPT / OpenAI (sk-proj-... or openai:sk-...)
 *  - DeepSeek (deepseek:sk-... or sk-<32 hex>)
 *  - OpenRouter Free Models (sk-or-v1-... or openrouter:...)
 *  - Groq Free Cloud (gsk_... or groq:...)
 *  - GitHub Models Free (ghp_... / github_pat_... or github:...)
 *  - Tier 3 Pollinations.ai Zero-Key Free Fallback (Always-on backup)
 *
 * Security:
 *  - Input is masked while typing (-webkit-text-security: disc)
 *  - Immediately wiped from input box upon saving
 *  - Displayed strictly masked (••••••••••••••••abcd) after saving
 */
const ApiKeyManager = (() => {
  const STORAGE_KEY = 'ielts_ai_key_vault';
  const LEGACY_KEY = 'ielts_gemini_api_keys';
  let _serverKeyStatus = { totalKeys: 0, keys: [] };
  let _revealInput = false;

  function _encodeVault(arr) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(arr))));
    } catch {
      return '';
    }
  }

  function _decodeVault(str) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(str))));
    } catch {
      return [];
    }
  }

  function getLocalKeys() {
    try {
      // Migrate legacy plain array if present
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        localStorage.removeItem(LEGACY_KEY);
        const parsedLegacy = JSON.parse(legacy);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length) {
          saveLocalKeys(parsedLegacy);
        }
      }
      const encoded = localStorage.getItem(STORAGE_KEY);
      if (!encoded) return [];
      const raw = _decodeVault(encoded);
      return Array.isArray(raw) ? raw.filter(k => typeof k === 'string' && k.trim()) : [];
    } catch {
      return [];
    }
  }

  function saveLocalKeys(keys) {
    const clean = [...new Set(keys.map(k => k.trim()).filter(Boolean))];
    try {
      localStorage.removeItem(LEGACY_KEY);
      if (clean.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, _encodeVault(clean));
      }
    } catch {}
    return clean;
  }

  function parseKeyInput(text, selectedProvider = 'auto') {
    const rawList = String(text || '')
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean);

    return rawList.map(k => {
      if (/^(gemini|openai|chatgpt|deepseek|ds|groq|openrouter|github|custom):/i.test(k)) {
        return k;
      }
      if (selectedProvider && selectedProvider !== 'auto') {
        return `${selectedProvider}:${k}`;
      }
      return k;
    });
  }

  function detectProviderLabel(rawEntry) {
    const s = String(rawEntry || '').trim();
    const lower = s.toLowerCase();
    if (lower.startsWith('deepseek:') || lower.startsWith('ds:') || /^sk-[a-f0-9]{32}$/i.test(s)) {
      return 'DeepSeek (deepseek-chat)';
    }
    if (lower.startsWith('openai:') || lower.startsWith('chatgpt:') || /^sk-(proj-|svcacct-)/i.test(s)) {
      return 'ChatGPT / OpenAI (gpt-4o-mini)';
    }
    if (lower.startsWith('openrouter:') || /^sk-or-v1-/i.test(s)) {
      return 'OpenRouter (Free Models)';
    }
    if (lower.startsWith('groq:') || /^gsk_/i.test(s)) {
      return 'Groq Free Cloud (Llama 3.3)';
    }
    if (lower.startsWith('github:') || /^(ghp_|github_pat_|gho_|ghs_)/i.test(s)) {
      return 'GitHub Models (gpt-4o-mini)';
    }
    if (lower.startsWith('gemini:') || /^AIza/i.test(s)) {
      return 'Google Gemini';
    }
    if (/^sk-/i.test(s)) {
      return 'ChatGPT / DeepSeek (sk-•••)';
    }
    return 'Google Gemini';
  }

  function maskKey(rawEntry) {
    const clean = String(rawEntry || '').trim().replace(/^(gemini|openai|chatgpt|deepseek|ds|groq|openrouter|github):/i, '');
    if (clean.length <= 6) return '••••••••••••••••';
    return `••••••••••••••••${clean.slice(-4)}`;
  }

  // Intercept window.fetch to automatically attach X-Gemini-Api-Key header on all AI endpoints
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    if (
      url.includes('/api/writing/score') ||
      url.includes('/api/speaking/score') ||
      url.includes('/api/analytics/') ||
      url.includes('/api/study/generate-unit') ||
      url.includes('/api/study/evaluate-mini') ||
      url.includes('/api/study/tutor-feedback') ||
      url.includes('/api/study/checkpoint-evaluate')
    ) {
      const localKeys = getLocalKeys();
      if (localKeys.length > 0) {
        const headers = new Headers(init.headers || {});
        if (!headers.has('X-Gemini-Api-Key')) {
          headers.set('X-Gemini-Api-Key', localKeys.join(','));
        }
        init = { ...init, headers };
      }
    }
    return _origFetch(input, init);
  };

  async function refreshServerStatus() {
    try {
      const res = await _origFetch('/api/settings/keys');
      if (res.ok) {
        _serverKeyStatus = await res.json();
      }
    } catch {}
    _updateHeaderButton();
    _renderKeyListInModal();
  }

  function _injectStyles() {
    if (document.getElementById('apikey-manager-styles')) return;
    const style = document.createElement('style');
    style.id = 'apikey-manager-styles';
    style.textContent = `
      .btn-apikey-header {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(99, 102, 241, 0.4);
        background: rgba(99, 102, 241, 0.14);
        color: #e2e8f0;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-right: 10px;
      }
      .btn-apikey-header:hover {
        background: rgba(99, 102, 241, 0.28);
        border-color: #818cf8;
      }
      .btn-apikey-header .key-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #34d399;
        box-shadow: 0 0 8px #34d399;
      }
      .apikey-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(10, 14, 26, 0.78);
        backdrop-filter: blur(8px);
        z-index: 9998;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .apikey-modal-backdrop[hidden] {
        display: none !important;
      }
      .apikey-modal {
        width: 100%;
        max-width: 600px;
        background: #141b2d;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 16px;
        padding: 24px;
        color: #f8fafc;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
      }
      .apikey-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 10px;
      }
      .apikey-modal-title {
        font-size: 18px;
        font-weight: 700;
        margin: 0;
      }
      .apikey-modal-close {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 20px;
        cursor: pointer;
      }
      .apikey-modal-desc {
        font-size: 12.8px;
        color: #94a3b8;
        line-height: 1.5;
        margin-bottom: 12px;
      }
      .tier-architecture-box {
        display: grid;
        gap: 6px;
        margin-bottom: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.75);
        border: 1px solid rgba(99, 102, 241, 0.25);
        font-size: 12px;
      }
      .tier-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .tier-name {
        color: #e2e8f0;
        font-weight: 600;
      }
      .tier-status {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(52, 211, 153, 0.14);
        color: #34d399;
        font-weight: 600;
      }
      .tier-status.standby {
        background: rgba(148, 163, 184, 0.16);
        color: #cbd5e1;
      }
      .apikey-provider-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .apikey-provider-label {
        font-size: 12.5px;
        color: #cbd5e1;
        font-weight: 600;
      }
      .apikey-provider-select {
        flex: 1;
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 8px;
        padding: 7px 10px;
        font-size: 12.5px;
      }
      .btn-toggle-mask {
        background: rgba(148, 163, 184, 0.14);
        border: 1px solid rgba(148, 163, 184, 0.28);
        color: #cbd5e1;
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      .apikey-textarea {
        width: 100%;
        min-height: 82px;
        background: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 10px;
        padding: 10px 12px;
        color: #f8fafc;
        font-family: monospace;
        font-size: 13px;
        resize: vertical;
        box-sizing: border-box;
      }
      .apikey-textarea.masked-input {
        -webkit-text-security: disc;
        text-security: disc;
      }
      .apikey-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-top: 12px;
      }
      .btn-apikey-save {
        padding: 9px 18px;
        border-radius: 9px;
        border: none;
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: #fff;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
      }
      .btn-apikey-clear {
        padding: 8px 12px;
        border-radius: 9px;
        border: 1px solid rgba(239, 68, 68, 0.4);
        background: rgba(239, 68, 68, 0.12);
        color: #fca5a5;
        font-weight: 600;
        font-size: 12.5px;
        cursor: pointer;
      }
      .apikey-list {
        margin-top: 14px;
        border-top: 1px solid rgba(148, 163, 184, 0.15);
        padding-top: 12px;
        display: grid;
        gap: 8px;
        max-height: 165px;
        overflow-y: auto;
      }
      .apikey-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 8px;
        font-size: 12.5px;
      }
      .apikey-item-code {
        font-family: monospace;
        color: #e2e8f0;
      }
      .apikey-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 999px;
      }
      .apikey-badge.ready {
        background: rgba(52, 211, 153, 0.16);
        color: #34d399;
      }
      .apikey-badge.cooldown {
        background: rgba(245, 158, 11, 0.18);
        color: #fbbf24;
      }
    `;
    document.head.appendChild(style);
  }

  function _updateHeaderButton() {
    const btn = document.getElementById('btn-open-apikey-modal');
    if (!btn) return;
    const localCount = getLocalKeys().length;
    const total = Math.max(localCount, _serverKeyStatus.totalKeys || 0);
    btn.classList.toggle('has-keys', true);
    const label = btn.querySelector('.key-label');
    if (label) {
      label.textContent = total > 0 ? `AI Keys (${total} Hidden)` : 'AI Tiers & Keys';
    }
  }

  function _renderKeyListInModal() {
    const listEl = document.getElementById('apikey-pool-list');
    const tierBoxEl = document.getElementById('apikey-tier-summary');
    if (!listEl) return;

    const serverKeys = Array.isArray(_serverKeyStatus.keys) ? _serverKeyStatus.keys : [];
    const localKeys = getLocalKeys();
    const items = serverKeys.length
      ? serverKeys
      : localKeys.map((k) => ({
          masked: maskKey(k),
          tier: detectProviderLabel(k),
          status: 'ready',
          source: 'encrypted'
        }));

    if (tierBoxEl) {
      tierBoxEl.innerHTML = `
        <div class="tier-row">
          <span class="tier-name">🥇 Multi-Provider Pool (Gemini · ChatGPT · DeepSeek · Groq · OpenRouter)</span>
          <span class="tier-status ${items.length ? '' : 'standby'}">${items.length ? `${items.length} key(s) hidden & active` : 'Standby'}</span>
        </div>
        <div class="tier-row">
          <span class="tier-name">🥈 Auto-Failover & Rate-Limit Rotation</span>
          <span class="tier-status">Switches key immediately on HTTP 429</span>
        </div>
        <div class="tier-row">
          <span class="tier-name">🥉 Tier 3: Pollinations.ai (Zero-Key Free AI)</span>
          <span class="tier-status">🟢 Always Active (24/7 Backup)</span>
        </div>
      `;
    }

    if (!items.length) {
      listEl.innerHTML = '<div style="color:#94a3b8;font-size:12.5px;text-align:center;padding:6px 0;">Currently using <strong>Zero-Key Free AI (Pollinations)</strong>. Add keys from <strong>Gemini, ChatGPT, DeepSeek, Groq, OpenRouter, or GitHub</strong> above — keys are automatically hidden after saving.</div>';
      return;
    }

    listEl.innerHTML = items.map((item, i) => `
      <div class="apikey-item">
        <span class="apikey-item-code">🔒 Key #${i + 1} · ${item.masked} <small style="color:#818cf8">[${item.tier || 'AI Provider'}]</small></span>
        <span class="apikey-badge ${item.status === 'cooldown' ? 'cooldown' : 'ready'}">
          ${item.status === 'cooldown' ? '⏳ Cooldown (Rate-Limited)' : '🟢 Ready'}
        </span>
      </div>
    `).join('');
  }

  async function saveKeysFromModal() {
    const inputEl = document.getElementById('apikey-input-textarea');
    const providerSelect = document.getElementById('apikey-provider-select');
    const statusEl = document.getElementById('apikey-save-status');
    if (!inputEl) return;

    const selectedProvider = providerSelect ? providerSelect.value : 'auto';
    const parsed = parseKeyInput(inputEl.value, selectedProvider);
    if (!parsed.length) {
      if (statusEl) statusEl.textContent = 'Vui lòng dán ít nhất 1 API key (Gemini, ChatGPT, DeepSeek, Groq, OpenRouter...).';
      return;
    }

    // Immediately clear input field & re-enable masking so the key is never left visible on screen
    inputEl.value = '';
    _revealInput = false;
    inputEl.classList.add('masked-input');
    const toggleBtn = document.getElementById('btn-toggle-key-mask');
    if (toggleBtn) toggleBtn.textContent = '👁️ Hiện khi gõ';

    const mergedLocal = saveLocalKeys([...getLocalKeys(), ...parsed]);
    try {
      const res = await _origFetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: mergedLocal })
      });
      if (res.ok) {
        _serverKeyStatus = await res.json();
      }
    } catch {}

    if (statusEl) {
      statusEl.textContent = `🔒 Đã nạp và ẩn bảo mật ${Math.max(mergedLocal.length, _serverKeyStatus.totalKeys || 0)} key! Tự động xoay vòng khi chạm Rate Limit.`;
    }
    _updateHeaderButton();
    _renderKeyListInModal();
  }

  async function clearAllKeys() {
    saveLocalKeys([]);
    try {
      const res = await _origFetch('/api/settings/keys', { method: 'DELETE' });
      if (res.ok) {
        _serverKeyStatus = await res.json();
      }
    } catch {}
    const statusEl = document.getElementById('apikey-save-status');
    if (statusEl) statusEl.textContent = 'Đã xóa toàn bộ key tùy chỉnh. Hệ thống chuyển về dùng Free AI mặc định.';
    _updateHeaderButton();
    _renderKeyListInModal();
  }

  function openModal() {
    const modal = document.getElementById('apikey-modal-backdrop');
    if (!modal) return;
    modal.hidden = false;
    const inputEl = document.getElementById('apikey-input-textarea');
    if (inputEl) {
      inputEl.value = '';
      _revealInput = false;
      inputEl.classList.add('masked-input');
    }
    refreshServerStatus();
  }

  function closeModal() {
    const modal = document.getElementById('apikey-modal-backdrop');
    if (modal) modal.hidden = true;
    const inputEl = document.getElementById('apikey-input-textarea');
    if (inputEl) inputEl.value = '';
  }

  function _mountUi() {
    _injectStyles();

    const header = document.getElementById('app-header') || document.querySelector('.app-header');
    if (header && !document.getElementById('btn-open-apikey-modal')) {
      let rightContainer = header.querySelector('.header-right');
      if (!rightContainer) {
        rightContainer = document.createElement('div');
        rightContainer.className = 'header-right';
        header.appendChild(rightContainer);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btn-open-apikey-modal';
      btn.className = 'btn-apikey-header';
      btn.title = 'Manage Multi-Provider AI Keys (Gemini, ChatGPT, DeepSeek, Groq, OpenRouter, GitHub)';
      btn.innerHTML = `<span class="key-dot"></span><span>🔑</span><span class="key-label">AI Tiers & Keys</span>`;
      btn.addEventListener('click', openModal);
      rightContainer.prepend(btn);
    }

    if (!document.getElementById('apikey-modal-backdrop')) {
      const backdrop = document.createElement('div');
      backdrop.id = 'apikey-modal-backdrop';
      backdrop.className = 'apikey-modal-backdrop';
      backdrop.hidden = true;
      backdrop.innerHTML = `
        <div class="apikey-modal" role="dialog" aria-modal="true" aria-labelledby="apikey-modal-title">
          <div class="apikey-modal-header">
            <h3 class="apikey-modal-title" id="apikey-modal-title">🔑 Nạp Key Đa Nguồn (Gemini · ChatGPT · DeepSeek · Free AI)</h3>
            <button type="button" class="apikey-modal-close" id="btn-close-apikey-modal" aria-label="Close">✕</button>
          </div>
          <p class="apikey-modal-desc">
            Hỗ trợ nạp cùng lúc nhiều API Key từ <strong>Google Gemini</strong>, <strong>ChatGPT / OpenAI</strong>, <strong>DeepSeek</strong>, <strong>Groq</strong>, <strong>OpenRouter</strong> hoặc <strong>GitHub Models</strong>.
            Key được <strong>ẩn bảo mật tự động</strong> ngay khi gõ và sau khi lưu.
          </p>
          <div class="tier-architecture-box" id="apikey-tier-summary"></div>
          <div class="apikey-provider-row">
            <label class="apikey-provider-label" for="apikey-provider-select">Nguồn Key:</label>
            <select id="apikey-provider-select" class="apikey-provider-select">
              <option value="auto">✨ Tự động nhận diện (Gemini / ChatGPT / DeepSeek / Groq / OpenRouter)</option>
              <option value="gemini">Google Gemini (AIzaSy...)</option>
              <option value="openai">ChatGPT / OpenAI (sk-... -> gpt-4o-mini)</option>
              <option value="deepseek">DeepSeek (sk-... -> deepseek-chat)</option>
              <option value="openrouter">OpenRouter Free Models (sk-or-v1-...)</option>
              <option value="groq">Groq Free Cloud (gsk_... -> llama-3.3-70b)</option>
              <option value="github">GitHub Models Free (ghp_... -> gpt-4o-mini)</option>
            </select>
            <button type="button" class="btn-toggle-mask" id="btn-toggle-key-mask">👁️ Hiện khi gõ</button>
          </div>
          <textarea
            id="apikey-input-textarea"
            class="apikey-textarea masked-input"
            autocomplete="off"
            spellcheck="false"
            placeholder="Dán 1 hoặc nhiều key (mỗi dòng 1 key) — Key sẽ tự động được che ẩn..."
          ></textarea>
          <div id="apikey-save-status" style="font-size:12px;color:#34d399;min-height:18px;margin-top:6px;"></div>
          <div class="apikey-actions">
            <button type="button" class="btn-apikey-clear" id="btn-clear-apikeys">Xóa tất cả Key</button>
            <button type="button" class="btn-apikey-save" id="btn-save-apikeys">🔒 Nạp & Ẩn Key</button>
          </div>
          <div class="apikey-list" id="apikey-pool-list"></div>
        </div>
      `;
      document.body.appendChild(backdrop);

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
      document.getElementById('btn-close-apikey-modal')?.addEventListener('click', closeModal);
      document.getElementById('btn-save-apikeys')?.addEventListener('click', saveKeysFromModal);
      document.getElementById('btn-clear-apikeys')?.addEventListener('click', clearAllKeys);
      document.getElementById('btn-toggle-key-mask')?.addEventListener('click', () => {
        const inputEl = document.getElementById('apikey-input-textarea');
        const toggleBtn = document.getElementById('btn-toggle-key-mask');
        if (!inputEl || !toggleBtn) return;
        _revealInput = !_revealInput;
        inputEl.classList.toggle('masked-input', !_revealInput);
        toggleBtn.textContent = _revealInput ? '🙈 Ẩn khi gõ' : '👁️ Hiện khi gõ';
      });
    }

    refreshServerStatus();
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _mountUi);
    } else {
      _mountUi();
    }
  }

  return { init, openModal, closeModal, refreshServerStatus, getLocalKeys };
})();

ApiKeyManager.init();

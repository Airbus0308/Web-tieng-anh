/**
 * IELTS Master — Gemini API Key Pool & Auto-Rotation UI Manager
 *
 * Injects a "🔑 API Keys" button & modal into the app header on every page,
 * allowing users to add multiple Gemini API keys (one per line or comma-separated)
 * that automatically rotate whenever a key hits a 429 rate limit.
 */
const ApiKeyManager = (() => {
  const STORAGE_KEY = 'ielts_gemini_api_keys';
  let _serverKeyStatus = { totalKeys: 0, keys: [] };

  function getLocalKeys() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(k => typeof k === 'string' && k.trim()) : [];
    } catch {
      return [];
    }
  }

  function saveLocalKeys(keys) {
    const clean = [...new Set(keys.map(k => k.trim()).filter(Boolean))];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {}
    return clean;
  }

  function parseKeyInput(text) {
    return String(text || '')
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function maskKey(key) {
    const k = String(key || '').trim();
    if (k.length <= 10) return '••••' + k.slice(-3);
    return `${k.slice(0, 6)}••••••••${k.slice(-4)}`;
  }

  // Intercept window.fetch to automatically attach X-Gemini-Api-Key header on AI endpoints
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    if (url.includes('/api/writing/score') || url.includes('/api/speaking/score') || url.includes('/api/analytics/')) {
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
        background: #f59e0b;
      }
      .btn-apikey-header.has-keys .key-dot {
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
        max-width: 540px;
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
        margin-bottom: 12px;
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
        font-size: 13px;
        color: #94a3b8;
        line-height: 1.5;
        margin-bottom: 16px;
      }
      .apikey-textarea {
        width: 100%;
        min-height: 92px;
        background: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 10px;
        padding: 10px 12px;
        color: #f8fafc;
        font-family: monospace;
        font-size: 13px;
        resize: vertical;
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
        margin-top: 18px;
        border-top: 1px solid rgba(148, 163, 184, 0.15);
        padding-top: 14px;
        display: grid;
        gap: 8px;
        max-height: 180px;
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
    btn.classList.toggle('has-keys', total > 0);
    const label = btn.querySelector('.key-label');
    if (label) {
      label.textContent = total > 0 ? `API Keys (${total})` : 'Add API Key';
    }
  }

  function _renderKeyListInModal() {
    const listEl = document.getElementById('apikey-pool-list');
    if (!listEl) return;

    const serverKeys = Array.isArray(_serverKeyStatus.keys) ? _serverKeyStatus.keys : [];
    const localKeys = getLocalKeys();

    if (!serverKeys.length && !localKeys.length) {
      listEl.innerHTML = '<div style="color:#64748b;font-size:12.5px;text-align:center;padding:8px 0;">No Gemini API keys configured yet. Paste one or more keys above.</div>';
      return;
    }

    const items = serverKeys.length
      ? serverKeys
      : localKeys.map((k, idx) => ({ masked: maskKey(k), status: 'ready', source: 'browser', index: idx }));

    listEl.innerHTML = items.map((item, i) => `
      <div class="apikey-item">
        <span class="apikey-item-code">#${i + 1} · ${item.masked} <small style="color:#64748b">(${item.source || 'pool'})</small></span>
        <span class="apikey-badge ${item.status === 'cooldown' ? 'cooldown' : 'ready'}">
          ${item.status === 'cooldown' ? '⏳ Rate-Limited (Cooldown)' : '🟢 Ready'}
        </span>
      </div>
    `).join('');
  }

  async function saveKeysFromModal() {
    const inputEl = document.getElementById('apikey-input-textarea');
    const statusEl = document.getElementById('apikey-save-status');
    if (!inputEl) return;

    const parsed = parseKeyInput(inputEl.value);
    if (!parsed.length) {
      if (statusEl) statusEl.textContent = 'Please paste at least one Gemini API key.';
      return;
    }

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

    inputEl.value = '';
    if (statusEl) {
      statusEl.textContent = `Saved! ${ Math.max(mergedLocal.length, _serverKeyStatus.totalKeys || 0) } key(s) active with auto-rotation.`;
    }
    _updateHeaderButton();
    _renderKeyListInModal();
  }

  async function clearAllKeys() {
    saveLocalKeys([]);
    try {
      const res = await _origFetch('/api/settings/keys', { method: 'DELETE' });
      if (res.ok) _serverKeyStatus = await res.json();
    } catch {}
    const statusEl = document.getElementById('apikey-save-status');
    if (statusEl) statusEl.textContent = 'Cleared all runtime API keys.';
    _updateHeaderButton();
    _renderKeyListInModal();
  }

  function openModal() {
    const backdrop = document.getElementById('apikey-modal-backdrop');
    if (backdrop) {
      backdrop.hidden = false;
      refreshServerStatus();
    }
  }

  function closeModal() {
    const backdrop = document.getElementById('apikey-modal-backdrop');
    if (backdrop) backdrop.hidden = true;
  }

  function init() {
    _injectStyles();
    const headerRight = document.querySelector('.header-right') || document.querySelector('.app-header');
    if (headerRight && !document.getElementById('btn-open-apikey-modal')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btn-open-apikey-modal';
      btn.className = 'btn-apikey-header';
      btn.title = 'Manage Gemini API Keys & Automatic Rate-Limit Rotation';
      btn.innerHTML = '<span class="key-dot"></span><span>🔑</span><span class="key-label">API Keys</span>';
      btn.addEventListener('click', openModal);
      headerRight.prepend(btn);
    }

    if (!document.getElementById('apikey-modal-backdrop')) {
      const modalWrap = document.createElement('div');
      modalWrap.id = 'apikey-modal-backdrop';
      modalWrap.className = 'apikey-modal-backdrop';
      modalWrap.hidden = true;
      modalWrap.innerHTML = `
        <div class="apikey-modal" role="dialog" aria-modal="true" aria-labelledby="apikey-modal-title">
          <div class="apikey-modal-header">
            <h2 class="apikey-modal-title" id="apikey-modal-title">🔑 Gemini API Key Pool & Auto-Rotation</h2>
            <button type="button" class="apikey-modal-close" id="btn-close-apikey-modal" aria-label="Close">&times;</button>
          </div>
          <p class="apikey-modal-desc">
            Add one or multiple Gemini API keys (one per line or comma-separated). If a key hits the 429 rate limit or quota limit, the system <strong>automatically rotates to the next available key</strong> without interrupting your test.
          </p>
          <textarea id="apikey-input-textarea" class="apikey-textarea" placeholder="AIzaSyA1...&#10;AIzaSyB2...&#10;(Paste one or multiple Gemini API keys here)"></textarea>
          <div id="apikey-save-status" style="font-size:12px;color:#34d399;margin-top:6px;min-height:16px;"></div>
          <div class="apikey-actions">
            <button type="button" class="btn-apikey-clear" id="btn-clear-apikeys">Clear Runtime Keys</button>
            <button type="button" class="btn-apikey-save" id="btn-save-apikeys">Add to Key Pool</button>
          </div>
          <div class="apikey-list" id="apikey-pool-list"></div>
        </div>
      `;
      document.body.appendChild(modalWrap);

      document.getElementById('btn-close-apikey-modal').addEventListener('click', closeModal);
      document.getElementById('btn-save-apikeys').addEventListener('click', saveKeysFromModal);
      document.getElementById('btn-clear-apikeys').addEventListener('click', clearAllKeys);
      modalWrap.addEventListener('click', e => {
        if (e.target === modalWrap) closeModal();
      });
    }

    // Sync any browser-saved keys to the server on startup
    const localKeys = getLocalKeys();
    if (localKeys.length > 0) {
      _origFetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: localKeys })
      }).then(() => refreshServerStatus()).catch(() => _updateHeaderButton());
    } else {
      refreshServerStatus();
    }
  }

  return { init, openModal, closeModal, getLocalKeys };
})();

document.addEventListener('DOMContentLoaded', ApiKeyManager.init);

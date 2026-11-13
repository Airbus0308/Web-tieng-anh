/**
 * IELTS Master — 3-Tier Multi-Provider AI & Key Pool Manager
 *
 * Tier 1: Google Gemini API Key Pool (Auto-Rotation on 429 rate limits)
 * Tier 2: GitHub Models (Official Azure AI Inference gpt-4o-mini via GitHub PAT)
 * Tier 3: Pollinations.ai Zero-Key Free AI Fallback (Always-on backup)
 */
const ApiKeyManager = (() => {
  const STORAGE_KEY = 'ielts_gemini_api_keys';
  let _serverKeyStatus = { totalKeys: 0, keys: [], tiers: { tier1GeminiCount: 0, tier2GitHubCount: 0, tier3PollinationsFree: true } };

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

  function isGitHubToken(key) {
    return /^(ghp_|github_pat_|gho_|ghs_)/i.test(String(key || '').trim());
  }

  function maskKey(key) {
    const k = String(key || '').trim();
    if (k.length <= 10) return '••••' + k.slice(-3);
    return `${k.slice(0, 6)}••••••••${k.slice(-4)}`;
  }

  // Intercept window.fetch to automatically attach X-Gemini-Api-Key / X-GitHub-Token headers on AI endpoints
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    if (url.includes('/api/writing/score') || url.includes('/api/speaking/score') || url.includes('/api/analytics/') || url.includes('/api/study/generate-unit') || url.includes('/api/study/evaluate-mini')) {
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
        max-width: 580px;
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
        margin-bottom: 14px;
      }
      .tier-architecture-box {
        display: grid;
        gap: 6px;
        margin-bottom: 14px;
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
      .apikey-textarea {
        width: 100%;
        min-height: 86px;
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
        margin-top: 16px;
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
      label.textContent = total > 0 ? `API Keys (${total} + Free Tier)` : 'AI Tiers & Keys';
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
          tier: isGitHubToken(k) ? 'Tier 2 · GitHub Models' : 'Tier 1 · Gemini',
          status: 'ready',
          source: 'browser'
        }));

    const tier1Count = items.filter(i => (i.tier || '').startsWith('Tier 1')).length;
    const tier2Count = items.filter(i => (i.tier || '').startsWith('Tier 2')).length;

    if (tierBoxEl) {
      tierBoxEl.innerHTML = `
        <div class="tier-row">
          <span class="tier-name">🥇 Tier 1: Google Gemini Key Pool (Auto-Rotate)</span>
          <span class="tier-status ${tier1Count ? '' : 'standby'}">${tier1Count ? `${tier1Count} key(s) active` : 'Standby (Add AIza... key)'}</span>
        </div>
        <div class="tier-row">
          <span class="tier-name">🥈 Tier 2: GitHub Models (Azure gpt-4o-mini)</span>
          <span class="tier-status ${tier2Count ? '' : 'standby'}">${tier2Count ? `${tier2Count} token(s) active` : 'Standby (Add ghp_... token)'}</span>
        </div>
        <div class="tier-row">
          <span class="tier-name">🥉 Tier 3: Pollinations.ai (Zero-Key Free AI)</span>
          <span class="tier-status">🟢 Always Active (Auto-Fallback)</span>
        </div>
      `;
    }

    if (!items.length) {
      listEl.innerHTML = '<div style="color:#94a3b8;font-size:12.5px;text-align:center;padding:6px 0;">Currently running on <strong>Tier 3 (Pollinations Zero-Key Free AI)</strong>. Paste Gemini keys (<code>AIza...</code>) or GitHub PATs (<code>ghp_...</code>) above to prioritize Tier 1 & Tier 2.</div>';
      return;
    }

    listEl.innerHTML = items.map((item, i) => `
      <div class="apikey-item">
        <span class="apikey-item-code">#${i + 1} · ${item.masked} <small style="color:#818cf8">[${item.tier || 'Tier 1 · Gemini'}]</small></span>
        <span class="apikey-badge ${item.status === 'cooldown' ? 'cooldown' : 'ready'}">
          ${item.status === 'cooldown' ? '⏳ Cooldown (Rate-Limited)' : '🟢 Ready'}
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
      if (statusEl) statusEl.textContent = 'Please paste at least one Gemini API key or GitHub token.';
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
      statusEl.textContent = `Saved! ${Math.max(mergedLocal.length, _serverKeyStatus.totalKeys || 0)} key(s) synced across Tier 1 & Tier 2 (with Tier 3 Zero-Key fallback).`;
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
    if (statusEl) statusEl.textContent = 'Cleared custom keys. System will use .env keys or Tier 3 Zero-Key Free AI.';
    _updateHeaderButton();
    _renderKeyListInModal();
  }

  function openModal() {
    const modal = document.getElementById('apikey-modal-backdrop');
    if (!modal) return;
    modal.hidden = false;
    refreshServerStatus();
  }

  function closeModal() {
    const modal = document.getElementById('apikey-modal-backdrop');
    if (modal) modal.hidden = true;
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
      btn.title = 'Manage 3-Tier AI Providers & Gemini API Key Rotation Pool';
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
            <h3 class="apikey-modal-title" id="apikey-modal-title">🔑 3-Tier AI Architecture & Key Pool</h3>
            <button type="button" class="apikey-modal-close" id="btn-close-apikey-modal" aria-label="Close">✕</button>
          </div>
          <p class="apikey-modal-desc">
            Add multiple <strong>Gemini API keys</strong> (<code>AIzaSy...</code>) or <strong>GitHub Personal Access Tokens</strong> (<code>ghp_...</code>), one per line.
            If a key hits a rate limit (HTTP 429), the server automatically rotates to the next key and falls back across all 3 tiers:
          </p>
          <div class="tier-architecture-box" id="apikey-tier-summary"></div>
          <textarea
            id="apikey-input-textarea"
            class="apikey-textarea"
            placeholder="AIzaSyYourFirstGeminiKey...\nAIzaSyYourSecondGeminiKey...\nghp_YourOptionalGitHubModelsToken..."
          ></textarea>
          <div id="apikey-save-status" style="font-size:12px;color:#34d399;min-height:18px;margin-top:6px;"></div>
          <div class="apikey-actions">
            <button type="button" class="btn-apikey-clear" id="btn-clear-apikeys">Clear Saved Keys</button>
            <button type="button" class="btn-apikey-save" id="btn-save-apikeys">Save & Sync Keys</button>
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

/** Exam interaction guards and client-side integrity telemetry. */
const ExamSecurity = (() => {
  const protectedContent = '.passage-text, .question-card, .topic-prompt-box, .part3-box, .cue-card, .prompt-card, #essay-prompt';
  const editable = 'textarea, input, [contenteditable="true"]';
  const answerFields = '#essay-input, #speaking-input';
  const state = { tabSwitches: 0, pasteAttempts: 0, keystrokes: 0, burstDetected: false };
  let firstKeystrokeAt = 0;
  let lastDepartureAt = 0;
  let warningTimer;
  const priorLengths = new WeakMap();

  function isExamPage() {
    return /(?:^|\/)(?:index|writing|speaking)\.html$/.test(location.pathname) || location.pathname === '/';
  }

  function snapshot() {
    const minutes = firstKeystrokeAt ? Math.max((Date.now() - firstKeystrokeAt) / 60000, 1 / 60) : 0;
    return {
      tabSwitches: state.tabSwitches,
      pasteAttempts: state.pasteAttempts,
      keystrokes: state.keystrokes,
      wpm: minutes ? Math.round((state.keystrokes / 5) / minutes) : 0,
      burstDetected: state.burstDetected,
      flagged: state.tabSwitches > 0 || state.pasteAttempts > 0 || state.burstDetected
    };
  }

  function updateBadge() {
    const badge = document.getElementById('exam-shield');
    if (!badge) return;
    badge.textContent = `🛡️ Exam Shield · Protected · Tab Switches: ${state.tabSwitches} · Paste Blocked: ${state.pasteAttempts}`;
    badge.classList.toggle('exam-shield-flagged', snapshot().flagged);
  }

  function warn(message) {
    let banner = document.getElementById('exam-security-warning');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'exam-security-warning';
      banner.className = 'exam-security-warning';
      banner.setAttribute('role', 'status');
      document.body.appendChild(banner);
    }
    banner.textContent = message;
    banner.hidden = false;
    clearTimeout(warningTimer);
    warningTimer = setTimeout(() => { banner.hidden = true; }, 3500);
  }

  function isEditable(target) {
    return target instanceof Element && Boolean(target.closest(editable));
  }

  function isProtected(target) {
    return target instanceof Element && Boolean(target.closest(protectedContent));
  }

  function blockPaste(event) {
    if (!(event.target instanceof Element) || !event.target.closest(answerFields)) return;
    event.preventDefault();
    state.pasteAttempts += 1;
    updateBadge();
    warn('Please type your own answer. Paste and drop are disabled during this exam.');
  }

  function onKeydown(event) {
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    const answer = event.target instanceof Element && event.target.closest(answerFields);
    if (modifier && key === 'v' && answer) {
      blockPaste(event);
      return;
    }
    if (!isEditable(event.target)) {
      const blocked = key === 'f12' || (modifier && (
        ['c', 'x', 'u', 's', 'p'].includes(key) || (event.shiftKey && ['i', 'j'].includes(key))
      ));
      if (blocked) {
        event.preventDefault();
        warn('Copying exam content and opening browser tools are disabled.');
      }
    }
    if (!answer || modifier || event.altKey || event.repeat || !event.isTrusted) return;
    if (key.length === 1 || ['backspace', 'delete', 'enter'].includes(key)) {
      state.keystrokes += 1;
      if (!firstKeystrokeAt) firstKeystrokeAt = Date.now();
    }
  }

  function onInput(event) {
    const field = event.target;
    if (!(field instanceof Element) || !field.matches(answerFields)) return;
    const previous = priorLengths.get(field) ?? 0;
    const current = field.value.length;
    const recording = document.querySelector('#btn-record.recording');
    if (current - previous > 30 && !recording) {
      state.burstDetected = true;
      updateBadge();
      warn('A sudden text change was detected and recorded in exam integrity.');
    }
    priorLengths.set(field, current);
  }

  function onDeparture() {
    if (!isExamPage()) return;
    const now = Date.now();
    if (now - lastDepartureAt < 1000) return; // blur and visibilitychange often fire together
    lastDepartureAt = now;
    state.tabSwitches += 1;
    updateBadge();
    warn('Leaving the exam window has been recorded. Please return to your answer.');
  }

  function init() {
    const header = document.querySelector('.header-right');
    if (header) {
      const badge = document.createElement('span');
      badge.id = 'exam-shield';
      badge.className = 'exam-shield';
      header.prepend(badge);
      updateBadge();
    }
    for (const type of ['copy', 'cut', 'contextmenu', 'dragstart']) {
      document.addEventListener(type, event => {
        if (isProtected(event.target) && !isEditable(event.target)) {
          event.preventDefault();
          warn('Exam questions cannot be copied or dragged.');
        }
      });
    }
    document.addEventListener('paste', blockPaste, true);
    document.addEventListener('drop', blockPaste, true);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) onDeparture(); });
    window.addEventListener('blur', onDeparture);
    document.querySelectorAll(answerFields).forEach(field => priorLengths.set(field, field.value.length));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  return { init, snapshot };
})();

/**
 * Smoke tests for the IELTS Master server.
 * Run with: npm test
 *
 * Starts server.js on a test port, then checks:
 *  - static pages and config.json are served
 *  - /api/writing/config and /api/writing/history respond
 *  - /api/placement/results and /api/placement/history sync & deduplicate
 *  - /api/analytics/roadmap and /api/analytics/study-plan validate input
 *  - /speaking.html, /api/speaking/config, /api/speaking/history and
 *    /api/speaking/score validation (empty / under 40 words)
 *  - /api/writing/score validates input (empty / under 250 words)
 *  - /api/writing/score returns a full result when GEMINI_API_KEY is set
 *    (skipped otherwise)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testResultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-master-test-'));
process.env.IELTS_RESULTS_DIR = testResultsDir;
const { default: app } = await import('../server.js');

let server;
let BASE;

before(async () => {
  // Mount the Express app in-process on a random free port
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server?.close(resolve));
  fs.rmSync(testResultsDir, { recursive: true, force: true });
});

const sampleEssay = (words) =>
  Array.from({ length: words }, (_, i) => (i % 12 === 11 ? 'technology.' : 'education')).join(' ');

test('serves all application pages and analytics skill breakdown section', async () => {
  for (const page of ['/writing.html', '/index.html', '/analytics.html', '/speaking.html']) {
    const res = await fetch(BASE + page);
    assert.equal(res.status, 200, page);
  }
  const analyticsHtml = await (await fetch(`${BASE}/analytics.html`)).text();
  assert.ok(analyticsHtml.includes('id="skill-breakdown"'), 'analytics.html should include #skill-breakdown');
  assert.ok(analyticsHtml.includes('TR, CC, LR, GRA'), 'analytics.html should mention 4 Writing criteria');
});

test('does not expose private source, environment, results or project documents', async () => {
  for (const file of [
    '/.env', '/.env.example', '/server.js', '/package.json', '/package-lock.json',
    '/CLAUDE.md', '/AGENTS.md', '/PROGRESS.md', '/results/writing_results.json',
    '/progress/phase-04-speaking-practice.md', '/tests/smoke.test.js',
    '/scripts/import-youtube-listening.js'
  ]) {
    const res = await fetch(BASE + file);
    assert.ok([403, 404].includes(res.status), `${file}: ${res.status}`);
  }
  for (const file of ['/css/writing.css', '/js/writing.js', '/config.json']) {
    assert.equal((await fetch(BASE + file)).status, 200, file);
  }
});

test('Exam Security script is public and loaded on all four pages', async () => {
  const script = await fetch(`${BASE}/js/exam-security.js`);
  assert.equal(script.status, 200);
  for (const page of ['/index.html', '/writing.html', '/speaking.html', '/analytics.html']) {
    const html = await (await fetch(BASE + page)).text();
    assert.ok(html.includes('src="js/exam-security.js"'), page);
  }
});

test('config.json contains the 4 IELTS criteria and study plan prompts', async () => {
  const res = await fetch(`${BASE}/config.json`);
  const cfg = await res.json();
  const abbrs = Object.values(cfg.scoringCriteria).map(c => c.abbreviation).sort();
  assert.deepEqual(abbrs, ['CC', 'GRA', 'LR', 'TR']);
  assert.ok(cfg.systemInstruction && cfg.responseFormat && cfg.model);
  assert.ok(cfg.analyticsRoadmapPrompt && cfg.studyPlanPrompt);
  assert.ok(cfg.responseFormat.includes('inline_corrections'));
});

test('Writing result page contains an inline correction comparison', async () => {
  const html = await (await fetch(`${BASE}/writing.html`)).text();
  const script = await (await fetch(`${BASE}/js/writing.js`)).text();
  assert.ok(html.includes('id="inline-corrections-list"'));
  assert.ok(script.includes('data.inline_corrections'));
});

test('GET /api/writing/config returns topics and criteria', async () => {
  const data = await (await fetch(`${BASE}/api/writing/config`)).json();
  assert.ok(data.sampleTopics.length > 0);
  assert.equal(data.criteria.length, 4);
});

test('GET /api/writing/history returns an array', async () => {
  const data = await (await fetch(`${BASE}/api/writing/history`)).json();
  assert.ok(Array.isArray(data));
});

test('POST /api/placement/results saves and de-duplicates a valid result', async () => {
  const result = {
    id: 'attempt_smoke_test', timestamp: '2026-01-01T00:00:00.000Z', answers: { r1: 0 },
    score: { correct: 1, total: 2, percentage: 50 }, estimatedBand: '5.0',
    sectionBreakdown: { reading: { percentage: 50 }, listening: { percentage: 50 } },
    weakAreas: [{ questionId: 'r2', section: 'reading', difficulty: 'B1' }]
  };
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  assert.equal((await fetch(`${BASE}/api/placement/results`, options)).status, 201);
  assert.equal((await fetch(`${BASE}/api/placement/results`, options)).status, 200);

  const history = await (await fetch(`${BASE}/api/placement/history`)).json();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, result.id);
});

test('POST /api/placement/results rejects incomplete data', async () => {
  const res = await fetch(`${BASE}/api/placement/results`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimatedBand: '5.0' })
  });
  assert.equal(res.status, 400);
});

test('Placement results persist and return normalized integrity from body', async () => {
  const res = await fetch(`${BASE}/api/placement/results`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'integrity_placement', score: { correct: 1, total: 2 },
      estimatedBand: '5.0', integrity: { tabSwitches: 1, pasteAttempts: 0,
        keystrokes: 23, wpm: 35, burstDetected: false, flagged: false } })
  });
  assert.equal(res.status, 201);
  const saved = await res.json();
  assert.deepEqual(saved.integrity, { tabSwitches: 1, pasteAttempts: 0,
    keystrokes: 23, wpm: 35, burstDetected: false, flagged: true });
  const history = await (await fetch(`${BASE}/api/placement/history`)).json();
  assert.deepEqual(history.find(item => item.id === saved.id).integrity, saved.integrity);
});

test('POST /api/analytics/roadmap and /api/analytics/study-plan validate weak areas before calling Gemini', async () => {
  for (const endpoint of ['/api/analytics/roadmap', '/api/analytics/study-plan']) {
    const res = await fetch(`${BASE}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weakAreas: [] })
    });
    assert.equal(res.status, 400, endpoint);
  }
});

test('POST /api/writing/score rejects an empty essay', async () => {
  const res = await fetch(`${BASE}/api/writing/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ essay: '' })
  });
  assert.equal(res.status, 400);
});

test('POST /api/writing/score rejects essays under 250 words', async () => {
  const res = await fetch(`${BASE}/api/writing/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ essay: sampleEssay(100) })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.wordCount, 100);
});

test('POST /api/writing/score scores a valid essay with Gemini',
  { skip: !process.env.GEMINI_API_KEY && 'GEMINI_API_KEY not set — live Gemini call skipped' },
  async () => {
    const essay = `In recent years, online learning has grown rapidly, and some people argue that it will eventually replace traditional university classrooms. While I accept that digital education offers clear benefits, I disagree that it will completely replace face-to-face teaching.

On the one hand, online courses are flexible and affordable. Students can watch lectures at any time, which allows working adults and people in remote areas to gain qualifications without relocating. Furthermore, universities can reach thousands of learners at a fraction of the cost of running physical campuses. For example, platforms such as Coursera now offer degrees from well-known institutions entirely online.

On the other hand, traditional classrooms provide experiences that are difficult to reproduce on a screen. Direct interaction with lecturers and classmates encourages discussion, critical thinking and teamwork, which are essential skills in most careers. In addition, many subjects, including medicine, engineering and the natural sciences, require laboratory work and hands-on practice that cannot be delivered remotely. Campus life also helps young people develop independence and build professional networks.

In my view, the most likely future is a blended model in which universities combine online materials with in-person seminars and practical sessions. This approach keeps the convenience of digital tools while preserving the social and practical value of physical classrooms.

In conclusion, although online education will continue to expand and transform universities, I believe it will complement rather than replace traditional classroom learning, because human interaction and practical training remain central to higher education. Universities that successfully balance both approaches will be best placed to serve the next generation of students.`;
    const res = await fetch(`${BASE}/api/writing/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ essay, topic: 'Online education will replace traditional classrooms.' })
    });
    assert.equal(res.status, 200, await res.clone().text());
    const data = await res.json();
    assert.equal(data.criteria.length, 4);
    assert.ok(data.overall_band >= 0 && data.overall_band <= 9);
    assert.ok(Array.isArray(data.inline_corrections));
  }
);

test('speaking.html has 4-item nav, timer, textarea and loads its assets; all pages share the nav', async () => {
  const html = await (await fetch(`${BASE}/speaking.html`)).text();
  for (const id of ['speaking-input', 'btn-record', 'timer-big', 'history-list', 'btn-submit']) {
    assert.ok(html.includes(`id="${id}"`), `speaking.html should include #${id}`);
  }
  assert.ok(html.includes('js/speaking.js') && html.includes('css/speaking.css'));
  for (const page of ['/index.html', '/writing.html', '/speaking.html', '/analytics.html']) {
    const text = await (await fetch(BASE + page)).text();
    for (const label of ['Placement Test', 'Writing Practice', 'Speaking Practice', 'Analytics']) {
      assert.ok(text.includes(`>${label}</a>`), `${page} nav should include ${label}`);
    }
  }
  for (const asset of ['/js/speaking.js', '/css/speaking.css']) {
    assert.equal((await fetch(BASE + asset)).status, 200, asset);
  }
});

test('analytics page and script include Speaking integration', async () => {
  const html = await (await fetch(`${BASE}/analytics.html`)).text();
  assert.ok(html.includes('id="speaking-score"'));
  const js = await (await fetch(`${BASE}/js/analytics.js`)).text();
  assert.ok(js.includes('/api/speaking/history') && js.includes('ielts_speaking_history'));
});

test('config.json contains the 4 Speaking criteria and speaking settings', async () => {
  const cfg = await (await fetch(`${BASE}/config.json`)).json();
  const abbrs = Object.values(cfg.speakingCriteria).map(c => c.abbreviation).sort();
  assert.deepEqual(abbrs, ['FC', 'GRA', 'LR', 'PR']);
  assert.ok(cfg.speakingSystemInstruction && cfg.speakingResponseFormat);
  assert.ok(cfg.sampleSpeakingTopics.length >= 3);
  assert.equal(cfg.speakingWordCountRequirements.min, 40);
});

test('GET /api/speaking/config returns topics, criteria and word requirements', async () => {
  const data = await (await fetch(`${BASE}/api/speaking/config`)).json();
  assert.ok(data.sampleTopics.length >= 3);
  assert.equal(data.criteria.length, 4);
  assert.equal(data.wordCountRequirements.min, 40);
  assert.ok(data.model);
});

test('GET /api/speaking/history returns an array', async () => {
  const data = await (await fetch(`${BASE}/api/speaking/history`)).json();
  assert.ok(Array.isArray(data));
});

test('POST /api/speaking/score rejects an empty transcript', async () => {
  const res = await fetch(`${BASE}/api/speaking/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: '   ' })
  });
  assert.equal(res.status, 400);
});

test('POST /api/speaking/score rejects transcripts under 40 words', async () => {
  const res = await fetch(`${BASE}/api/speaking/score`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: sampleEssay(20), topic: 'Describe a teacher.' })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.wordCount, 20);
  assert.equal(body.minRequired, 40);
});

test('POST /api/speaking/score scores a valid transcript with Gemini',
  { skip: !process.env.GEMINI_API_KEY && 'GEMINI_API_KEY not set — live Gemini call skipped' },
  async () => {
    const transcript = 'I would like to talk about my English teacher, Ms Lan, who really inspired me when I was in high school. She taught me that making mistakes is a normal part of learning a language. Every lesson she used songs and short stories, so I never felt bored. Because of her encouragement I started speaking in front of the class, and my confidence grew a lot. I still remember how proud I felt after my first presentation, and that is why she influenced me so much.';
    const res = await fetch(`${BASE}/api/speaking/score`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, topic: 'Describe a teacher who has influenced you.' })
    });
    assert.equal(res.status, 200, await res.clone().text());
    const data = await res.json();
    assert.equal(data.criteria.length, 4);
    const history = await (await fetch(`${BASE}/api/speaking/history`)).json();
    assert.ok(history.length >= 1);
  }
);

test('Writing and Speaking persist and return integrity from body or header', async () => {
  const originalFetch = global.fetch;
  const envNames = ['GEMINI_API_KEY', 'GEMINI_API_KEYS', 'GITHUB_TOKEN', 'GITHUB_TOKENS', 'DISABLE_FREE_FALLBACK'];
  const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  process.env.DISABLE_FREE_FALLBACK = 'false';
  const mockResult = { criteria: [{ abbreviation: 'TR', score: 6 }, { abbreviation: 'CC', score: 6 },
    { abbreviation: 'LR', score: 6 }, { abbreviation: 'GRA', score: 6 }], overall_band: 6,
    inline_corrections: [{ original: 'education', correction: 'learning', explanation: 'Word choice' }] };
  global.fetch = (url, options) => String(url) === 'https://text.pollinations.ai/openai'
    ? Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockResult) } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }))
    : originalFetch(url, options);
  try {
    const writing = await originalFetch(`${BASE}/api/writing/score`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ essay: sampleEssay(250), integrity: { tabSwitches: 0,
        pasteAttempts: 2, keystrokes: 120, wpm: 41, burstDetected: false } })
    });
    assert.equal(writing.status, 200, await writing.clone().text());
    const writingData = await writing.json();
    assert.equal(writingData.integrity.pasteAttempts, 2);
    assert.equal(writingData.integrity.flagged, true);
    const writingHistory = await (await originalFetch(`${BASE}/api/writing/history`)).json();
    assert.deepEqual(writingHistory.find(item => item.id === writingData.id).integrity, writingData.integrity);

    const speaking = await originalFetch(`${BASE}/api/speaking/score`, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-Exam-Integrity': JSON.stringify({ tabSwitches: 0, pasteAttempts: 0,
          keystrokes: 80, wpm: 28, burstDetected: true }) },
      body: JSON.stringify({ transcript: sampleEssay(40) })
    });
    assert.equal(speaking.status, 200, await speaking.clone().text());
    const speakingData = await speaking.json();
    assert.equal(speakingData.integrity.burstDetected, true);
    assert.equal(speakingData.integrity.flagged, true);
    const speakingHistory = await (await originalFetch(`${BASE}/api/speaking/history`)).json();
    assert.deepEqual(speakingHistory.find(item => item.id === speakingData.id).integrity, speakingData.integrity);
  } finally {
    global.fetch = originalFetch;
    for (const name of envNames) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  }
});

test('Gemini endpoints share a 10-request limit per 15 minutes', async () => {
  const paths = ['/api/writing/score', '/api/speaking/score',
    '/api/analytics/roadmap', '/api/analytics/study-plan'];
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const res = await fetch(BASE + paths[i % paths.length], {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    statuses.push(res.status);
    if (res.status === 429) assert.ok(Number(res.headers.get('retry-after')) > 0);
  }
  assert.equal(statuses.at(-1), 429);
  assert.ok(statuses.includes(429));
});

/* ── Phase 7: Study Hub ─────────────────────────────────────── */

const post = (route, body) => fetch(BASE + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

/** Run fn with every AI provider disabled so Study endpoints use their offline fallbacks. */
async function withoutAiProviders(fn) {
  const names = ['GEMINI_API_KEY', 'GEMINI_API_KEYS', 'GITHUB_TOKEN', 'GITHUB_TOKENS', 'DISABLE_FREE_FALLBACK'];
  const previous = Object.fromEntries(names.map(n => [n, process.env[n]]));
  for (const n of names) delete process.env[n];
  process.env.DISABLE_FREE_FALLBACK = 'true';
  try { return await fn(); } finally {
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n]; else process.env[n] = previous[n];
    }
  }
}

test('study.html loads its assets, shares the 5-item nav and all 5 pages link to Study Hub', async () => {
  const html = await (await fetch(`${BASE}/study.html`)).text();
  for (const id of ['exam-date', 'target-band', 'countdown-number', 'gap-list', 'textbook-list', 'source-text', 'source-file', 'source-url', 'mastery-fill', 'step-body']) {
    assert.ok(html.includes(`id="${id}"`), `study.html should include #${id}`);
  }
  for (const src of ['js/study.js', 'js/api-keys.js', 'js/exam-security.js', 'css/study.css']) {
    assert.ok(html.includes(src), `study.html should load ${src}`);
  }
  for (const page of ['/index.html', '/writing.html', '/speaking.html', '/study.html', '/analytics.html']) {
    const text = await (await fetch(BASE + page)).text();
    assert.ok(text.includes('<a href="study.html" class="nav-link'), `${page} nav should link to Study Hub`);
    assert.ok(text.includes('>Study Hub</a>'), page);
  }
  for (const asset of ['/js/study.js', '/css/study.css']) {
    assert.equal((await fetch(BASE + asset)).status, 200, asset);
  }
});

test('GET /api/study/config returns 4 textbooks with complete 5-step sample units', async () => {
  const data = await (await fetch(`${BASE}/api/study/config`)).json();
  assert.ok(data.sampleTextbooks.length >= 4);
  assert.deepEqual(data.masterySteps.map(s => s.mastery), [20, 40, 60, 80, 100]);
  for (const book of data.sampleTextbooks) {
    assert.ok(book.title && book.bandRange, book.id);
    assert.ok(book.units.length >= 2, `${book.id} needs at least 2 units`);
    for (const unit of book.units) {
      assert.ok(unit.content.length > 50, `${unit.id} content`);
      const s = unit.sample;
      assert.ok(s.lesson.explanationEn && s.lesson.explanationVi, `${unit.id} lesson`);
      assert.ok(s.flashcards.length >= 4 && s.flashcards.length <= 6, `${unit.id} flashcards`);
      assert.equal(s.quiz.length, 4, `${unit.id} quiz`);
      assert.ok(s.quiz.every(q => q.answer >= 0 && q.answer < q.options.length), `${unit.id} quiz answers`);
      assert.equal(s.drill.length, 3, `${unit.id} drill`);
      assert.ok(s.drill.every(q => q.answer >= 0 && q.answer < q.options.length), `${unit.id} drill answers`);
      assert.ok(s.challenge.prompt && s.challenge.targetWords.length >= 3, `${unit.id} challenge`);
    }
  }
});

test('GET/POST /api/study/progress validates, saves and never lowers mastery', async () => {
  assert.ok(Array.isArray(await (await fetch(`${BASE}/api/study/progress`)).json()));
  assert.equal((await post('/api/study/progress', { mastery: 20 })).status, 400);
  assert.equal((await post('/api/study/progress', { unitId: 'cam-u1', mastery: 33 })).status, 400);
  assert.equal((await post('/api/study/progress', { unitId: 'cam-u1', title: 'Unit', mastery: 60 })).status, 200);
  const lowered = await (await post('/api/study/progress', { unitId: 'cam-u1', mastery: 40 })).json();
  assert.equal(lowered.mastery, 60);
  const list = await (await fetch(`${BASE}/api/study/progress`)).json();
  assert.equal(list.filter(r => r.unitId === 'cam-u1').length, 1);
});

test('POST /api/study/generate-unit validates its input', async () => {
  assert.equal((await post('/api/study/generate-unit', {})).status, 400);
  assert.equal((await post('/api/study/generate-unit', { textbookId: 'nope', unitId: 'nope' })).status, 400);
  assert.equal((await post('/api/study/generate-unit', { sourceText: 'too short' })).status, 400);
});

test('POST /api/study/generate-unit falls back to the sample unit when no AI is available', async () => {
  await withoutAiProviders(async () => {
    const res = await post('/api/study/generate-unit', { textbookId: 'cambridge-reading-listening', unitId: 'cam-u1', weakAreas: ['Reading'] });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.fallback, true);
    assert.equal(data.unit.flashcards.length, 4);
    const custom = await post('/api/study/generate-unit', { sourceText: 'x'.repeat(80) });
    assert.equal(custom.status, 500);
  });
});

test('POST /api/study/extract-source handles text and rejects unsafe or empty input', async () => {
  assert.equal((await post('/api/study/extract-source', {})).status, 400);
  assert.equal((await post('/api/study/extract-source', { url: 'ftp://example.com/a' })).status, 400);
  assert.equal((await post('/api/study/extract-source', { url: 'http://localhost:3000/config.json' })).status, 400);
  assert.equal((await post('/api/study/extract-source', { url: 'http://127.0.0.1/' })).status, 400);
  assert.equal((await post('/api/study/extract-source', { url: 'http://169.254.169.254/latest/meta-data' })).status, 400);
  assert.equal((await post('/api/study/extract-source', { text: 'short' })).status, 422);
  const ok = await post('/api/study/extract-source', { text: 'Climate change is a pressing issue for every country. '.repeat(5), title: 'Notes' });
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.sourceType, 'text');
  assert.ok(data.wordCount > 20);
});

test('POST /api/study/evaluate-mini validates and grades locally when no AI is available', async () => {
  assert.equal((await post('/api/study/evaluate-mini', {})).status, 400);
  assert.equal((await post('/api/study/evaluate-mini', { answer: 'too short' })).status, 400);
  await withoutAiProviders(async () => {
    const answer = Array.from({ length: 55 }, (_, i) => (i === 3 ? 'mitigate' : i === 9 ? 'renewable' : 'word')).join(' ') + '.';
    const res = await post('/api/study/evaluate-mini', { answer, targetWords: ['mitigate', 'renewable', 'sustainable'], minWords: 50, maxWords: 80 });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.provider, 'Local heuristic');
    assert.deepEqual(data.usedWords.sort(), ['mitigate', 'renewable']);
    assert.deepEqual(data.missingWords, ['sustainable']);
    assert.ok(data.band >= 4 && data.score > 0);
  });
});

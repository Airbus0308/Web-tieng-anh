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
let testCookie;
const fetch = async (url, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (String(url).startsWith(BASE || 'http://127.0.0.1:') && testCookie && !headers.has('cookie')) headers.set('cookie', testCookie);
  const response = await globalThis.fetch(url, { ...options, headers });
  const cookie = response.headers.get('set-cookie');
  if (cookie && String(url).startsWith(BASE || 'http://127.0.0.1:')) testCookie = cookie.split(';')[0];
  return response;
};
const fixturePath = name => path.join(testResultsDir, 'users', testCookie.split('=')[1].split('.')[0], name);

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

test('Phase 8A diagnostic remains locked without placement while preserving SRS queue', async () => {
  fs.writeFileSync(path.join(testResultsDir, 'study_srs.json'), JSON.stringify([{itemId:'initial', word:'initial', nextReviewAt:'2000-01-01T00:00:00.000Z'}]));
  const data = await (await fetch(BASE + '/api/study/diagnostic-status')).json();
  assert.equal(data.unlocked, false); assert.equal(data.profile, null);
  assert.deepEqual(data.recommendedCurriculum, []); assert.equal(data.srsSummary.dueTodayCount, 1);
});

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
  assert.ok(cfg.speakingSystemInstruction && cfg.speakingExaminerFollowUpPrompt && cfg.speakingResponseFormat);
  assert.ok(cfg.speakingResponseFormat.includes('part_breakdown') && cfg.speakingResponseFormat.includes('inline_corrections'));
  assert.equal(cfg.sampleSpeakingTopics.length, 8);
  assert.equal(cfg.speakingWordCountRequirements.min, 40);
});

test('GET /api/speaking/config returns topics, criteria and word requirements', async () => {
  const data = await (await fetch(`${BASE}/api/speaking/config`)).json();
  assert.equal(data.sampleTopics.length, 8);
  assert.deepEqual(data.sampleTopics.map(topic => topic.id), ['sp-01','sp-02','sp-03','sp-04','sp-05','sp-06','sp-07','sp-08']);
  for (const topic of data.sampleTopics) {
    assert.equal(typeof topic.part1Topic, 'string', `${topic.id} part1Topic`);
    assert.equal(topic.part1.length, 3, `${topic.id} Part 1`);
    assert.ok(topic.part2?.prompt && topic.part2?.closing && topic.part2?.points?.length, `${topic.id} Part 2`);
    assert.equal(topic.part3.length, 3, `${topic.id} Part 3`);
    assert.equal(topic.followUpBank.length, 2, `${topic.id} follow-up bank`);
    assert.equal(topic.modelBand8Highlight.length, 4, `${topic.id} Band 8 highlights`);
  }
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

test('POST /api/speaking/examiner-turn validates input and falls back deterministically without AI keys', async () => {
  const examinerPost = body => fetch(`${BASE}/api/speaking/examiner-turn`, { method:'POST',
    headers:{'Content-Type':'application/json','X-Forwarded-For':'198.51.100.112'}, body:JSON.stringify(body) });
  assert.equal((await examinerPost({ candidateTranscript: '   ' })).status, 400);
  await withoutAiProviders(async () => {
    const payload = { topicId: 'sp-01', part: 3, turnIndex: 0,
      questionAsked: 'What qualities make a good teacher?',
      candidateTranscript: 'A supportive teacher encouraged independent thinking and helped students become more confident.' };
    const first = await examinerPost(payload);
    const second = await examinerPost(payload);
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    const a = await first.json(), b = await second.json();
    assert.equal(a.provider, 'Local deterministic fallback');
    assert.equal(a.followUpQuestionEn, b.followUpQuestionEn);
    assert.equal(a.wordCount, 12); assert.ok(a.pronunciationTargets.length >= 2);
  });
});

test('POST /api/speaking/examiner-turn accepts a schema-valid mocked AI response', async () => {
  await withoutAiProviders(async () => {
    process.env.OPENAI_API_KEY = 'sk-test-phase11a';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => String(url) === 'https://api.openai.com/v1/chat/completions'
      ? Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        examinerReplyEn: 'Thank you. That is an interesting point.',
        followUpQuestionEn: 'Why might younger learners respond differently?',
        coachingTipVi: 'Hãy thêm một ví dụ cụ thể.',
        pronunciationTargets: ['encouragement', 'independent']
      }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(url, options);
    try {
      const res = await fetch(`${BASE}/api/speaking/examiner-turn`, { method:'POST',
        headers:{'Content-Type':'application/json','X-Forwarded-For':'198.51.100.113'},
        body:JSON.stringify({ topicId: 'sp-01', part: 3, turnIndex: 1,
          questionAsked: 'What qualities make a good teacher?',
          candidateTranscript: 'Encouragement helps learners become independent and confident in difficult situations.' }) });
      const data = await res.json();
      assert.equal(res.status, 200); assert.match(data.provider, /OpenAI/);
      assert.equal(data.followUpQuestionEn, 'Why might younger learners respond differently?');
      assert.deepEqual(data.pronunciationTargets, ['encouragement', 'independent']);
    } finally { globalThis.fetch = originalFetch; }
  });
});

test('POST /api/speaking/score builds and stores an interview transcript with safe corrections and breakdown', async () => {
  await withoutAiProviders(async () => {
    process.env.OPENAI_API_KEY = 'sk-test-phase11a-score';
    const originalFetch = globalThis.fetch;
    let capturedPrompt = '';
    globalThis.fetch = (url, options) => {
      if (String(url) !== 'https://api.openai.com/v1/chat/completions') return originalFetch(url, options);
      capturedPrompt = JSON.parse(options.body).messages.at(-1).content;
      const result = { criteria: [{ abbreviation:'FC',score:6 },{ abbreviation:'LR',score:6 },
        { abbreviation:'GRA',score:6 },{ abbreviation:'PR',score:6 }], overall_band:6,
        overall_feedback:'A balanced interview.', suggestions:['Add examples.'],
        inline_corrections: [
          { original:'I am agree',correction:'I agree',explanation:'Agree is a verb.' },
          { original:'invented phrase',correction:'better phrase',explanation:'Not present.' }
        ] };
      return Promise.resolve(new Response(JSON.stringify({ choices:[{ message:{ content:JSON.stringify(result) } }] }),
        { status:200, headers:{'Content-Type':'application/json'} }));
    };
    try {
      const interviewTurns = [
        { part:1, question:'Do you enjoy reading?', answer:'Yes, I read every evening because books help me relax after a demanding day at work.', durationSec:18 },
        { part:2, question:'Describe an influential film.', answer:'A documentary about climate change transformed my perspective. It provided practical examples and I am agree with its central message.', durationSec:76 },
        { part:3, question:'How does media shape opinions?', answer:'Media outlets select which stories receive attention, so they can influence public priorities and encourage meaningful social discussion.', durationSec:31 }
      ];
      const res = await fetch(`${BASE}/api/speaking/score`, { method:'POST',
        headers:{'Content-Type':'application/json','X-Forwarded-For':'198.51.100.111'},
        body:JSON.stringify({ mode:'interview', topicId:'sp-08', topic:'Culture & Media', part:'Full Interview', interviewTurns }) });
      const data = await res.json();
      assert.equal(res.status, 200, JSON.stringify(data));
      assert.equal(data.mode, 'interview'); assert.equal(data.topicId, 'sp-08');
      assert.deepEqual(Object.keys(data.part_breakdown), ['part1','part2','part3']);
      assert.equal(data.inline_corrections.length, 1); assert.equal(data.inline_corrections[0].original, 'I am agree');
      assert.ok(capturedPrompt.includes('Structured interview turns') && capturedPrompt.includes('Do you enjoy reading?'));
      const history = await (await fetch(`${BASE}/api/speaking/history`)).json();
      const saved = history.find(item => item.id === data.id);
      assert.equal(saved.mode, 'interview'); assert.equal(saved.topicId, 'sp-08');
      assert.equal(saved.interviewTurns.length, 3); assert.ok(saved.transcript.includes('I am agree'));
    } finally { globalThis.fetch = originalFetch; }
  });
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
  const envNames = ['GEMINI_API_KEY', 'GEMINI_API_KEYS', 'OPENAI_API_KEY', 'OPENAI_API_KEYS', 'DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEYS', 'GROQ_API_KEY', 'GROQ_API_KEYS', 'OPENROUTER_API_KEY', 'OPENROUTER_API_KEYS', 'GITHUB_TOKEN', 'GITHUB_TOKENS', 'DISABLE_FREE_FALLBACK'];
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
    const writing = await fetch(`${BASE}/api/writing/score`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ essay: sampleEssay(250), integrity: { tabSwitches: 0,
        pasteAttempts: 2, keystrokes: 120, wpm: 41, burstDetected: false } })
    });
    assert.equal(writing.status, 200, await writing.clone().text());
    const writingData = await writing.json();
    assert.equal(writingData.integrity.pasteAttempts, 2);
    assert.equal(writingData.integrity.flagged, true);
    const writingHistory = await (await fetch(`${BASE}/api/writing/history`)).json();
    assert.deepEqual(writingHistory.find(item => item.id === writingData.id).integrity, writingData.integrity);

    const speaking = await fetch(`${BASE}/api/speaking/score`, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-Exam-Integrity': JSON.stringify({ tabSwitches: 0, pasteAttempts: 0,
          keystrokes: 80, wpm: 28, burstDetected: true }) },
      body: JSON.stringify({ transcript: sampleEssay(40) })
    });
    assert.equal(speaking.status, 200, await speaking.clone().text());
    const speakingData = await speaking.json();
    assert.equal(speakingData.integrity.burstDetected, true);
    assert.equal(speakingData.integrity.flagged, true);
    const speakingHistory = await (await fetch(`${BASE}/api/speaking/history`)).json();
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
  const names = [
    'GEMINI_API_KEY', 'GEMINI_API_KEYS',
    'OPENAI_API_KEY', 'OPENAI_API_KEYS',
    'DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEYS',
    'GROQ_API_KEY', 'GROQ_API_KEYS',
    'OPENROUTER_API_KEY', 'OPENROUTER_API_KEYS',
    'GITHUB_TOKEN', 'GITHUB_TOKENS',
    'DISABLE_FREE_FALLBACK'
  ];
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

test('Phase 8A curriculum contains cognitive fields and fallback preserves them', async () => {
  const cfg = await (await fetch(BASE + '/api/study/config')).json();
  const valid = ['Reading','Listening','TA','TR','CC','LR','GRA','FC','PR'];
  for (const book of cfg.sampleTextbooks) for (const u of book.units) {
    assert.ok(['Foundation','Intermediate','Advanced'].includes(u.levelTag));
    assert.ok(u.targetWeakness.length && u.targetWeakness.every(x => valid.includes(x)));
    assert.ok(u.sample.lesson.bandUpgradeExamples.length >= 2);
    assert.ok(u.sample.lesson.bandUpgradeExamples.every(x => x.bandLow && x.bandHigh && x.analysisVi));
    assert.ok(u.sample.lesson.feynmanPromptVi);
    assert.ok(u.sample.flashcards.every(x => x.ipa && x.clozeSentence.includes('___')));
    assert.deepEqual(new Set(u.sample.drill.map(x => x.skillTag)), new Set(['Reading Paraphrase','Grammar Error Fix (GRA)','Lexical Collocation (LR)']));
  }
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json')));
  assert.ok(raw.tutorFeedbackPrompt && raw.checkpointEvaluationPrompt);
  await withoutAiProviders(async () => {
    const d = await (await post('/api/study/generate-unit', {textbookId:'cambridge-reading-listening', unitId:'cam-u1'})).json();
    assert.equal(d.unit.levelTag,'Intermediate'); assert.ok(d.unit.targetWeakness.includes('Reading'));
    assert.ok(d.unit.lesson.bandUpgradeExamples.length >= 2 && d.unit.lesson.feynmanPromptVi);
    assert.ok(d.unit.flashcards[0].ipa && d.unit.flashcards[0].clozeSentence.includes('___'));
    assert.ok(d.unit.drill[0].skillTag);
  });
});

test('Phase 8A diagnostic uses placement, skills, progress and calibration', async () => {
  fs.writeFileSync(fixturePath('placement_results.json'), JSON.stringify([{estimatedBand:'5.0',sectionBreakdown:{reading:{percentage:40},listening:{percentage:80}}}]));
  fs.writeFileSync(fixturePath('writing_results.json'), JSON.stringify([{result:{overall_band:6,criteria:[{abbreviation:'TR',score:6}]}}]));
  fs.writeFileSync(fixturePath('speaking_results.json'), JSON.stringify([{result:{overall_band:6,criteria:[{abbreviation:'PR',score:7}]}}]));
  fs.writeFileSync(fixturePath('study_checkpoints.json'), JSON.stringify([{metacognition:{calibrationGap:-1}},{metacognition:{calibrationGap:0.5}}]));
  const data = await (await fetch(BASE + '/api/study/diagnostic-status')).json();
  assert.equal(data.unlocked,true); assert.equal(data.profile.skills.reading,5);
  assert.equal(data.profile.skills.listening,7); assert.equal(data.profile.calibrationIndex,-0.2);
  assert.ok(data.profile.weakAreas.includes('Reading'));
  assert.ok(data.recommendedCurriculum.some(x => x.id === 'cam-u1' && x.mastery === 60 && x.matchReasonVi));
  assert.equal(data.counts.writing,1); assert.equal(data.counts.speaking,1);
});

test('Phase 8A tutor validates and falls back locally', async () => {
  assert.equal((await post('/api/study/tutor-feedback',{mode:'feynman',userAttempt:'  '})).status,400);
  assert.equal((await post('/api/study/tutor-feedback',{mode:'bad',userQuestion:'why?'})).status,400);
  await withoutAiProviders(async () => {
    for (const mode of ['feynman','socratic']) {
      const res = await post('/api/study/tutor-feedback',{mode,userAttempt:'I think the verb is in the present.'});
      const data = await res.json(); assert.equal(res.status,200); assert.equal(data.provider,'Local heuristic');
      assert.ok(data.replyVi && data.socraticHintVi && data.followUpQuestion); assert.equal(typeof data.understood,'boolean');
    }
  });
});

test('Phase 8A SRS schedules all qualities and updates existing items', async () => {
  assert.equal((await post('/api/study/srs/review',{})).status,400);
  assert.equal((await post('/api/study/srs/review',{word:'test',quality:'bad'})).status,400);
  let data;
  for (const [quality,days] of [['again',0],['hard',1],['good',3],['easy',14]]) {
    const res = await post('/api/study/srs/review',{word:'resilience',unitId:'u1',quality});
    assert.equal(res.status,200); data = await res.json(); assert.equal(data.intervalDays,days);
    assert.ok(Math.abs(Date.parse(data.nextReviewAt)-Date.parse(data.lastReviewedAt)-days*86400000)<100);
  }
  assert.equal(data.repetitions,4);
  const queue = await (await fetch(BASE + '/api/study/srs')).json();
  assert.equal(queue.items.filter(x => x.word === 'resilience').length,1);
  assert.ok(queue.dueToday.some(x => x.itemId === 'initial'));
});

test('Phase 8A checkpoint validates, evaluates and adds missed words to SRS', async () => {
  const short = await post('/api/study/checkpoint-evaluate',{writtenOutput:'too short'});
  assert.equal(short.status,400); assert.equal((await short.json()).minRequired,30);
  await withoutAiProviders(async () => {
    const output = 'Renewable energy can reduce pollution and improve public health. Communities should invest in clean transport and education. These policies help citizens make better choices every day and protect natural resources for future generations.';
    const res = await post('/api/study/checkpoint-evaluate',{unitId:'phase8-unit',inputBand:5,selfPredictedBand:6,quizScore:4,quizTotal:4,writtenOutput:output,targetWords:['renewable energy','mitigate']});
    assert.equal(res.status,200); const d = await res.json();
    assert.equal(d.provider,'Local heuristic'); assert.deepEqual(d.usedTargetWords,['renewable energy']); assert.deepEqual(d.missedTargetWords,['mitigate']);
    assert.equal(d.bandDelta,Number((d.outputBand-5).toFixed(1))); assert.equal(d.metacognition.calibrationGap,Number((d.outputBand-6).toFixed(1)));
    assert.equal(d.outputBand*2,Math.round(d.outputBand*2)); assert.equal(d.passed,d.score>=70); assert.ok(Array.isArray(d.inlineCorrections));
    assert.ok((await (await fetch(BASE+'/api/study/srs')).json()).dueToday.some(x => x.word==='mitigate'));
    assert.ok((await (await fetch(BASE+'/api/study/checkpoints')).json()).some(x => x.id===d.id));
    if (d.passed) assert.equal((await (await fetch(BASE+'/api/study/progress')).json()).find(x=>x.unitId==='phase8-unit').mastery,100);
  });
});

test('Phase 8A AI results preserve unit fields and send corrections to SRS and mastery', async () => {
  await withoutAiProviders(async () => {
    process.env.DISABLE_FREE_FALLBACK = 'false';
    const originalFetch = global.fetch;
    const book = JSON.parse(fs.readFileSync('config.json')).sampleTextbooks[0];
    const unit = { ...book.units[0].sample, levelTag:book.units[0].levelTag, targetWeakness:book.units[0].targetWeakness };
    let response = unit;
    global.fetch = (url, options) => String(url) === 'https://text.pollinations.ai/openai'
      ? Promise.resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}]}),{status:200,headers:{'Content-Type':'application/json'}}))
      : originalFetch(url, options);
    try {
      let res = await post('/api/study/generate-unit',{textbookId:book.id,unitId:book.units[0].id});
      let data = await res.json(); assert.equal(data.fallback,false);
      assert.deepEqual(data.unit.lesson.bandUpgradeExamples,unit.lesson.bandUpgradeExamples);
      assert.equal(data.unit.flashcards[0].ipa,unit.flashcards[0].ipa); assert.equal(data.unit.drill[0].skillTag,unit.drill[0].skillTag);
      response = {replyVi:'Hãy xét thì.',replyEn:'Consider the tense.',correction:'',explanationVi:'Xét mệnh đề if.',socraticHintVi:'Sau if dùng thì gì?',followUpQuestion:'Vì sao?',understood:true};
      res = await post('/api/study/tutor-feedback',{mode:'feynman',userAttempt:'Present after if.'}); data = await res.json();
      assert.equal(data.understood,true); assert.notEqual(data.provider,'Local heuristic');
      response = {score:80,outputBand:7.1,criteriaBreakdown:{taskAchievement:80,lexicalResource:75,grammarAccuracy:85},inlineCorrections:[{original:'People is',correction:'People are',explanationVi:'People là danh từ số nhiều.'}],feedbackVi:'Cần chú ý hòa hợp.',feedbackEn:'Check agreement.',nextActionVi:'Ôn hòa hợp chủ vị.'};
      const writtenOutput = 'People is concerned about the environment. Communities can improve air quality by using buses and trains. Governments should support renewable energy and provide education so that families can make informed decisions every day.';
      res = await post('/api/study/checkpoint-evaluate',{unitId:'ai-unit',inputBand:5,selfPredictedBand:7,writtenOutput,targetWords:['missing phrase']});
      data = await res.json(); assert.equal(res.status,200); assert.equal(data.outputBand,7); assert.equal(data.passed,true);
      const queue = await (await fetch(BASE+'/api/study/srs')).json();
      assert.ok(queue.dueToday.some(x => x.word==='People is' && x.meaning==='People are'));
      assert.ok(queue.dueToday.some(x => x.word==='missing phrase'));
      assert.equal((await (await fetch(BASE+'/api/study/progress')).json()).find(x=>x.unitId==='ai-unit').mastery,100);
    } finally { global.fetch=originalFetch; }
  });
});

/* ── Phase 8B: SRL-SLA 3-stage Study Hub UI ─────────────────── */

test('Phase 8B study.html contains the 3-stage cycle bar, diagnostic gate and Forethought panels', async () => {
  const html = await (await fetch(`${BASE}/study.html`)).text();
  for (const id of ['srl-stage-bar', 'diagnostic-gate', 'forethought-panel', 'profile-body', 'kbcp-commitment-box', 'commit-time', 'commit-minutes',
    'streak-bar', 'srs-due-panel', 'srs-due-list', 'recommended-curriculum', 'tutor-feedback-panel', 'checkpoint-history',
    // Phase 7 ids that must survive
    'exam-date', 'target-band', 'countdown-number', 'gap-list', 'textbook-list', 'source-text', 'source-file', 'source-url', 'mastery-fill', 'step-body']) {
    assert.ok(html.includes(`id="${id}"`), `study.html should include #${id}`);
  }
  for (const text of ['①', '②', '③', 'Forethought', 'Performance', 'Self-Reflection',
    'Test Chẩn đoán &amp; Kế hoạch KBCP', 'Giáo trình Cá nhân hóa &amp; 4 Kỹ thuật Nhận thức', 'Lượng giá Đầu ra &amp; Phản tư Siêu nhận thức',
    'Cổng Chẩn Đoán Đầu Vào Bắt Buộc', 'index.html', 'writing.html', 'speaking.html']) {
    assert.ok(html.includes(text), `study.html should mention ${text}`);
  }
});

test('Phase 8B js/study.js is valid and wires every SRL-SLA API and learning technique', async () => {
  const src = await (await fetch(`${BASE}/js/study.js`)).text();
  const vm = await import('node:vm');
  assert.doesNotThrow(() => new vm.Script(src), 'study.js should compile');
  for (const token of [
    '/api/placement/results', 'ielts_placement_results', '/api/study/diagnostic-status', '/api/study/tutor-feedback', '/api/study/srs/review',
    '/api/study/srs', '/api/study/checkpoint-evaluate', '/api/study/checkpoints',
    "mode: 'feynman'", "mode: 'socratic'", 'bandUpgradeExamples', 'feynmanPromptVi', 'ipa', 'clozeSentence', 'speechSynthesis', 'skillTag',
    'socraticHintVi', 'SpeechRecognition', 'webkitSpeechRecognition', 'selfPredictedBand', 'selfDifficultyReason', 'writtenOutput', 'spokenTranscript',
    'calibrationFeedbackVi', 'criteriaBreakdown', 'usedTargetWords', 'missedTargetWords', 'inlineCorrections', 'explanationVi',
    'PASSED ✓', 'NEEDS REVIEW ↻', 'recommendedCurriculum', 'matchReasonVi', 'levelTag', 'targetWeakness', 'calibrationIndex',
    'Quên / again', 'Khó / hard', 'Nhớ tốt / good', 'Rất dễ / easy', 'ielts_study_commitment', 'ielts_study_streak', 'T2', 'CN'
  ]) {
    assert.ok(src.includes(token), `study.js should include ${token}`);
  }
});

test('Phase 8B css/study.css styles the SRL-SLA components', async () => {
  const css = await (await fetch(`${BASE}/css/study.css`)).text();
  for (const selector of ['.srl-stage-bar', '.diagnostic-gate', '.streak-bar', '.srs-item', '.band-upgrade', '.feynman-box', '.skill-tag',
    '.calibration-box', '.band-compare', '.crit-row', '.status-badge', '.correction-row', '.streak-stats-card', '.streak-stats-svg']) {
    assert.ok(css.includes(selector), `study.css should style ${selector}`);
  }
});

test('GET /api/study/streak-stats and /api/study/streak-stats.svg render DenverCoder1-style 3-column streak card', async () => {
  const jsonRes = await fetch(`${BASE}/api/study/streak-stats?dates=2026-11-13,2026-11-14,2026-11-15`);
  assert.equal(jsonRes.status, 200);
  const stats = await jsonRes.json();
  assert.ok(stats.totalContributions >= 3);
  assert.ok(stats.longestStreak.length >= 3);

  const svgRes = await fetch(`${BASE}/api/study/streak-stats.svg?dates=2026-11-13,2026-11-14,2026-11-15`);
  assert.equal(svgRes.status, 200);
  assert.ok((svgRes.headers.get('content-type') || '').includes('image/svg+xml'));
  const svg = await svgRes.text();
  assert.ok(svg.includes('<svg') && svg.includes('Chuỗi Ngày Liên Tiếp') && svg.includes('Kỷ Lục Chuỗi Ngày'));
});

/* ── Phase 9A: Progressive Disclosure Study Cockpit + Focus Classroom ── */

test('Phase 9A study.html splits into Study Cockpit hub and Focus Classroom views', async () => {
  const html = await (await fetch(`${BASE}/study.html`)).text();
  for (const id of ['hub-view', 'classroom-view', 'btn-back-to-hub', 'hub-tabs', 'tab-courses', 'tab-create', 'panel-courses', 'panel-create',
    'profile-card', 'btn-continue-unit', 'btn-open-suggested', 'countdown-label', 'band-input', 'band-target', 'step-outline', 'classroom-breadcrumb']) {
    assert.ok(html.includes(`id="${id}"`), `study.html should include #${id}`);
  }
  assert.ok(!html.includes('id="study-banner"'), '#study-banner should be merged into the cockpit');
  assert.ok(html.includes('class="cockpit"'), 'cockpit grid wrapper');
  assert.ok(html.includes('role="tablist"') && html.includes('role="tabpanel"'), 'hub tabs use ARIA tab roles');
  // The countdown, gap list and suggested-unit button now live inside the cockpit, before the tabs.
  const cockpitEnd = html.indexOf('id="hub-tabs"');
  for (const id of ['countdown-number', 'countdown-label', 'gap-list', 'btn-open-suggested', 'exam-date', 'target-band', 'streak-bar', 'srs-due-list']) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > html.indexOf('id="forethought-panel"') && at < cockpitEnd, `#${id} should be inside the cockpit`);
  }
  // The 5-step player and the Socratic tutor live only in the classroom view.
  const classroomStart = html.indexOf('id="classroom-view"');
  for (const id of ['lesson-section', 'mastery-fill', 'step-body', 'tutor-feedback-panel']) {
    assert.ok(html.indexOf(`id="${id}"`) > classroomStart, `#${id} should be inside #classroom-view`);
  }
});

test('Phase 9A css/study.css and js/study.js implement the cockpit, course cards and view switching', async () => {
  const css = await (await fetch(`${BASE}/css/study.css`)).text();
  for (const selector of ['.cockpit', '.course-card', '.course-grid', '.hub-tab', '.classroom-view', '.classroom-layout', '.step-outline']) {
    assert.ok(css.includes(selector), `study.css should style ${selector}`);
  }
  const src = await (await fetch(`${BASE}/js/study.js`)).text();
  for (const token of ['setView', 'ielts_study_last_unit', 'pushState', 'popstate', '#unit=', 'course-card', 'btn-back-to-hub', 'switchHubTab']) {
    assert.ok(src.includes(token), `study.js should include ${token}`);
  }
});

test('Phase 9A config.json gives every unit its own skill-tagged quiz and interleaved drill', async () => {
  const cfg = await (await fetch(`${BASE}/api/study/config`)).json();
  const QUIZ_TAGS = ['Reading', 'Listening', 'Writing TR', 'Writing CC', 'Grammar (GRA)', 'Lexical (LR)'];
  const DRILL_TAGS = ['Reading Paraphrase', 'Grammar Error Fix (GRA)', 'Lexical Collocation (LR)'];
  const owners = new Map();
  let units = 0;
  for (const book of cfg.sampleTextbooks) {
    for (const unit of book.units) {
      units += 1;
      const { quiz, drill } = unit.sample;
      assert.ok(quiz.every(q => QUIZ_TAGS.includes(q.skillTag)), `${unit.id} quiz needs a valid skillTag`);
      assert.deepEqual([...drill.map(d => d.skillTag)].sort(), [...DRILL_TAGS].sort(), `${unit.id} drill must interleave the 3 skills`);
      for (const item of [...quiz.map(q => q.question), ...drill.map(d => d.sentence)]) {
        const key = item.trim().toLowerCase();
        assert.ok(!owners.has(key) || owners.get(key) === unit.id, `"${item}" is shared by ${owners.get(key)} and ${unit.id}`);
        owners.set(key, unit.id);
      }
    }
  }
  assert.ok(units >= 8, 'all 8 standard units checked');
});

test('Phase 9A generate-unit keeps quiz skillTag through normalizeStudyUnit', async () => {
  await withoutAiProviders(async () => {
    const data = await (await post('/api/study/generate-unit', { textbookId: 'grammar-complex-sentences', unitId: 'gram-u1' })).json();
    assert.ok(data.unit.quiz.every(q => q.skillTag === 'Grammar (GRA)'));
    assert.ok(data.unit.drill.some(d => d.skillTag === 'Lexical Collocation (LR)'));
  });
});

/* ── Phase 9B: per-user sessions, sync and mistake learning ── */
function browser() {
  let cookie = '';
  return {
    async request(route, options = {}) {
      const headers = new Headers(options.headers || {});
      if (cookie) headers.set('Cookie', cookie);
      if (options.body !== undefined && typeof options.body !== 'string') { headers.set('Content-Type','application/json'); options = { ...options, body:JSON.stringify(options.body) }; }
      const res = await globalThis.fetch(BASE + route, { ...options, headers });
      const setCookie = res.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(/, (?=im_uid=)/).at(-1).split(';')[0];
      return res;
    },
    get cookie() { return cookie; }
  };
}

test('Phase 9B migrates old local data once and stores no session plaintext', async () => {
  const id = testCookie.split('=')[1].split('.')[0];
  assert.ok(fs.existsSync(path.join(testResultsDir,'study_srs.json')));
  assert.ok(fs.existsSync(path.join(testResultsDir,'users',id,'study_srs.json')));
  const sessions = fs.readFileSync(path.join(testResultsDir,'auth','sessions.json'),'utf8');
  assert.ok(!sessions.includes(testCookie.split('.')[1]));
  const me = await (await fetch(BASE+'/api/me')).json();
  assert.equal(me.userId,id); assert.equal(me.storage,'json-dir'); assert.ok(me.currentSessionId);
});

test('Phase 9B isolates users, merges guest data, limits devices and revokes sessions', async () => {
  const a=browser(), b=browser(), c=browser(), d=browser();
  const first = await a.request('/api/me');
  assert.match(first.headers.get('set-cookie'), /im_uid=.*HttpOnly.*SameSite=Lax/i);
  const aMe = await first.json(), bMe = await (await b.request('/api/me')).json();
  assert.notEqual(aMe.userId,bMe.userId);
  await a.request('/api/placement/results',{method:'POST',body:{id:'shared-id',score:{correct:3,total:4},estimatedBand:6}});
  assert.equal((await (await b.request('/api/placement/history')).json()).length,0);
  await a.request('/api/study/progress',{method:'POST',body:{unitId:'merge-unit',mastery:40}});
  await b.request('/api/study/progress',{method:'POST',body:{unitId:'merge-unit',mastery:80}});
  await b.request('/api/placement/results',{method:'POST',body:{id:'guest-attempt',score:{correct:1,total:2},estimatedBand:5}});
  const codeRes = await a.request('/api/auth/passcode',{method:'POST'}), code=(await codeRes.json()).passcode;
  assert.match(code,/^IELTS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  assert.ok(!fs.readFileSync(path.join(testResultsDir,'auth','passcodes.json'),'utf8').includes(code));
  const redeem = await b.request('/api/auth/redeem',{method:'POST',body:{passcode:code,localData:{ielts_placement_results:[{id:'guest-attempt',score:{correct:1,total:2},estimatedBand:5},{id:'local-attempt',score:{correct:2,total:2},estimatedBand:7}],ielts_study_progress:[{unitId:'merge-unit',mastery:60}],ielts_study_goal:{examDate:'2028-01-01',targetBand:7.5},ielts_study_streak:['2026-11-14','2026-11-15'],ielts_study_commitment:{time:'20:00',minutes:25}}}});
  assert.equal(redeem.status,200); assert.equal((await redeem.json()).userId,aMe.userId);
  const profileAfter = await (await a.request('/api/me')).json(); assert.equal(profileAfter.targetBand,7.5); assert.equal(profileAfter.commitment.minutes,25); assert.deepEqual(profileAfter.streak,['2026-11-14','2026-11-15']);
  const history = await (await a.request('/api/placement/history')).json();
  assert.deepEqual(history.map(x=>x.id).sort(),['guest-attempt','local-attempt','shared-id']);
  assert.equal((await (await a.request('/api/study/progress')).json()).find(x=>x.unitId==='merge-unit').mastery,80);
  assert.equal((await c.request('/api/auth/redeem',{method:'POST',body:{passcode:code}})).status,200);
  const rejected = await d.request('/api/auth/redeem',{method:'POST',body:{passcode:code}});
  const blocked = await rejected.json(); assert.equal(rejected.status,409); assert.equal(blocked.error,'device_limit'); assert.equal(blocked.maxDevices,3); assert.equal(blocked.devices.length,3);
  const cMe = await (await c.request('/api/me')).json();
  assert.equal((await a.request('/api/auth/sessions/'+cMe.currentSessionId,{method:'DELETE'})).status,200);
  assert.equal((await d.request('/api/auth/redeem',{method:'POST',body:{passcode:code}})).status,200);
  const oldDevice = await (await c.request('/api/me')).json(); assert.notEqual(oldDevice.userId,aMe.userId);
  const reset = await d.request('/api/auth/logout',{method:'POST'}); assert.equal(reset.status,200);
  assert.equal((await (await d.request('/api/placement/history')).json()).length,0);
});

test('Phase 9B rejects foreign Origins, limits incorrect codes and rotates passcodes', async () => {
  const a=browser(); await a.request('/api/me');
  const csrf = await a.request('/api/me',{method:'POST',headers:{Origin:'https://evil.example'},body:{displayName:'bad'}});
  assert.equal(csrf.status,403);
  const updated = await a.request('/api/me',{method:'POST',body:{displayName:'Lan',targetBand:7,examDate:'2027-01-01'}}); assert.equal(updated.status,200);
  const first=(await (await a.request('/api/auth/passcode',{method:'POST'})).json()).passcode;
  const second=(await (await a.request('/api/auth/passcode',{method:'POST'})).json()).passcode;
  assert.notEqual(first,second);
  const b=browser();
  for (let i=0;i<5;i++) assert.equal((await b.request('/api/auth/redeem',{method:'POST',headers:{'X-Forwarded-For':'192.0.2.45'},body:{passcode:first}})).status,401);
  assert.equal((await b.request('/api/auth/redeem',{method:'POST',headers:{'X-Forwarded-For':'192.0.2.45'},body:{passcode:second}})).status,429);
  assert.equal((await b.request('/api/auth/redeem',{method:'POST',headers:{'X-Forwarded-For':'192.0.2.46'},body:{passcode:second}})).status,200);
});

test('Phase 9B mistake unit works offline without placement and adds distinct errors to own SRS', async () => {
  await withoutAiProviders(async () => {
    const b=browser(), other=browser();
    const context={source:'writing',recordId:'essay-123',prompt:'Discuss education.',weakestCriterion:{code:'GRA',score:5,feedback:'Check agreement.'},corrections:[{original:'People is happy',correction:'People are happy',explanation:'People is plural.'},{original:'She go home',correction:'She goes home',explanation:'Use goes.'}]};
    const diagnostic=await (await b.request('/api/study/diagnostic-status')).json(); assert.equal(diagnostic.unlocked,false);
    const res=await b.request('/api/study/generate-unit',{method:'POST',body:{mistakeContext:context}}); assert.equal(res.status,200);
    const data=await res.json(); assert.equal(data.fallback,true); assert.equal(data.unitId,'mistake_writing_essay-123'); assert.equal(data.unit.source,'mistakes'); assert.ok(data.unit.theory && data.unit.vocabulary.length>=4);
    assert.equal(data.unit.quiz.length,4); assert.ok(data.unit.quiz.every(x=>x.skillTag)); assert.equal(data.unit.drill.length,3); assert.ok(data.unit.drill.every(x=>x.skillTag));
    const again=await (await b.request('/api/study/generate-unit',{method:'POST',body:{mistakeContext:context}})).json(); assert.equal(data.unitId,again.unitId);
    const queue=await (await b.request('/api/study/srs')).json(); assert.equal(queue.items.filter(x=>x.source==='mistake-unit').length,2);
    assert.equal((await (await other.request('/api/study/srs')).json()).totalItems,0);
    const speaking=await (await b.request('/api/study/generate-unit',{method:'POST',body:{mistakeContext:{source:'speaking',recordId:'s1',suggestions:['Use clearer transitions.'],weakestCriterion:{code:'FC'}}}})).json();
    assert.equal(speaking.unit.source,'mistakes'); assert.equal(speaking.unit.quiz.length,4);
  });
});

test('Phase 9B Upstash adapter stores isolated records and uses REST locks', async () => {
  const { createStore, getStorageMode } = await import('../db/store.js');
  const originalFetch = globalThis.fetch;
  const names = ['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','VERCEL'];
  const saved = Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const values = new Map();
  process.env.UPSTASH_REDIS_REST_URL='https://redis.test'; process.env.UPSTASH_REDIS_REST_TOKEN='test-token';
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url),'https://redis.test');
    const [op,...args]=JSON.parse(options.body); let result;
    if (op==='GET') result=values.get(args[0]) ?? null;
    else if (op==='SET') { if (args[2]==='NX' && values.has(args[0])) result=null; else { values.set(args[0],args[1]); result='OK'; } }
    else if (op==='EVAL') { const key=args[2]; if (args[0].includes('INCR')) { result=Number(values.get(key)||0)+1; values.set(key,String(result)); } else { result=values.get(key)===args[3] ? 1 : 0; if (result) values.delete(key); } }
    else throw new Error(`unexpected ${op}`);
    return new Response(JSON.stringify({result}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    assert.equal(getStorageMode(),'upstash'); const store=createStore(testResultsDir);
    await store.putProfile('usr_a',{id:'usr_a'}); assert.equal((await store.getProfile('usr_a')).id,'usr_a');
    await store.withLock('user_usr_a',async()=>store.append('usr_a','placement_results',{id:'p1'}));
    assert.equal((await store.list('usr_a','placement_results')).length,1);
    assert.equal((await store.list('usr_b','placement_results')).length,0);
    assert.equal(await store.failedAttempts('192.0.2.1',true),1); assert.equal(await store.failedAttempts('192.0.2.1'),1);
    delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; process.env.VERCEL='1'; assert.equal(getStorageMode(),'ephemeral');
  } finally { globalThis.fetch=originalFetch; for (const n of names) if(saved[n]===undefined) delete process.env[n]; else process.env[n]=saved[n]; }
});

test('Phase 9B simultaneous redeems cannot exceed three active devices', async () => {
  const owner=browser(), visitors=[browser(),browser(),browser(),browser()];
  await owner.request('/api/me'); const code=(await (await owner.request('/api/auth/passcode',{method:'POST'})).json()).passcode;
  await Promise.all(visitors.map(b=>b.request('/api/me')));
  const outcomes = await Promise.all(visitors.map((b,i)=>b.request('/api/auth/redeem',{method:'POST',headers:{'X-Forwarded-For':`192.0.2.${100+i}`},body:{passcode:code}})));
  assert.equal(outcomes.filter(r=>r.status===200).length,2);
  assert.equal(outcomes.filter(r=>r.status===409).length,2);
  const sessions = await (await owner.request('/api/auth/sessions')).json(); assert.equal(sessions.devices.length,3);
});

test('Phase 9B Upstash REST supports cookie identity and persistent user isolation', async () => {
  const nativeFetch=globalThis.fetch, names=['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','VERCEL'];
  const saved=Object.fromEntries(names.map(n=>[n,process.env[n]])), data=new Map();
  process.env.UPSTASH_REDIS_REST_URL='https://redis.integration.test'; process.env.UPSTASH_REDIS_REST_TOKEN='test-token'; process.env.VERCEL='1';
  globalThis.fetch=async (url,options) => {
    if (String(url)!=='https://redis.integration.test') return nativeFetch(url,options);
    const [op,...args]=JSON.parse(options.body); let result;
    if(op==='GET') result=data.get(args[0]) ?? null;
    else if(op==='SET') { if(args[2]==='NX' && data.has(args[0])) result=null; else { data.set(args[0],args[1]); result='OK'; } }
    else if(op==='EVAL') { const key=args[2]; if(args[0].includes('INCR')) { result=Number(data.get(key)||0)+1; data.set(key,String(result)); } else { result=data.get(key)===args[3]?1:0; if(result) data.delete(key); } }
    else throw Error(op);
    return new Response(JSON.stringify({result}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  let instance;
  try {
    const {default:redisApp}=await import('../server.js?phase9-upstash-test');
    instance=redisApp.listen(0,'127.0.0.1'); await new Promise(resolve=>instance.once('listening',resolve));
    const base=`http://127.0.0.1:${instance.address().port}`;
    const first=await nativeFetch(base+'/api/me'), cookie=first.headers.get('set-cookie').split(';')[0];
    const profile=await first.json(); assert.equal(profile.storage,'upstash'); assert.match(first.headers.get('set-cookie'),/Secure/i);
    const headers={'Cookie':cookie,'Content-Type':'application/json'};
    const put=await nativeFetch(base+'/api/placement/results',{method:'POST',headers,body:JSON.stringify({id:'redis-1',score:{correct:1,total:1},estimatedBand:7})}); assert.equal(put.status,201);
    assert.equal((await (await nativeFetch(base+'/api/placement/history',{headers})).json()).length,1);
    assert.equal((await (await nativeFetch(base+'/api/placement/history')).json()).length,0);
  } finally {
    if(instance) await new Promise(resolve=>instance.close(resolve)); globalThis.fetch=nativeFetch;
    for(const n of names) if(saved[n]===undefined) delete process.env[n]; else process.env[n]=saved[n];
  }
});

test('Phase 9B mistakes fall back when AI fails and add at most five distinct items', async () => {
  await withoutAiProviders(async () => {
    const originalFetch=globalThis.fetch;
    process.env.GROQ_API_KEY='gsk_test_key';
    globalThis.fetch=(url,options) => String(url).startsWith('https://api.groq.com/')
      ? Promise.reject(new Error('offline test')) : originalFetch(url,options);
    try {
      const b=browser(), corrections=Array.from({length:7},(_,i)=>({original:`wrong ${i}`,correction:`correct ${i}`,explanation:'Check this phrase.'}));
      const response=await b.request('/api/study/generate-unit',{method:'POST',body:{mistakeContext:{source:'writing',recordId:'offline',corrections}}});
      const data=await response.json(); assert.equal(response.status,200); assert.equal(data.fallback,true);
      assert.equal((await (await b.request('/api/study/srs')).json()).items.length,5);
    } finally { globalThis.fetch=originalFetch; }
  });
});

test('Phase 9B establishes session on the application page before parallel API calls', async () => {
  const page=await globalThis.fetch(BASE+'/study.html');
  assert.equal(page.status,200); const cookie=page.headers.get('set-cookie').split(';')[0];
  const profiles=await Promise.all(Array.from({length:3},async()=> (await (await globalThis.fetch(BASE+'/api/me',{headers:{Cookie:cookie}})).json()).userId));
  assert.equal(new Set(profiles).size,1);
});

/* ── Phase 9B frontend: Learner Profile Pill, Sync modal, mistakes launcher, PDF/DOCX ── */

test('Phase 9B frontend: all 5 pages load js/auth-profile.js before their page script', async () => {
  const pages = { '/index.html': 'js/questions.js', '/writing.html': 'js/writing.js', '/speaking.html': 'js/speaking.js', '/study.html': 'js/study.js', '/analytics.html': 'js/analytics.js' };
  for (const [page, pageScript] of Object.entries(pages)) {
    const html = await (await fetch(BASE + page)).text();
    const at = html.indexOf('<script src="js/auth-profile.js"></script>');
    assert.ok(at > 0, `${page} should load js/auth-profile.js`);
    assert.ok(at < html.indexOf(`<script src="${pageScript}"></script>`), `${page} should load auth-profile.js before ${pageScript}`);
    assert.ok(html.includes('class="header-right"'), `${page} needs a .header-right slot for the pill`);
  }
  const src = await (await fetch(`${BASE}/js/auth-profile.js`)).text();
  const vm = await import('node:vm');
  assert.doesNotThrow(() => new vm.Script(src), 'auth-profile.js should compile');
  for (const token of ['user-profile-pill', '/api/me', '/api/auth/passcode', '/api/auth/redeem', '/api/auth/sessions', '/api/auth/logout',
    'device_limit', 'revokeSessionId', 'ephemeral', 'IELTS-XXXX-XXXX', 'ielts_custom_units_v1', '/api/study/generate-unit', 'mistakeContext',
    'study.html#unit=', 'ielts:profile-updated', 'aria-modal', 'localData']) {
    assert.ok(src.includes(token), `auth-profile.js should include ${token}`);
  }
});

test('Phase 9B frontend: Writing and Speaking results offer the mistake-unit launcher', async () => {
  for (const [page, script, app] of [['/writing.html', '/js/writing.js', 'WritingApp'], ['/speaking.html', '/js/speaking.js', 'SpeakingApp']]) {
    const html = await (await fetch(BASE + page)).text();
    assert.ok(html.includes('id="btn-create-mistake-unit"') && html.includes('🎯 Tạo Bài Học Khắc Phục Lỗi Này'), `${page} button`);
    assert.ok(html.includes(`${app}.createMistakeUnit(this)`), `${page} wires ${app}.createMistakeUnit`);
    assert.ok(html.indexOf('id="btn-create-mistake-unit"') > html.indexOf('id="results-area"'), `${page} button lives in the results area`);
    const src = await (await fetch(BASE + script)).text();
    for (const token of ['createMistakeUnit', 'AuthProfile.createMistakeUnit', 'weakestCriterion', 'recordId', 'suggestions']) {
      assert.ok(src.includes(token), `${script} should include ${token}`);
    }
  }
  assert.ok((await (await fetch(`${BASE}/js/writing.js`)).text()).includes('inline_corrections'));
  assert.ok((await (await fetch(`${BASE}/js/speaking.js`)).text()).includes('transcriptExcerpt'));
  assert.ok((await (await fetch(`${BASE}/css/writing.css`)).text()).includes('.btn-mistake-unit'));
});

test('Phase 9B frontend: Study Hub restores mistake units past the gate and extracts PDF/DOCX client-side', async () => {
  const html = await (await fetch(`${BASE}/study.html`)).text();
  assert.ok(html.includes('id="custom-units-section"') && html.includes('id="custom-units-list"'));
  assert.ok(/id="source-file"[^>]*accept="[^"]*\.pdf[^"]*\.docx/.test(html), 'file input accepts .pdf and .docx');
  const src = await (await fetch(`${BASE}/js/study.js`)).text();
  for (const token of ['ielts_custom_units_v1', 'hashIsMistakeUnit', "source === 'mistakes'", 'pdfjs-dist@', 'pdf.worker.min.js', 'mammoth@',
    'extractRawText', 'getTextContent', 'GlobalWorkerOptions', 'MAX_SOURCE_CHARS', 'applyServerProfile', 'AuthProfile']) {
    assert.ok(src.includes(token), `study.js should include ${token}`);
  }
});

test('Phase 9B redeem can revoke one old device of the target account in the same step', async () => {
  const owner = browser(); await owner.request('/api/me');
  const code = (await (await owner.request('/api/auth/passcode', { method: 'POST' })).json()).passcode;
  const second = browser(), third = browser(), fourth = browser();
  assert.equal((await second.request('/api/auth/redeem', { method: 'POST', body: { passcode: code } })).status, 200);
  assert.equal((await third.request('/api/auth/redeem', { method: 'POST', body: { passcode: code } })).status, 200);
  const blocked = await fourth.request('/api/auth/redeem', { method: 'POST', body: { passcode: code } });
  assert.equal(blocked.status, 409);
  const { devices } = await blocked.json();
  const bogus = await fourth.request('/api/auth/redeem', { method: 'POST', body: { passcode: code, revokeSessionId: 'ses_unknown' } });
  assert.equal(bogus.status, 409, 'an unknown session id must not bypass the limit');
  const victimId = devices.find(d => d.id).id;
  const ok = await fourth.request('/api/auth/redeem', { method: 'POST', body: { passcode: code, revokeSessionId: victimId } });
  assert.equal(ok.status, 200);
  const me = await (await fourth.request('/api/me')).json();
  assert.equal(me.devices.length, 3);
  assert.ok(!me.devices.some(d => d.id === victimId), 'revoked device is gone');
});

test('Phase 9B PATCH /api/me stores commitment and merges streak days', async () => {
  const a = browser(); await a.request('/api/me');
  assert.equal((await a.request('/api/me', { method: 'PATCH', body: { commitment: { time: '25:99x', minutes: 3 } } })).status, 400);
  assert.equal((await a.request('/api/me', { method: 'PATCH', body: { streak: ['not-a-date'] } })).status, 400);
  assert.equal((await a.request('/api/me', { method: 'PATCH', body: { commitment: { time: '20:30', minutes: 30 }, streak: ['2026-11-14'] } })).status, 200);
  await a.request('/api/me', { method: 'PATCH', body: { streak: ['2026-11-16', '2026-11-14'] } });
  const me = await (await a.request('/api/me')).json();
  assert.deepEqual(me.commitment, { time: '20:30', minutes: 30 });
  assert.deepEqual(me.streak, ['2026-11-14', '2026-11-16']);
});

/* ── Phase 10A: Task 1 grading and overall Writing band ── */
test('Phase 10A Writing config includes the six required Task 1 topics and keeps Task 2 config', async () => {
  const d=await (await fetch(BASE+'/api/writing/config')).json();
  assert.deepEqual(d.task1WordCountRequirements,{min:150,recommended:180,timeMinutes:20});
  assert.deepEqual(d.task1Criteria.map(c=>c.abbreviation),['TA','CC','LR','GRA']);
  assert.ok(d.task1Criteria.every(c=>c.weight===0.25));
  // The six spec topics must stay; Gemini CLI's extra content (map, semi-formal letter) is allowed.
  const ids=d.sampleTask1Topics.map(t=>t.id);
  for (const id of ['wt1-ac-bar-01','wt1-ac-line-01','wt1-ac-pie-01','wt1-ac-table-01','wt1-ac-process-01','wt1-gt-letter-01']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(d.sampleTask1Topics.find(t=>t.id==='wt1-gt-letter-01').tone,'Formal');
  for (const t of d.sampleTask1Topics) {
    assert.equal(t.taskNumber,1); assert.ok(t.prompt && t.instructions && t.keyFacts.length);
    if(t.visualType==='letter') { assert.equal(t.subType,'general'); assert.ok(['Formal','Semi-formal','Informal'].includes(t.tone)); assert.equal(t.bulletPoints.length,3); }
    else { assert.equal(t.subType,'academic'); assert.ok(t.visualData); }
  }
  for(const type of ['bar','line','pie']) {
    const chart=d.sampleTask1Topics.find(t=>t.visualType===type).visualData;
    assert.ok(chart.series.every(s=>s.values.length===chart.categories.length));
    if(type==='pie') assert.ok(chart.series.every(s=>s.values.reduce((a,b)=>a+b,0)===100));
  }
  assert.equal(d.sampleTask1Topics.find(t=>t.visualType==='table').visualData.rows.length,5);
  assert.equal(d.sampleTask1Topics.find(t=>t.visualType==='process').visualData.steps.length,6);
  assert.equal(d.wordCountRequirements.min,250); assert.ok(d.sampleTopics.length); assert.ok(d.criteria.some(c=>c.abbreviation==='TR'));
});

test('Phase 10A Task 1 grades 160 words with source facts and calculates weighted Writing band', async () => {
  await withoutAiProviders(async () => {
    process.env.DISABLE_FREE_FALLBACK='false';
    const originalFetch=globalThis.fetch; const prompts=[]; let band=6;
    globalThis.fetch=(url,options) => {
      if(String(url)!=='https://text.pollinations.ai/openai') return originalFetch(url,options);
      prompts.push(JSON.parse(options.body).messages.at(-1).content);
      const result={overall_band:band,criteria:[{name:'Task Response',abbreviation:'TR',score:5},{abbreviation:'CC',score:7},{abbreviation:'LR',score:7},{abbreviation:'GRA',score:7}],overall_feedback:'Feedback',suggestions:[],inline_corrections:[],has_clear_overview:true};
      return Promise.resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{status:200,headers:{'Content-Type':'application/json'}}));
    };
    try {
      const a=browser(), b=browser(), headers={'X-Forwarded-For':'198.51.100.10'};
      let res=await a.request('/api/writing/score',{method:'POST',headers,body:{essay:sampleEssay(149),taskNumber:1}});
      let data=await res.json(); assert.equal(res.status,400); assert.equal(data.minRequired,150); assert.equal(data.wordCount,149); assert.equal(data.taskNumber,1);
      res=await a.request('/api/writing/score',{method:'POST',headers,body:{essay:sampleEssay(160)}}); data=await res.json(); assert.equal(res.status,400); assert.equal(data.minRequired,250); assert.equal(data.taskNumber,2);
      res=await a.request('/api/writing/score',{method:'POST',headers,body:{essay:sampleEssay(160),taskNumber:1,topicId:'wt1-ac-bar-01'}});
      data=await res.json(); assert.equal(res.status,200); assert.equal(data.criteria[0].abbreviation,'TA'); assert.equal(data.criteria[0].name,'Task Achievement'); assert.equal(data.has_clear_overview,true);
      assert.equal(data.writingBandSummary.latestTask1Band,6); assert.equal(data.writingBandSummary.combinedOverallBand,null); assert.equal(data.writingBandSummary.estimatedSingleTaskBand,6);
      assert.ok(prompts[0].includes('Norway') && prompts[0].includes('Germany') && prompts[0].includes('Task Achievement'));
      band=7;
      res=await a.request('/api/writing/score',{method:'POST',headers,body:{essay:sampleEssay(250),topic:'Discuss education'}}); data=await res.json();
      assert.equal(res.status,200); assert.equal(data.criteria[0].abbreviation,'TR'); assert.equal(data.taskNumber,2); assert.equal(data.writingBandSummary.combinedOverallBand,6.5);
      const summary=await (await a.request('/api/writing/summary')).json();
      assert.equal(summary.task1Count,1); assert.equal(summary.task2Count,1); assert.equal(summary.latestTask1Band,6); assert.equal(summary.latestTask2Band,7); assert.equal(summary.combinedOverallBand,6.5);
      assert.equal((await (await b.request('/api/writing/summary')).json()).task1Count,0);
      const history=await (await a.request('/api/writing/history')).json(); assert.equal(history[0].taskNumber,1); assert.equal(history[0].topicId,'wt1-ac-bar-01'); assert.equal(history[1].subType,'essay');
      await a.request('/api/placement/results',{method:'POST',body:{id:'task10-placement',score:{correct:4,total:8},estimatedBand:6,sectionBreakdown:{reading:{percentage:80},listening:{percentage:80}}}});
      const diagnostic=await (await a.request('/api/study/diagnostic-status')).json();
      assert.equal(diagnostic.profile.skills.writing,6.5); assert.ok(diagnostic.profile.weakAreas.includes('TA')); assert.ok(diagnostic.recommendedCurriculum.some(u=>u.targetWeakness.includes('TA')));
      res=await a.request('/api/writing/score',{method:'POST',headers,body:{essay:sampleEssay(160),taskNumber:1,topicId:'wt1-gt-letter-01'}}); data=await res.json();
      assert.equal(res.status,200); assert.equal(data.subType,'general'); assert.equal('has_clear_overview' in data,false); assert.ok(prompts.at(-1).includes('Formal') && prompts.at(-1).includes('weekend'));
      res=await a.request('/api/writing/score',{method:'POST',headers,body:{essay:sampleEssay(160),taskNumber:1,visualSummary:'Sales increased from 10 to 20.'}}); assert.equal(res.status,200); assert.ok(prompts.at(-1).includes('Sales increased from 10 to 20.'));
    } finally {globalThis.fetch=originalFetch;}
  });
});

test('Phase 10A summary supports old records, missing scores and chronological latest', async () => {
  const b=browser(), me=await (await b.request('/api/me')).json();
  const file=path.join(testResultsDir,'users',me.userId,'writing_results.json');
  fs.writeFileSync(file,JSON.stringify([
    {id:'task2-new',timestamp:'2026-10-01T00:00:00Z',result:{overall_band:7}},
    {id:'task1-new',timestamp:'2026-10-02T00:00:00Z',taskNumber:1,result:{overall_band:6}},
    {id:'task2-old',timestamp:'2026-01-01T00:00:00Z',taskNumber:2,result:{overall_band:5}},
    {id:'bad-score',timestamp:'2026-10-03T00:00:00Z',taskNumber:1,result:{overall_band:null}}
  ]));
  const summary=await (await b.request('/api/writing/summary')).json();
  assert.equal(summary.task1Count,2); assert.equal(summary.task2Count,2); assert.equal(summary.latestTask1Band,6); assert.equal(summary.latestTask2Band,7); assert.equal(summary.avgTask2Band,6); assert.equal(summary.combinedOverallBand,6.5);
});

test('Phase 10A supports TA mistake contexts in object and shorthand form', async () => {
  await withoutAiProviders(async()=>{
    const b=browser();
    for(const weakestCriterion of [{code:'TA',score:5,feedback:'The overview is missing.'},'TA']) {
      const res=await b.request('/api/study/generate-unit',{method:'POST',headers:{'X-Forwarded-For':'198.51.100.11'},body:{mistakeContext:{source:'writing',recordId:'task1-ta',weakestCriterion}}});
      const data=await res.json(); assert.equal(res.status,200); assert.ok(data.unit.targetWeakness.includes('TA')); assert.ok(data.unit.title.includes('TA'));
    }
  });
});

/* ── Phase 10B: Writing Task 1 frontend ── */
test('Phase 10B writing.html has task tabs, Task 1 visual slot, overall banner and Task 1 result flags', async () => {
  const html = await (await fetch(`${BASE}/writing.html`)).text();
  for (const id of ['writing-task-tabs', 'tab-task2', 'tab-task1-academic', 'tab-task1-general', 'task1-visual-container',
    'task1-visual-filter', 'writing-overall-banner', 'wob-task1', 'wob-task2', 'wob-overall', 'wob-cta',
    'result-task-chip', 'result-overview-chip', 'word-count-min', 'char-limit-text',
    // Phase 2–9B IDs must survive the redesign
    'writing-timer-display', 'word-count-badge', 'char-limit-indicator', 'essay-input', 'btn-submit-essay', 'topic-prompt',
    'results-area', 'criteria-grid', 'history-list', 'btn-create-mistake-unit', 'inline-corrections-list']) {
    assert.ok(html.includes(`id="${id}"`), `writing.html should include #${id}`);
  }
  for (const mode of ['task2', 'task1-academic', 'task1-general']) assert.ok(html.includes(`data-task-mode="${mode}"`), mode);
  assert.match(html, /id="tab-task2"[^>]*aria-selected="true"/, 'Task 2 is the default tab');
  const visual = html.indexOf('id="task1-visual-container"');
  assert.ok(visual > html.indexOf('id="topic-section"') && visual < html.indexOf('id="editor-section"'), 'visual lives inside #topic-section');
  assert.ok(html.indexOf('id="writing-task-tabs"') < html.indexOf('class="writing-layout"'));

  const js = await (await fetch(`${BASE}/js/writing.js`)).text();
  for (const token of ['renderTask1Visual', 'setTaskMode', 'taskNumber: 1', 'subType', 'topicId', 'visualSummary',
    '/api/writing/summary', 'has_clear_overview', 'Task Achievement', 'task1-data-table', 'task1-process',
    "type === 'bar'", "type === 'line'", "type === 'pie'", "type === 'table'", "type === 'process'", "type === 'letter'", "type === 'map'",
    'bulletPoints', 'usefulPhrases', 'overviewSample', 'Task 2 · Essay', 'Task 1 · ', '_escapeHtml']) {
    assert.ok(js.includes(token), `writing.js should include ${token}`);
  }
  // Each mode keeps its own minimum, timer and draft
  assert.match(js, /minWords: 250, minutes: 40/);
  assert.match(js, /minWords: 150, minutes: 20/);
  assert.ok(js.includes('_modeState[_mode].draft = textarea.value'));
  // Task 1 colours come from a fixed palette, never from config strings
  assert.ok(!js.includes('s?.color'), 'series colours must not be read from config data');

  const css = await (await fetch(`${BASE}/css/writing.css`)).text();
  for (const sel of ['.writing-task-tabs', '.writing-overall-banner', '.task1-visual-container', '.task1-data-table', '.task1-process', '.t1-letter', '.t1-map-zones']) {
    assert.ok(css.includes(sel), `writing.css should style ${sel}`);
  }
});

test('Phase 10B renderTask1Visual draws every Task 1 type and escapes untrusted labels', async () => {
  const vm = await import('node:vm');
  const src = await (await fetch(`${BASE}/js/writing.js`)).text();
  const cfg = await (await fetch(`${BASE}/config.json`)).json();
  // Minimal DOM: one container element captures innerHTML.
  const box = { innerHTML: '', hidden: true, replaceChildren() { this.innerHTML = ''; } };
  const ctx = { document: { getElementById: id => id === 'task1-visual-container' ? box : null, addEventListener() {}, querySelectorAll: () => [] },
    console, setTimeout, clearInterval, setInterval, localStorage: { getItem: () => null, setItem() {} } };
  vm.createContext(ctx);
  vm.runInContext(`${src}\nthis.WritingApp = WritingApp;`, ctx);
  const draw = topic => { ctx.WritingApp.renderTask1Visual(topic); return box.innerHTML; };

  const byType = Object.fromEntries(cfg.sampleTask1Topics.map(t => [t.visualType, t]));
  assert.match(draw(byType.bar), /<svg class="t1-svg" viewBox="0 0 680 300"[\s\S]*<path fill="#3987e5"/);
  assert.match(draw(byType.line), /<polyline class="t1-line"[\s\S]*<circle class="t1-dot"/);
  const pie = draw(byType.pie);
  assert.equal((pie.match(/class="t1-pie-title"/g) || []).length, 2, 'two pies');
  assert.match(pie, /<table class="task1-data-table">/);
  const table = draw(byType.table);
  assert.match(table, /<table class="task1-data-table">/);
  assert.ok(table.includes('class="is-max"') && table.includes('class="is-min"'));
  assert.equal((draw(byType.process).match(/class="t1-step"/g) || []).length, byType.process.visualData.steps.length);
  const letter = draw(byType.letter);
  assert.ok((letter.match(/<li>/g) || []).length >= byType.letter.bulletPoints.length);
  assert.ok(letter.includes(`Tone: ${byType.letter.tone}`));
  if (byType.map) assert.equal((draw(byType.map).match(/class="t1-zone"/g) || []).length, byType.map.visualData.zones.length);

  const evil = '<img src=x onerror=alert(1)>"\'';
  const attacks = [
    { visualType: 'bar', taskType: evil, visualData: { title: evil, unit: evil, categories: [evil], series: [{ label: evil, color: 'red" onload="x', values: [5] }] } },
    { visualType: 'line', visualData: { categories: [evil, 'b'], series: [{ label: evil, values: [1, 2] }] } },
    { visualType: 'pie', visualData: { categories: [evil], series: [{ label: evil, values: [100] }] } },
    { visualType: 'table', visualData: { title: evil, columns: [evil, 'n'], rows: [[evil, 1], ['b', 2]] } },
    { visualType: 'process', visualData: { steps: [{ step: evil, title: evil, detail: evil }] } },
    { visualType: 'map', visualData: { beforeLabel: evil, zones: [{ area: evil, before: evil, after: evil, changeType: evil }] } },
    { visualType: 'letter', taskType: evil, tone: evil, bulletPoints: [evil], usefulPhrases: [evil], overviewSample: evil }
  ];
  for (const topic of attacks) {
    const html = draw(topic);
    assert.ok(!html.includes('<img') && !html.includes('onload="x'), `${topic.visualType} must escape labels`);
    assert.ok(html.includes('&lt;img'), `${topic.visualType} renders the escaped text`);
  }
});

test('Phase 10B client Overall Writing summary matches the server formula', async () => {
  const vm = await import('node:vm');
  const ctx = { document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] }, console, localStorage: { getItem: () => null } };
  vm.createContext(ctx);
  vm.runInContext(`${await (await fetch(`${BASE}/js/writing.js`)).text()}\nthis.WritingApp = WritingApp;`, ctx);
  const history = [
    { taskNumber: 1, timestamp: '2026-11-10T00:00:00Z', result: { overall_band: 5 } },
    { taskNumber: 1, timestamp: '2026-11-12T00:00:00Z', overallBand: 6 },          // latest Task 1 (local record shape)
    { timestamp: '2026-11-11T00:00:00Z', result: { overall_band: 7 } }             // legacy record → Task 2
  ];
  const s = JSON.parse(JSON.stringify(ctx.WritingApp.computeWritingSummary(history)));
  assert.equal(s.latestTask1Band, 6);
  assert.equal(s.latestTask2Band, 7);
  assert.equal(s.combinedOverallBand, 6.5);                                      // (6 + 14) / 3 = 6.67 → 6.5
  assert.equal(ctx.WritingApp.computeWritingSummary([history[2]]).combinedOverallBand, null);

  const analytics = await (await fetch(`${BASE}/js/analytics.js`)).text();
  for (const token of ["key: 'TA'", 'computeWritingSummary', 'combinedOverallBand', 'writing-score-meta', 'TA: []']) {
    assert.ok(analytics.includes(token), `analytics.js should include ${token}`);
  }
  const page = await (await fetch(`${BASE}/analytics.html`)).text();
  assert.ok(page.includes('id="writing-score-meta"') && page.includes('TA · TR, CC, LR, GRA'));
});

test('Phase 11B: speaking.html exposes mode tabs, interview room and upgraded results (legacy IDs intact)', async () => {
  const html = await (await fetch(`${BASE}/speaking.html`)).text();
  for (const id of ['topic-section', 'timer-card', 'editor-section', 'speaking-input', 'btn-record', 'btn-submit', 'results-area', 'btn-create-mistake-unit',
    'speaking-mode-tabs', 'tab-speaking-cuecard', 'tab-speaking-interview', 'interview-room-panel', 'interview-stepper', 'examiner-prompt-card',
    'examiner-question-text', 'btn-speak-question', 'btn-toggle-tts', 'btn-next-turn', 'btn-finish-interview', 'examiner-feedback-bubble',
    'interview-transcript-log', 'speaking-result-mode-chip', 'speaking-part-breakdown', 'speaking-inline-corrections', 'speaking-band8-highlights']) {
    assert.ok(html.includes(`id="${id}"`), `speaking.html should include #${id}`);
  }
  assert.ok(/id="tab-speaking-cuecard"[^>]*data-speaking-mode="cuecard"/.test(html));
  assert.ok(/id="tab-speaking-interview"[^>]*data-speaking-mode="interview"/.test(html));
  assert.ok(html.includes('Ghi nhận câu trả lời &amp; Tiếp tục →') && html.includes('Chấm điểm toàn bộ buổi phỏng vấn'));
  assert.ok(/class="speaking-mode-tab active" id="tab-speaking-cuecard"/.test(html));
  const js = await (await fetch(`${BASE}/js/speaking.js`)).text();
  for (const token of ['speechSynthesis', '/api/speaking/examiner-turn', 'Full Interview (Part 1-2-3)', "mode: 'interview'", 'interviewTurns',
    'followUpQuestionEn', 'pronunciationTargets', 'coachingTipVi', 'modelBand8Highlight', 'part_breakdown', 'inline_corrections']) {
    assert.ok(js.includes(token), `speaking.js should include ${token}`);
  }
  assert.ok((await (await fetch(`${BASE}/css/speaking.css`)).text()).includes('.speaking-mode-tab'));
});

test('Phase 11B: interview flow runs Part 1 → 2 → 3, calls the examiner and scores with interviewTurns', async () => {
  const vm = await import('node:vm');
  const make = id => {
    const el = { id, children: [], dataset: {}, style: {}, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, _attrs: {},
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { (on === undefined ? !this._s.has(c) : on) ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = [...c]; },
      get childElementCount() { return this.children.length; },
      setAttribute(k, v) { this._attrs[k] = v; }, addEventListener() {}, scrollIntoView() {}, remove() {} };
    return el;
  };
  const els = {};
  const document = { getElementById: id => (els[id] ??= make(id)), createElement: tag => make(tag), querySelectorAll: () => [], addEventListener() {}, body: make('body') };
  const topic = { id: 'sp-01', category: 'People', part1Topic: 'Teachers', part1: ['P1 a?', 'P1 b?', 'P1 c?'],
    part2: { prompt: 'Describe a teacher.', points: ['who'], closing: 'and why.' }, part3: ['P3 a?', 'P3 b?', 'P3 c?'],
    modelBand8Highlight: ['fostered critical thinking — nuôi dưỡng tư duy phản biện'] };
  const calls = [];
  const spoken = [];
  const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const fakeFetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body });
    const json = data => ({ ok: true, status: 200, json: async () => data });
    if (url === '/api/speaking/config') return json({ sampleTopics: [topic], wordCountRequirements: { min: 40 } });
    if (url === '/api/speaking/history') return json([]);
    if (url === '/api/speaking/examiner-turn') return json({ part: body.part, examinerReplyEn: 'Thank you.', followUpQuestionEn: body.part === 3 ? 'Why is that so?' : 'x', coachingTipVi: 'Mở rộng thêm.', pronunciationTargets: ['pedagogical'] });
    if (url === '/api/speaking/score') return json({ overall_band: 6.5, mode: body.mode, topicId: body.topicId, criteria: [], suggestions: ['s'],
      part_breakdown: { part1: 'P1 ok', part2: 'P2 ok', part3: 'P3 ok' }, inline_corrections: [{ original: 'bad', correction: 'good', explanation: 'why' }, { original: '', correction: 'x' }] });
    throw new Error(`unexpected ${url}`);
  };
  const ctx = { document, console, fetch: fakeFetch, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: () => null, setItem() {} },
    location: {}, window: { speechSynthesis: { cancel() {}, speak(u) { spoken.push(u.text); } }, confirm: () => true, scrollTo() {} },
    SpeechSynthesisUtterance: function (text) { this.text = text; }, navigator: {} };
  ctx.window.document = document;
  vm.createContext(ctx);
  vm.runInContext(`${await (await fetch(`${BASE}/js/speaking.js`)).text()}\nthis.SpeakingApp = SpeakingApp;`, ctx);
  const App = ctx.SpeakingApp;
  await App.init();
  App.setMode('interview');
  assert.equal(els['interview-room-panel'].hidden, false);
  App.startInterview();
  assert.equal(els['examiner-question-text'].textContent, 'P1 a?');
  assert.ok(spoken.includes('P1 a?'), 'question is read aloud via speechSynthesis');
  const answer = async text => { els['speaking-input'].value = text; await App.nextTurn(); };
  await answer(words(15)); await answer(words(15)); await answer(words(15));
  assert.equal(els['examiner-question-text'].textContent, 'Describe a teacher.');
  assert.equal(els['examiner-cue-points'].hidden, false);
  await answer(words(30));
  assert.equal(els['examiner-question-text'].textContent, 'P3 a?');
  await answer(words(20));
  assert.equal(els['examiner-question-text'].textContent, 'Why is that so?', 'Part 3 inserts the AI follow-up question');
  assert.equal(els['examiner-feedback-bubble'].hidden, false);
  assert.ok(els['examiner-feedback-bubble'].children.some(c => c.className === 'pron-targets'));
  els['speaking-input'].value = words(20);
  await App.finishInterview();
  const score = calls.filter(c => c.url === '/api/speaking/score').at(-1).body;
  assert.equal(score.mode, 'interview'); assert.equal(score.part, 'Full Interview (Part 1-2-3)'); assert.equal(score.topicId, 'sp-01');
  assert.deepEqual(score.interviewTurns.map(t => t.part), [1, 1, 1, 2, 3, 3]);
  assert.ok(score.interviewTurns.every(t => t.question && t.answer));
  assert.ok(score.transcript.includes('word0'));
  assert.equal(calls.filter(c => c.url === '/api/speaking/examiner-turn').length, 4, 'examiner is consulted on Part 1 and Part 3 turns, not Part 2');
  assert.equal(els['speaking-result-mode-chip'].textContent, 'Full Mock Interview · Part 1–2–3');
  assert.equal(els['speaking-part-breakdown'].hidden, false);
  assert.equal(els['speaking-part-breakdown-list'].children.length, 3);
  assert.equal(els['speaking-inline-corrections'].hidden, false);
  assert.equal(els['speaking-inline-corrections-list'].children.length, 1, 'invalid corrections are skipped');
  assert.equal(els['speaking-band8-highlights'].hidden, false);
  assert.ok(els['speaking-band8-list'].innerHTML.includes('fostered critical thinking'));
  assert.equal(els['interview-transcript-log'].children.length >= 12, true);
});

test('Phase 11B: createMistakeUnit forwards inline_corrections to AuthProfile', async () => {
  const vm = await import('node:vm');
  let received;
  const el = { style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, scrollIntoView() {}, value: '', children: [],
    replaceChildren() {}, appendChild() {}, append() {}, get childElementCount() { return 0; } };
  const ctx = { document: { getElementById: () => el, createElement: () => ({ ...el }), querySelectorAll: () => [], addEventListener() {} }, console, localStorage: { getItem: () => null }, window: {},
    AuthProfile: { weakestCriterion: () => ({ code: 'FC' }), createMistakeUnit: async c => { received = c; } } };
  vm.createContext(ctx);
  vm.runInContext(`${await (await fetch(`${BASE}/js/speaking.js`)).text()}\nthis.SpeakingApp = SpeakingApp;`, ctx);
  ctx.SpeakingApp.renderResults({ id: 'speak_1', topic: 'T', transcript: 'I am agree with this.', overall_band: 6, criteria: [{ abbreviation: 'FC', score: 6 }],
    suggestions: ['a'], inline_corrections: [{ original: 'I am agree', correction: 'I agree', explanation: 'verb' }, { original: 'x' }] });
  await ctx.SpeakingApp.createMistakeUnit({});
  assert.equal(received.source, 'speaking');
  assert.deepEqual(JSON.parse(JSON.stringify(received.corrections)), [{ original: 'I am agree', correction: 'I agree', explanation: 'verb' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(received.suggestions)), ['a']);
});

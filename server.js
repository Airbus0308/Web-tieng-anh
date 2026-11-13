import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import dns from 'dns/promises';
import { GoogleGenAI } from '@google/genai';

// Initialize environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
const configPath = path.join(__dirname, 'config.json');
let config;
try {
  const configFile = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(configFile);
  console.log(`[INFO] Loaded configuration from ${configPath} (Model: ${config.model})`);
} catch (err) {
  console.error(`[FATAL] Failed to read or parse config.json:`, err);
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Results storage paths
const resultsDir = process.env.IELTS_RESULTS_DIR || path.join(__dirname, 'results');
const resultsFile = path.join(resultsDir, 'writing_results.json');
const placementResultsFile = path.join(resultsDir, 'placement_results.json');
const speakingResultsFile = path.join(resultsDir, 'speaking_results.json');
const runtimeKeysFile = path.join(resultsDir, 'gemini_keys.json');

// Ensure results directory exists
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Only publish application assets. Never expose source, environment, tests or results.
app.get(['/', '/index.html', '/writing.html', '/speaking.html', '/study.html', '/analytics.html'], (req, res) => {
  const page = req.path === '/' ? 'index.html' : req.path.slice(1);
  res.sendFile(path.join(__dirname, page));
});
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/config.json', (req, res) => res.sendFile(configPath));
for (const publicDir of ['css', 'js', 'assets']) {
  app.use(`/${publicDir}`, express.static(path.join(__dirname, publicDir), { dotfiles: 'deny', index: false }));
}

// Shared per-IP rate limit for all AI endpoints: 10 requests per 15 minutes.
const GEMINI_RATE_WINDOW_MS = 15 * 60 * 1000;
const GEMINI_RATE_MAX = 10;
const geminiRateBuckets = new Map();

function geminiRateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const recent = (geminiRateBuckets.get(ip) || []).filter(ts => now - ts < GEMINI_RATE_WINDOW_MS);
  if (recent.length >= GEMINI_RATE_MAX) {
    const retryAfter = Math.max(1, Math.ceil((GEMINI_RATE_WINDOW_MS - (now - recent[0])) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Too many AI requests from this IP. Please try again later.',
      retryAfterSeconds: retryAfter
    });
  }
  recent.push(now);
  geminiRateBuckets.set(ip, recent);
  next();
}

app.use(['/api/writing/score', '/api/speaking/score', '/api/analytics/roadmap', '/api/analytics/study-plan'], geminiRateLimit);

// Study Hub has its own, more generous bucket (a unit = several calls): 30 requests per 15 minutes per IP.
const STUDY_RATE_MAX = 30;
const studyRateBuckets = new Map();

function studyRateLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const recent = (studyRateBuckets.get(ip) || []).filter(ts => now - ts < GEMINI_RATE_WINDOW_MS);
  if (recent.length >= STUDY_RATE_MAX) {
    const retryAfter = Math.max(1, Math.ceil((GEMINI_RATE_WINDOW_MS - (now - recent[0])) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many Study Hub requests from this IP. Please try again later.', retryAfterSeconds: retryAfter });
  }
  recent.push(now);
  studyRateBuckets.set(ip, recent);
  next();
}

app.use(['/api/study/generate-unit', '/api/study/evaluate-mini', '/api/study/extract-source'], studyRateLimit);

/**
 * Helper to count words in a string
 */
function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.trim()) return [];
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : [];
}

function writeJsonArray(filePath, records) {
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
}

function readExamIntegrity(req) {
  let supplied = req.body?.integrity;
  if (supplied == null && typeof req.get('X-Exam-Integrity') === 'string') {
    const header = req.get('X-Exam-Integrity');
    if (header.length > 4096) return null;
    try { supplied = JSON.parse(header); } catch { return null; }
  }
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1000000) : 0;
  const tabSwitches = count(supplied.tabSwitches);
  const pasteAttempts = count(supplied.pasteAttempts);
  const keystrokes = count(supplied.keystrokes);
  const wpm = Number.isFinite(supplied.wpm) && supplied.wpm >= 0
    ? Math.min(Math.round(supplied.wpm), 1000) : 0;
  const burstDetected = supplied.burstDetected === true;
  return {
    tabSwitches, pasteAttempts, keystrokes, wpm, burstDetected,
    flagged: tabSwitches > 0 || pasteAttempts > 0 || burstDetected
  };
}

function parseGeminiJson(response) {
  let rawText = (response?.text || '').trim();
  if (rawText.startsWith('```json')) rawText = rawText.slice(7);
  else if (rawText.startsWith('```')) rawText = rawText.slice(3);
  if (rawText.endsWith('```')) rawText = rawText.slice(0, -3);
  rawText = rawText.trim();
  try {
    return JSON.parse(rawText);
  } catch (err) {
    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
    }
    throw err;
  }
}

/* ── 3-Tier Multi-Provider & Auto-Rotation Engine ──────────────
 *
 * Tier 1: Google Gemini API Key Pool (rotates across multiple Gemini keys on 429)
 * Tier 2: GitHub Models (Official Azure AI Inference gpt-4o-mini via GitHub PAT)
 * Tier 3: Pollinations.ai Zero-Key Free AI Fallback (works immediately without any key)
 */

const KEY_COOLDOWN_MS = 60 * 1000;
const keyCooldownUntil = new Map();
let roundRobinCursor = 0;

function splitKeyString(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[\n,;]+/)
    .map(k => k.trim())
    .filter(Boolean);
}

function isGitHubToken(key) {
  return /^(ghp_|github_pat_|gho_|ghs_)/i.test(String(key || '').trim());
}

function maskApiKey(key) {
  const k = String(key || '').trim();
  if (k.length <= 10) return '••••' + k.slice(-3);
  return `${k.slice(0, 6)}••••••••${k.slice(-4)}`;
}

function getEnvGeminiKeys() {
  return [
    ...splitKeyString(process.env.GEMINI_API_KEYS || ''),
    ...splitKeyString(process.env.GEMINI_API_KEY || '')
  ].filter(k => !isGitHubToken(k));
}

function getEnvGitHubTokens() {
  return [
    ...splitKeyString(process.env.GITHUB_TOKENS || ''),
    ...splitKeyString(process.env.GITHUB_TOKEN || ''),
    ...splitKeyString(process.env.GEMINI_API_KEYS || '').filter(isGitHubToken)
  ];
}

function getRuntimeStoredKeys() {
  try {
    return readJsonArray(runtimeKeysFile).filter(k => typeof k === 'string' && k.trim());
  } catch {
    return [];
  }
}

function saveRuntimeStoredKeys(keys) {
  const unique = [...new Set(keys.map(k => String(k || '').trim()).filter(Boolean))];
  writeJsonArray(runtimeKeysFile, unique);
  return unique;
}

function collectProviderKeys(req) {
  const headerRaw = [
    ...splitKeyString(req?.headers?.['x-gemini-api-key'] || ''),
    ...splitKeyString(req?.headers?.['x-github-token'] || '')
  ];
  const bodyRaw = Array.isArray(req?.body?.apiKeys)
    ? req.body.apiKeys.flatMap(splitKeyString)
    : splitKeyString(req?.body?.apiKey || '');
  const runtimeRaw = getRuntimeStoredKeys();

  const allUserSupplied = [...headerRaw, ...bodyRaw, ...runtimeRaw];
  const userGemini = allUserSupplied.filter(k => !isGitHubToken(k));
  const userGitHub = allUserSupplied.filter(isGitHubToken);

  const geminiKeys = [...new Set([...userGemini, ...getEnvGeminiKeys()])];
  const githubTokens = [...new Set([...userGitHub, ...getEnvGitHubTokens()])];

  return { geminiKeys, githubTokens };
}

function buildKeyPoolStatus() {
  const now = Date.now();
  const envGemini = getEnvGeminiKeys();
  const envGitHub = getEnvGitHubTokens();
  const runtimeRaw = getRuntimeStoredKeys();
  const seen = new Set();
  const list = [];

  for (const k of [...runtimeRaw, ...envGemini, ...envGitHub]) {
    if (seen.has(k)) continue;
    seen.add(k);
    const cooldownAt = keyCooldownUntil.get(k) || 0;
    const tier = isGitHubToken(k) ? 'Tier 2 · GitHub Models' : 'Tier 1 · Gemini';
    list.push({
      masked: maskApiKey(k),
      tier,
      source: runtimeRaw.includes(k) ? 'runtime' : 'env',
      status: cooldownAt > now ? 'cooldown' : 'ready'
    });
  }

  return {
    totalKeys: list.length,
    activeKeys: list.filter(x => x.status === 'ready').length,
    tiers: {
      tier1GeminiCount: list.filter(x => x.tier.startsWith('Tier 1')).length,
      tier2GitHubCount: list.filter(x => x.tier.startsWith('Tier 2')).length,
      tier3PollinationsFree: process.env.DISABLE_FREE_FALLBACK !== 'true'
    },
    keys: list
  };
}

/**
 * GET /api/settings/keys
 * Returns masked status of all configured keys & 3-tier fallback configuration.
 */
app.get('/api/settings/keys', (req, res) => {
  res.json(buildKeyPoolStatus());
});

/**
 * POST /api/settings/keys
 * Adds one or multiple Gemini API keys or GitHub PATs to the server's runtime rotation pool.
 */
app.post('/api/settings/keys', (req, res) => {
  const rawInput = req.body?.keys ?? req.body?.apiKey ?? '';
  const incoming = Array.isArray(rawInput)
    ? rawInput.flatMap(splitKeyString)
    : splitKeyString(String(rawInput));

  if (!incoming.length) {
    return res.status(400).json({ error: 'At least one valid API key is required.' });
  }

  const existing = getRuntimeStoredKeys();
  saveRuntimeStoredKeys([...existing, ...incoming]);
  return res.status(200).json(buildKeyPoolStatus());
});

/**
 * DELETE /api/settings/keys
 * Clears runtime-added API keys.
 */
app.delete('/api/settings/keys', (req, res) => {
  saveRuntimeStoredKeys([]);
  keyCooldownUntil.clear();
  return res.status(200).json(buildKeyPoolStatus());
});

/**
 * Tier 2 Caller: GitHub Models (Azure AI Inference Endpoint)
 */
async function callGitHubModels(token, promptText) {
  const res = await fetch('https://models.inference.ai.azure.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an official IELTS examiner. Respond ONLY with a valid JSON object matching the exact schema requested.' },
        { role: 'user', content: promptText }
      ],
      temperature: 0.3
    })
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const err = new Error(`GitHub Models HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text.trim()) {
    throw new Error('GitHub Models returned an empty response.');
  }
  return { text };
}

/**
 * Tier 3 Caller: Pollinations.ai Zero-Key Free OpenAI-Compatible Endpoint
 */
async function callPollinationsFree(promptText) {
  const res = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'openai',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an official IELTS examiner. Respond ONLY with a raw, valid JSON object matching the exact schema requested. Do not wrap in markdown.' },
        { role: 'user', content: promptText }
      ]
    })
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Pollinations Free AI returned HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
  }

  const rawBody = await res.text();
  try {
    const parsedEnvelope = JSON.parse(rawBody);
    if (parsedEnvelope?.choices?.[0]?.message?.content) {
      return { text: parsedEnvelope.choices[0].message.content };
    }
  } catch {
    // If Pollinations returned direct JSON content instead of OpenAI envelope
  }
  return { text: rawBody };
}

/**
 * 3-Tier Multi-Provider Execution with Key Pool Auto-Rotation:
 *  - Tier 1: Google Gemini Key Pool (rotates through all available Gemini keys on 429/quota)
 *  - Tier 2: GitHub Models Pool (rotates through GitHub PATs on 429/quota)
 *  - Tier 3: Pollinations.ai Zero-Key Free AI Fallback
 */
async function generateWithKeyPool(req, promptText) {
  const { geminiKeys, githubTokens } = collectProviderKeys(req);
  const now = Date.now();
  const errors = [];

  // ── TIER 1: Google Gemini Key Pool ─────────────────────────────
  if (geminiKeys.length > 0) {
    const rotated = [];
    for (let i = 0; i < geminiKeys.length; i++) {
      rotated.push(geminiKeys[(roundRobinCursor + i) % geminiKeys.length]);
    }
    roundRobinCursor = (roundRobinCursor + 1) % geminiKeys.length;

    const readyKeys = rotated.filter(k => (keyCooldownUntil.get(k) || 0) <= now);
    const cooldownKeys = rotated.filter(k => (keyCooldownUntil.get(k) || 0) > now);
    const orderedGemini = [...readyKeys, ...cooldownKeys];

    for (let idx = 0; idx < orderedGemini.length; idx++) {
      const apiKey = orderedGemini[idx];
      const ai = new GoogleGenAI({ apiKey });
      const maxAttemptsForThisKey = orderedGemini.length > 1 ? 1 : 2;

      try {
        const response = await generateWithRetry(ai, {
          model: config.model,
          contents: promptText,
          config: { responseMimeType: 'application/json' }
        }, maxAttemptsForThisKey);

        keyCooldownUntil.delete(apiKey);
        return {
          response,
          provider: 'Tier 1: Google Gemini',
          usedKeyMasked: maskApiKey(apiKey)
        };
      } catch (err) {
        errors.push(`Gemini(${maskApiKey(apiKey)}): ${err?.status || err?.message}`);
        keyCooldownUntil.set(apiKey, Date.now() + KEY_COOLDOWN_MS);
        console.warn(`[WARN] [Tier 1] Gemini key ${maskApiKey(apiKey)} failed (${err?.status || err?.message}). Rotating...`);
      }
    }
  }

  // ── TIER 2: GitHub Models (Official Azure AI Inference) ────────
  if (githubTokens.length > 0) {
    const readyTokens = githubTokens.filter(t => (keyCooldownUntil.get(t) || 0) <= now);
    const cooldownTokens = githubTokens.filter(t => (keyCooldownUntil.get(t) || 0) > now);
    const orderedTokens = [...readyTokens, ...cooldownTokens];

    for (const token of orderedTokens) {
      try {
        console.log(`[INFO] [Tier 2] Attempting GitHub Models with token ${maskApiKey(token)}...`);
        const response = await callGitHubModels(token, promptText);
        keyCooldownUntil.delete(token);
        return {
          response,
          provider: 'Tier 2: GitHub Models (gpt-4o-mini)',
          usedKeyMasked: maskApiKey(token)
        };
      } catch (err) {
        errors.push(`GitHubModels(${maskApiKey(token)}): ${err?.status || err?.message}`);
        keyCooldownUntil.set(token, Date.now() + KEY_COOLDOWN_MS);
        console.warn(`[WARN] [Tier 2] GitHub token ${maskApiKey(token)} failed (${err?.message}). Rotating...`);
      }
    }
  }

  // ── TIER 3: Pollinations.ai (Zero-Key Free AI Fallback) ────────
  if (process.env.DISABLE_FREE_FALLBACK !== 'true') {
    try {
      console.log(`[INFO] [Tier 3] Falling back to Pollinations.ai Zero-Key Free AI...`);
      const response = await callPollinationsFree(promptText);
      return {
        response,
        provider: 'Tier 3: Pollinations Free AI (Zero-Key)',
        usedKeyMasked: 'zero-key-fallback'
      };
    } catch (err) {
      errors.push(`PollinationsFree: ${err?.message}`);
      console.error(`[ERROR] [Tier 3] Pollinations Free AI fallback failed:`, err.message);
    }
  }

  if (!geminiKeys.length && !githubTokens.length) {
    return { missingKey: true, errors };
  }

  throw new Error(`All AI tiers failed: ${errors.join(' | ')}`);
}

/**
 * Call Gemini, retrying temporary failures (HTTP 429 rate limit / 503 overloaded).
 * Waits 2s, 4s, 8s between attempts.
 */
async function generateWithRetry(ai, request, maxAttempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ai.models.generateContent(request);
    } catch (err) {
      const status = err?.status ?? err?.code;
      const retryable = status === 429 || status === 503 || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(err?.message || '');
      if (!retryable || attempt >= maxAttempts) throw err;
      const delay = 2000 * 2 ** (attempt - 1);
      console.warn(`[WARN] Gemini busy (${status}), retry ${attempt}/${maxAttempts - 1} in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Helper to build evaluation prompt for Gemini
 */
function buildEvaluationPrompt(essay, topic) {
  const criteriaList = Object.entries(config.scoringCriteria)
    .map(([key, item]) => {
      return `### ${item.name} (${item.abbreviation}) [Weight: ${Math.round(item.weight * 100)}%]:\n${item.prompt}`;
    })
    .join('\n\n');

  const responseFormatStr = typeof config.responseFormat === 'string'
    ? config.responseFormat
    : JSON.stringify(config.responseFormat, null, 2);

  return `
${config.systemInstruction}

============================================================
CRITERIA FOR EVALUATION:
============================================================
${criteriaList}

============================================================
RESPONSE FORMAT INSTRUCTIONS:
============================================================
${responseFormatStr}

Respond ONLY with a valid JSON object matching the requested schema. Do NOT enclose in markdown code block markers (like \`\`\`json) and do not output any conversational prelude or epilogue.

============================================================
ESSAY SUBMISSION FOR EVALUATION:
============================================================
Topic / Writing Task:
${topic ? topic.trim() : 'IELTS Writing Task 2 Essay'}

Candidate's Essay (${countWords(essay)} words):
"""
${essay.trim()}
"""
`.trim();
}

/**
 * GET /api/writing/config
 * Exposes prompt config, sample topics, and requirements for UI consumption
 */
app.get('/api/writing/config', (req, res) => {
  res.json({
    model: config.model,
    wordCountRequirements: config.wordCountRequirements,
    sampleTopics: config.sampleTopics,
    criteria: Object.values(config.scoringCriteria).map(c => ({
      name: c.name,
      abbreviation: c.abbreviation,
      weight: c.weight
    }))
  });
});

/** Save a Placement Test attempt, de-duplicated by its client-generated id. */
app.post('/api/placement/results', (req, res) => {
  try {
    const result = req.body;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return res.status(400).json({ error: 'A placement result object is required.' });
    }
    if (!result.score || !Number.isFinite(Number(result.score.total)) ||
        !Number.isFinite(Number(result.score.correct)) || result.estimatedBand == null) {
      return res.status(400).json({ error: 'score and estimatedBand are required.' });
    }

    const history = readJsonArray(placementResultsFile);
    const requestedId = typeof result.id === 'string' && result.id.trim() ? result.id.trim() : null;
    const existing = requestedId && history.find(item => item.id === requestedId);
    if (existing) return res.status(200).json(existing);

    const integrity = readExamIntegrity(req);
    const { integrity: _untrustedIntegrity, ...safeResult } = result;
    const record = {
      ...safeResult,
      ...(integrity ? { integrity } : {}),
      id: requestedId || `attempt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: result.timestamp || new Date().toISOString()
    };
    history.push(record);
    writeJsonArray(placementResultsFile, history);
    return res.status(201).json(record);
  } catch (err) {
    console.error('[ERROR] Failed to save placement result:', err);
    return res.status(500).json({ error: 'Failed to save placement result.', details: err.message });
  }
});

/** Return all Placement Test attempts. */
app.get('/api/placement/history', (req, res) => {
  try {
    return res.json(readJsonArray(placementResultsFile));
  } catch (err) {
    console.error('[ERROR] Failed to fetch placement history:', err);
    return res.status(500).json({ error: 'Failed to retrieve placement history.', details: err.message });
  }
});

/** Generate a personalized study roadmap from the learner's aggregated weaknesses. */
async function handleAnalyticsRoadmap(req, res) {
  try {
    const { weakAreas, summary = {} } = req.body || {};
    if (!Array.isArray(weakAreas) || weakAreas.length === 0) {
      return res.status(400).json({ error: 'weakAreas must be a non-empty array.' });
    }

    const basePrompt = config.studyPlanPrompt || config.analyticsRoadmapPrompt;
    const prompt = `${basePrompt}\n\nLearner summary:\n${JSON.stringify(summary, null, 2)}\n\nWeak areas:\n${JSON.stringify(weakAreas, null, 2)}`;

    const gen = await generateWithKeyPool(req, prompt);
    if (gen.missingKey) {
      return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing.' });
    }

    const parsed = parseGeminiJson(gen.response);
    return res.json({ ...parsed, provider: gen.provider });
  } catch (err) {
    console.error('[ERROR] Failed to generate analytics roadmap:', err);
    return res.status(500).json({ error: 'Failed to generate a study roadmap.', details: err.message });
  }
}

app.post('/api/analytics/roadmap', handleAnalyticsRoadmap);
app.post('/api/analytics/study-plan', handleAnalyticsRoadmap);

/**
 * POST /api/writing/score
 * Evaluates an IELTS Writing Task 2 essay using 3-Tier Multi-Provider Engine
 */
app.post('/api/writing/score', async (req, res) => {
  try {
    const { essay, topic } = req.body;
    const integrity = readExamIntegrity(req);

    // Validate essay presence
    if (!essay || typeof essay !== 'string' || !essay.trim()) {
      return res.status(400).json({
        error: 'Essay text is required.'
      });
    }

    // Validate word count
    const wordCount = countWords(essay);
    const minWords = config.wordCountRequirements?.min || 250;
    if (wordCount < minWords) {
      return res.status(400).json({
        error: `Essay does not meet the minimum word count of ${minWords} words (current: ${wordCount} words).`,
        wordCount,
        minRequired: minWords
      });
    }

    const promptText = buildEvaluationPrompt(essay, topic);
    const gen = await generateWithKeyPool(req, promptText);
    if (gen.missingKey) {
      console.error('[ERROR] No AI provider available.');
      return res.status(500).json({
        error: 'Server configuration error: GEMINI_API_KEY is missing.'
      });
    }

    console.log(`[INFO] Evaluated essay (${wordCount} words) via ${gen.provider} [${gen.usedKeyMasked}]`);

    let result;
    try {
      result = parseGeminiJson(gen.response);
    } catch (parseErr) {
      console.error('[ERROR] Failed to parse AI response as JSON.');
      return res.status(502).json({
        error: 'Failed to parse assessment result from AI as JSON.',
        raw: gen.response?.text || ''
      });
    }

    // Keep only corrections that point to text actually present in this essay.
    result.inline_corrections = Array.isArray(result.inline_corrections)
      ? result.inline_corrections.filter(item =>
        item && typeof item.original === 'string' && item.original.trim() &&
        essay.includes(item.original) && typeof item.correction === 'string' &&
        item.correction.trim() && typeof item.explanation === 'string')
      : [];

    // Prepare log record
    const record = {
      id: `eval_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      topic: topic ? topic.trim() : null,
      wordCount,
      provider: gen.provider,
      essay: essay.trim(),
      ...(integrity ? { integrity } : {}),
      result
    };

    // Append to local results/writing_results.json
    try {
      const history = readJsonArray(resultsFile);
      history.push(record);
      writeJsonArray(resultsFile, history);
      console.log(`[INFO] Saved evaluation record ${record.id} to ${resultsFile}`);
    } catch (storageErr) {
      console.warn(`[WARN] Failed to save evaluation to ${resultsFile}:`, storageErr.message);
    }

    // Return the parsed scoring result along with metadata
    return res.status(200).json({
      ...result,
      provider: gen.provider,
      id: record.id,
      timestamp: record.timestamp,
      wordCount,
      ...(integrity ? { integrity } : {})
    });

  } catch (error) {
    console.error('[ERROR] Error processing writing evaluation:', error);
    return res.status(500).json({
      error: 'An error occurred while evaluating the essay.',
      details: error.message
    });
  }
});

/**
 * GET /api/writing/history
 * Returns past writing results from results/writing_results.json
 */
app.get('/api/writing/history', (req, res) => {
  try {
    return res.json(readJsonArray(resultsFile));
  } catch (err) {
    console.error('[ERROR] Failed to fetch writing history:', err);
    return res.status(500).json({
      error: 'Failed to retrieve writing evaluation history.',
      details: err.message
    });
  }
});

/**
 * Build the Gemini prompt for IELTS Speaking Part 2/3 evaluation (all text lives in config.json)
 */
function buildSpeakingPrompt(transcript, topic, part) {
  const criteriaList = Object.values(config.speakingCriteria)
    .map(item => `### ${item.name} (${item.abbreviation}) [Weight: ${Math.round(item.weight * 100)}%]:\n${item.prompt}`)
    .join('\n\n');
  const responseFormatStr = typeof config.speakingResponseFormat === 'string'
    ? config.speakingResponseFormat
    : JSON.stringify(config.speakingResponseFormat, null, 2);

  return `
${config.speakingSystemInstruction}

============================================================
CRITERIA FOR EVALUATION:
============================================================
${criteriaList}

============================================================
RESPONSE FORMAT INSTRUCTIONS:
============================================================
${responseFormatStr}

Respond ONLY with a valid JSON object matching the requested schema. Do NOT enclose in markdown code block markers and do not output any conversational prelude or epilogue.

============================================================
SPEAKING SUBMISSION FOR EVALUATION:
============================================================
Part: ${part || 'Part 2 (Cue Card) & Part 3'}
Topic / Cue Card:
${topic ? topic.trim() : 'IELTS Speaking Part 2'}

Candidate's transcript (${countWords(transcript)} words):
"""
${transcript.trim()}
"""
`.trim();
}

/**
 * GET /api/speaking/config
 */
app.get('/api/speaking/config', (req, res) => {
  res.json({
    model: config.model,
    wordCountRequirements: config.speakingWordCountRequirements,
    sampleTopics: config.sampleSpeakingTopics,
    criteria: Object.values(config.speakingCriteria).map(c => ({
      name: c.name,
      abbreviation: c.abbreviation,
      weight: c.weight
    }))
  });
});

/**
 * POST /api/speaking/score
 * Evaluates an IELTS Speaking transcript (min 40 words) with 3-Tier AI Engine and stores the result.
 */
app.post('/api/speaking/score', async (req, res) => {
  try {
    const { transcript, topic, part, durationSeconds } = req.body || {};
    const integrity = readExamIntegrity(req);
    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'Speaking transcript is required.' });
    }
    const wordCount = countWords(transcript);
    const minWords = config.speakingWordCountRequirements?.min || 40;
    if (wordCount < minWords) {
      return res.status(400).json({
        error: `Transcript does not meet the minimum word count of ${minWords} words (current: ${wordCount} words).`,
        wordCount,
        minRequired: minWords
      });
    }

    const gen = await generateWithKeyPool(req, buildSpeakingPrompt(transcript, topic, part));
    if (gen.missingKey) {
      console.error('[ERROR] No AI provider available.');
      return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing.' });
    }

    console.log(`[INFO] Evaluated speaking transcript (${wordCount} words) via ${gen.provider} [${gen.usedKeyMasked}]`);

    let result;
    try {
      result = parseGeminiJson(gen.response);
    } catch (parseErr) {
      console.error('[ERROR] Failed to parse AI speaking response as JSON.');
      return res.status(502).json({ error: 'Failed to parse assessment result from AI as JSON.', raw: gen.response?.text });
    }

    const record = {
      id: `speak_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      topic: topic ? String(topic).trim() : null,
      part: part ? String(part) : null,
      wordCount,
      durationSeconds: Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : null,
      provider: gen.provider,
      transcript: transcript.trim(),
      ...(integrity ? { integrity } : {}),
      result
    };
    try {
      const history = readJsonArray(speakingResultsFile);
      history.push(record);
      writeJsonArray(speakingResultsFile, history);
    } catch (storageErr) {
      console.warn(`[WARN] Failed to save speaking evaluation:`, storageErr.message);
    }

    return res.status(200).json({ ...result, provider: gen.provider, id: record.id, timestamp: record.timestamp, wordCount,
      ...(integrity ? { integrity } : {}) });
  } catch (error) {
    console.error('[ERROR] Error processing speaking evaluation:', error);
    return res.status(500).json({ error: 'An error occurred while evaluating the speaking response.', details: error.message });
  }
});

/**
 * GET /api/speaking/history
 */
app.get('/api/speaking/history', (req, res) => {
  try {
    return res.json(readJsonArray(speakingResultsFile));
  } catch (err) {
    console.error('[ERROR] Failed to fetch speaking history:', err);
    return res.status(500).json({ error: 'Failed to retrieve speaking evaluation history.', details: err.message });
  }
});

/* ── Phase 7: Astra-style Study Hub ───────────────────────────── */

const studyProgressFile = path.join(resultsDir, 'study_progress.json');
const MASTERY_LEVELS = [0, 20, 40, 60, 80, 100];
const MAX_SOURCE_CHARS = 12000;
const MAX_FETCH_BYTES = 2 * 1024 * 1024;

/** Reject if `promise` takes longer than `ms` (the underlying AI call is abandoned, not cancelled). */
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms).unref();
  })
]);

const findTextbookUnit =(textbookId, unitId) => {
  const book = (config.sampleTextbooks || []).find(b => b.id === textbookId);
  const unit = book?.units?.find(u => u.id === unitId);
  return book && unit ? { book, unit } : null;
};

/** Validate and normalise a unit (AI output or fallback) to the 5-step schema; returns null if unusable. */
function normalizeStudyUnit(raw, fallbackTitle) {
  if (!raw || typeof raw !== 'object') return null;
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const lesson = raw.lesson;
  if (!lesson || !str(lesson.explanationEn) && !str(lesson.explanationVi)) return null;
  const flashcards = (Array.isArray(raw.flashcards) ? raw.flashcards : [])
    .filter(c => c && str(c.front) && str(c.back))
    .slice(0, 6)
    .map(c => ({ front: str(c.front), back: str(c.back), example: str(c.example) }));
  const quiz = (Array.isArray(raw.quiz) ? raw.quiz : [])
    .filter(q => q && str(q.question) && Array.isArray(q.options) && q.options.length >= 2 &&
      Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)
    .slice(0, 6)
    .map(q => ({
      type: q.type === 'tf' ? 'tf' : 'mcq', question: str(q.question),
      options: q.options.map(o => String(o)), answer: q.answer, explanation: str(q.explanation)
    }));
  const drill = (Array.isArray(raw.drill) ? raw.drill : [])
    .filter(d => d && str(d.sentence || d.instruction) && Array.isArray(d.options) && d.options.length >= 2 &&
      Number.isInteger(d.answer) && d.answer >= 0 && d.answer < d.options.length)
    .slice(0, 5)
    .map(d => ({
      instruction: str(d.instruction), sentence: str(d.sentence),
      options: d.options.map(o => String(o)), answer: d.answer, explanation: str(d.explanation)
    }));
  const ch = raw.challenge;
  if (flashcards.length < 4 || quiz.length < 4 || drill.length < 3 || !ch || !str(ch.prompt)) return null;
  return {
    title: str(raw.title) || fallbackTitle || 'Study Unit',
    lesson: {
      titleEn: str(lesson.titleEn), titleVi: str(lesson.titleVi),
      explanationEn: str(lesson.explanationEn), explanationVi: str(lesson.explanationVi),
      formulas: Array.isArray(lesson.formulas) ? lesson.formulas.map(String).slice(0, 8) : [],
      commonMistakes: (Array.isArray(lesson.commonMistakes) ? lesson.commonMistakes : [])
        .filter(m => m && str(m.wrong)).slice(0, 6)
        .map(m => ({ wrong: str(m.wrong), right: str(m.right), noteVi: str(m.noteVi) }))
    },
    flashcards, quiz, drill,
    challenge: {
      prompt: str(ch.prompt),
      minWords: Number.isFinite(Number(ch.minWords)) ? Number(ch.minWords) : 50,
      maxWords: Number.isFinite(Number(ch.maxWords)) ? Number(ch.maxWords) : 80,
      targetWords: Array.isArray(ch.targetWords) ? ch.targetWords.map(String).slice(0, 6) : []
    }
  };
}

/** GET /api/study/config — textbook library, mastery steps and limits for the Study Hub UI. */
app.get('/api/study/config', (req, res) => {
  res.json({
    model: config.model,
    masterySteps: config.masterySteps || [],
    sampleTextbooks: config.sampleTextbooks || [],
    limits: { maxSourceChars: MAX_SOURCE_CHARS, minSourceChars: 50 }
  });
});

/** GET /api/study/progress — mastery records saved from the Study Hub. */
app.get('/api/study/progress', (req, res) => {
  try {
    return res.json(readJsonArray(studyProgressFile));
  } catch (err) {
    console.error('[ERROR] Failed to read study progress:', err);
    return res.status(500).json({ error: 'Failed to retrieve study progress.', details: err.message });
  }
});

/** POST /api/study/progress — upsert a unit's mastery (0/20/40/60/80/100), never lowering a saved value. */
app.post('/api/study/progress', (req, res) => {
  try {
    const { unitId, title, source, mastery, steps, miniScore } = req.body || {};
    if (typeof unitId !== 'string' || !unitId.trim() || unitId.length > 120) {
      return res.status(400).json({ error: 'unitId is required.' });
    }
    if (!MASTERY_LEVELS.includes(Number(mastery))) {
      return res.status(400).json({ error: 'mastery must be one of 0, 20, 40, 60, 80, 100.' });
    }
    const history = readJsonArray(studyProgressFile);
    const index = history.findIndex(item => item.unitId === unitId.trim());
    const previous = index >= 0 ? history[index] : null;
    const record = {
      unitId: unitId.trim(),
      title: typeof title === 'string' ? title.slice(0, 200) : (previous?.title || ''),
      source: typeof source === 'string' ? source.slice(0, 40) : (previous?.source || 'textbook'),
      mastery: Math.max(Number(mastery), previous?.mastery || 0),
      steps: Array.isArray(steps) ? steps.filter(n => Number.isInteger(n) && n >= 1 && n <= 5) : (previous?.steps || []),
      miniScore: miniScore != null && Number.isFinite(Number(miniScore)) ? Number(miniScore) : (previous?.miniScore ?? null),
      updatedAt: new Date().toISOString()
    };
    if (index >= 0) history[index] = record; else history.push(record);
    writeJsonArray(studyProgressFile, history);
    return res.status(200).json(record);
  } catch (err) {
    console.error('[ERROR] Failed to save study progress:', err);
    return res.status(500).json({ error: 'Failed to save study progress.', details: err.message });
  }
});

/* ── Source extraction (text / article URL / YouTube) with SSRF protection ── */

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return true;
}

async function assertPublicUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw Object.assign(new Error('Invalid URL.'), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Only http and https URLs are supported.'), { status: 400 });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw Object.assign(new Error('Local addresses are not allowed.'), { status: 400 });
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) {
    throw Object.assign(new Error('This address is not allowed.'), { status: 400 });
  }
  return url;
}

/** Fetch a public page (manual redirects re-validated, 10s timeout, 2 MB cap). */
async function safeFetchText(rawUrl, maxRedirects = 3) {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StudyHubBot/1.0)', 'Accept-Language': 'en' }
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`Source returned HTTP ${res.status}.`), { status: 502 });
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_FETCH_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    return { text: Buffer.concat(chunks).toString('utf-8'), finalUrl: url.toString() };
  }
  throw Object.assign(new Error('Too many redirects.'), { status: 502 });
}

const decodeEntities = s => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32));

function htmlToText(html) {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
  const body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body).replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { title, text };
}

function parseYouTubeId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com') {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/);
      return m ? m[1] : null;
    }
  } catch { /* not a URL */ }
  return null;
}

async function extractYouTubeTranscript(videoId) {
  const page = await safeFetchText(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
  const marker = 'ytInitialPlayerResponse = ';
  const start = page.text.indexOf(marker);
  if (start === -1) throw Object.assign(new Error('Could not read this YouTube video.'), { status: 502 });
  const jsonStart = start + marker.length;
  const jsonEnd = page.text.indexOf(';var ', jsonStart) > -1 ? page.text.indexOf(';var ', jsonStart) : page.text.indexOf('</script>', jsonStart);
  let player;
  try { player = JSON.parse(page.text.slice(jsonStart, jsonEnd).trim().replace(/;$/, '')); }
  catch { throw Object.assign(new Error('Could not parse YouTube player data.'), { status: 502 }); }
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track = tracks.find(t => /^en/i.test(t.languageCode)) || tracks[0];
  if (!track?.baseUrl) {
    throw Object.assign(new Error('This video has no captions. Please paste the transcript manually.'), { status: 422 });
  }
  const captionUrl = new URL(track.baseUrl);
  if (!/(^|\.)youtube\.com$/.test(captionUrl.hostname)) throw Object.assign(new Error('Unexpected caption host.'), { status: 502 });
  captionUrl.searchParams.set('fmt', 'json3');
  const captions = await safeFetchText(captionUrl.toString());
  let text;
  try {
    text = JSON.parse(captions.text).events.flatMap(e => (e.segs || []).map(s => s.utf8 || '')).join(' ');
  } catch {
    text = decodeEntities(captions.text.replace(/<[^>]+>/g, ' '));
  }
  return { title: player?.videoDetails?.title || 'YouTube video', text: text.replace(/\s+/g, ' ').trim() };
}

/**
 * POST /api/study/extract-source
 * Body: { text } (pasted notes / uploaded .txt/.md content) or { url } (English article or YouTube).
 */
app.post('/api/study/extract-source', async (req, res) => {
  try {
    const { text, url, title } = req.body || {};
    let result;
    if (typeof text === 'string' && text.trim()) {
      result = { sourceType: 'text', title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Personal notes', text: text.trim() };
    } else if (typeof url === 'string' && url.trim()) {
      const videoId = parseYouTubeId(url.trim());
      if (videoId) {
        const yt = await extractYouTubeTranscript(videoId);
        result = { sourceType: 'youtube', title: yt.title, text: yt.text };
      } else {
        const page = await safeFetchText(url.trim());
        const parsed = htmlToText(page.text);
        result = { sourceType: 'article', title: parsed.title || 'Web article', text: parsed.text };
      }
    } else {
      return res.status(400).json({ error: 'Provide either "text" or "url".' });
    }
    result.text = result.text.replace(/\r/g, '').slice(0, MAX_SOURCE_CHARS);
    result.wordCount = countWords(result.text);
    if (result.text.length < 50) {
      return res.status(422).json({ error: 'The extracted content is too short (minimum 50 characters).', wordCount: result.wordCount });
    }
    return res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[ERROR] extract-source failed:', err);
    return res.status(status).json({ error: err.message || 'Failed to extract source.' });
  }
});

/**
 * POST /api/study/generate-unit
 * Body: { textbookId, unitId } or { sourceText, title }, plus optional { weakAreas[], targetBand }.
 * Falls back to the built-in sample unit if AI is unavailable for a textbook unit.
 */
app.post('/api/study/generate-unit', async (req, res) => {
  try {
    const { textbookId, unitId, sourceText, title, weakAreas, targetBand } = req.body || {};
    let sourceMaterial;
    let fallback = null;
    let unitTitle;
    let unitKey;

    if (textbookId != null || unitId != null) {
      const found = findTextbookUnit(textbookId, unitId);
      if (!found) return res.status(400).json({ error: 'Unknown textbookId/unitId.' });
      sourceMaterial = `${found.book.title}\n${found.unit.title}\n\n${found.unit.content}`;
      fallback = found.unit.sample;
      unitTitle = found.unit.title;
      unitKey = found.unit.id;
    } else if (typeof sourceText === 'string' && sourceText.trim().length >= 50) {
      sourceMaterial = sourceText.trim().slice(0, MAX_SOURCE_CHARS);
      unitTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Personal source';
      unitKey = `custom_${Date.now().toString(36)}`;
    } else {
      return res.status(400).json({ error: 'Provide textbookId + unitId, or sourceText of at least 50 characters.' });
    }

    const weak = Array.isArray(weakAreas) ? weakAreas.map(w => String(w).slice(0, 80)).slice(0, 8) : [];
    const band = Number.isFinite(Number(targetBand)) ? Number(targetBand) : null;
    const prompt = `${config.studyUnitPrompt}\n\nTarget band: ${band ?? 'not set'}\nLearner weak areas: ${weak.length ? weak.join(', ') : 'not available'}\n\nSOURCE MATERIAL:\n"""\n${sourceMaterial}\n"""`;

    const respondFallback = reason => {
      const unit = normalizeStudyUnit(fallback, unitTitle);
      if (!unit) return null;
      return res.status(200).json({ unitId: unitKey, unit, provider: 'Built-in sample unit', fallback: true, fallbackReason: reason });
    };

    let gen;
    try {
      gen = await withTimeout(generateWithKeyPool(req, prompt), fallback ? 60000 : 120000, 'AI generation');
    } catch (err) {
      const handled = fallback && respondFallback(err.message);
      if (handled) return handled;
      throw err;
    }
    if (gen.missingKey) {
      const handled = fallback && respondFallback('No AI provider configured');
      if (handled) return handled;
      return res.status(500).json({ error: 'Server configuration error: no AI provider is available.' });
    }

    let unit = null;
    try { unit = normalizeStudyUnit(parseGeminiJson(gen.response), unitTitle); } catch { /* handled below */ }
    if (!unit) {
      const handled = fallback && respondFallback('AI returned an invalid unit');
      if (handled) return handled;
      return res.status(502).json({ error: 'AI returned an invalid study unit. Please try again.' });
    }
    return res.status(200).json({ unitId: unitKey, unit, provider: gen.provider, fallback: false });
  } catch (err) {
    console.error('[ERROR] generate-unit failed:', err);
    return res.status(500).json({ error: 'Failed to generate the study unit.', details: err.message });
  }
});

/** Local heuristic scoring used when no AI provider can grade the mini challenge. */
function gradeMiniLocally(answer, targetWords, minWords, maxWords) {
  const words = countWords(answer);
  const lower = answer.toLowerCase();
  const usedWords = targetWords.filter(w => lower.includes(w.toLowerCase()));
  const missingWords = targetWords.filter(w => !usedWords.includes(w));
  const vocabRatio = targetWords.length ? usedWords.length / targetWords.length : 1;
  const lengthOk = words >= minWords && words <= maxWords * 1.25;
  const sentences = (answer.match(/[.!?]+/g) || []).length;
  const score = Math.round(Math.min(100, vocabRatio * 55 + (lengthOk ? 30 : Math.min(words / minWords, 1) * 20) + Math.min(sentences, 4) * 3.75));
  const band = Math.max(4, Math.min(7.5, Math.round((4 + score / 100 * 3.5) * 2) / 2));
  return {
    band, score, usedWords, missingWords,
    feedbackEn: `Automatic check: ${words} words, ${usedWords.length}/${targetWords.length} target words used.`,
    feedbackVi: `Chấm tự động: ${words} từ, dùng ${usedWords.length}/${targetWords.length} từ mục tiêu.${missingWords.length ? ` Hãy thử thêm: ${missingWords.join(', ')}.` : ''}`,
    improved: ''
  };
}

/** POST /api/study/evaluate-mini — grade the Step 5 mini output challenge (AI first, local fallback). */
app.post('/api/study/evaluate-mini', async (req, res) => {
  try {
    const { answer, prompt: challengePrompt, targetWords, unitTitle, minWords, maxWords } = req.body || {};
    if (typeof answer !== 'string' || !answer.trim()) {
      return res.status(400).json({ error: 'Answer text is required.' });
    }
    const min = Number.isFinite(Number(minWords)) ? Number(minWords) : 50;
    const max = Number.isFinite(Number(maxWords)) ? Number(maxWords) : 80;
    const wordCount = countWords(answer);
    const requiredMin = Math.max(20, Math.floor(min * 0.6));
    if (wordCount < requiredMin) {
      return res.status(400).json({
        error: `Answer is too short (${wordCount} words). Write at least ${requiredMin} words.`,
        wordCount, minRequired: requiredMin
      });
    }
    const targets = Array.isArray(targetWords) ? targetWords.map(String).slice(0, 8) : [];
    const prompt = `${config.studyEvaluatePrompt}\n\nUnit: ${String(unitTitle || '').slice(0, 200)}\nChallenge: ${String(challengePrompt || '').slice(0, 600)}\nTarget words: ${targets.join(', ') || 'none'}\nLearner text (${wordCount} words):\n"""\n${answer.trim().slice(0, 3000)}\n"""`;

    let result = null;
    let provider = 'Local heuristic';
    try {
      const gen = await withTimeout(generateWithKeyPool(req, prompt), 25000, 'AI grading');
      if (!gen.missingKey) {
        const parsed = parseGeminiJson(gen.response);
        const band = Number(parsed.band);
        const score = Number(parsed.score);
        if (Number.isFinite(band) && Number.isFinite(score)) {
          result = {
            band: Math.max(0, Math.min(9, band)), score: Math.max(0, Math.min(100, Math.round(score))),
            usedWords: Array.isArray(parsed.usedWords) ? parsed.usedWords.map(String) : [],
            missingWords: Array.isArray(parsed.missingWords) ? parsed.missingWords.map(String) : [],
            feedbackEn: String(parsed.feedbackEn || ''), feedbackVi: String(parsed.feedbackVi || ''),
            improved: String(parsed.improved || '')
          };
          provider = gen.provider;
        }
      }
    } catch (err) {
      console.warn('[WARN] evaluate-mini AI failed, using local grading:', err.message);
    }
    if (!result) result = gradeMiniLocally(answer.trim(), targets, min, max);
    return res.status(200).json({ ...result, wordCount, provider });
  } catch (err) {
    console.error('[ERROR] evaluate-mini failed:', err);
    return res.status(500).json({ error: 'Failed to evaluate the mini challenge.', details: err.message });
  }
});

// Export the app so tests can mount it in-process
export default app;

// Start listening only when run directly (node server.js), not when imported by tests
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` IELTS Master Server is running on port ${PORT}`);
  console.log(` Static files served from: ${__dirname}`);
  console.log(` Health & endpoints:`);
  console.log(` - POST http://localhost:${PORT}/api/writing/score`);
  console.log(` - GET  http://localhost:${PORT}/api/writing/history`);
  console.log(` - GET  http://localhost:${PORT}/api/writing/config`);
  console.log(` - POST http://localhost:${PORT}/api/speaking/score`);
  console.log(` - GET  http://localhost:${PORT}/api/speaking/history`);
  console.log(` - GET  http://localhost:${PORT}/api/speaking/config`);
  console.log(` - POST http://localhost:${PORT}/api/placement/results`);
  console.log(` - GET  http://localhost:${PORT}/api/placement/history`);
  console.log(` - POST http://localhost:${PORT}/api/analytics/roadmap`);
  console.log(` - POST http://localhost:${PORT}/api/analytics/study-plan`);
  console.log(` - GET  http://localhost:${PORT}/api/study/config`);
  console.log(` - GET/POST http://localhost:${PORT}/api/study/progress`);
  console.log(` - POST http://localhost:${PORT}/api/study/extract-source`);
  console.log(` - POST http://localhost:${PORT}/api/study/generate-unit`);
  console.log(` - POST http://localhost:${PORT}/api/study/evaluate-mini`);
  console.log(` - GET/POST/DELETE http://localhost:${PORT}/api/settings/keys`);
  console.log(`====================================================`);
});

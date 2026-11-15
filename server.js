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

// Results storage paths (use /tmp on serverless platforms like Vercel where __dirname is read-only)
const resultsDir = process.env.IELTS_RESULTS_DIR || (
  process.env.VERCEL ? '/tmp/ielts-results' : path.join(__dirname, 'results')
);
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

app.use(['/api/study/generate-unit', '/api/study/evaluate-mini', '/api/study/extract-source', '/api/study/tutor-feedback', '/api/study/checkpoint-evaluate'], studyRateLimit);

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

/* ── Universal Multi-Provider Key Pool & Auto-Rotation Engine ──────────────
 *
 * Supports keys from:
 *  - Google Gemini (AIzaSy... or gemini:...)
 *  - ChatGPT / OpenAI (openai:sk-... or sk-proj-...)
 *  - DeepSeek (deepseek:sk-... or sk-<32 hex>)
 *  - OpenRouter Free/Paid Models (openrouter:sk-... or sk-or-v1-...)
 *  - Groq Free Cloud (groq:gsk_... or gsk_...)
 *  - GitHub Models (github:ghp_... or ghp_... / github_pat_...)
 *  - Pollinations.ai Zero-Key Free AI Fallback (works immediately without any key)
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

function classifyProviderKey(rawEntry) {
  const s = String(rawEntry || '').trim();
  const match = s.match(/^(gemini|openai|chatgpt|deepseek|ds|groq|openrouter|github):(.*)$/i);
  if (match) {
    const prefix = match[1].toLowerCase();
    const key = match[2].trim();
    if (prefix === 'gemini') return { provider: 'gemini', label: 'Google Gemini', key, raw: s };
    if (prefix === 'openai' || prefix === 'chatgpt') return { provider: 'openai', label: 'ChatGPT / OpenAI (gpt-4o-mini)', key, raw: s };
    if (prefix === 'deepseek' || prefix === 'ds') return { provider: 'deepseek', label: 'DeepSeek (deepseek-chat)', key, raw: s };
    if (prefix === 'groq') return { provider: 'groq', label: 'Groq Cloud (GPT-OSS 120B)', key, raw: s };
    if (prefix === 'openrouter') return { provider: 'openrouter', label: 'OpenRouter (Free Models)', key, raw: s };
    if (prefix === 'github') return { provider: 'github', label: 'GitHub Models (gpt-4o-mini)', key, raw: s };
  }

  if (/^(ghp_|github_pat_|gho_|ghs_)/i.test(s)) {
    return { provider: 'github', label: 'GitHub Models (gpt-4o-mini)', key: s, raw: s };
  }
  if (/^sk-or-v1-/i.test(s)) {
    return { provider: 'openrouter', label: 'OpenRouter (Free Models)', key: s, raw: s };
  }
  if (/^gsk_/i.test(s)) {
    return { provider: 'groq', label: 'Groq Cloud (GPT-OSS 120B)', key: s, raw: s };
  }
  if (/^sk-[a-f0-9]{32}$/i.test(s)) {
    return { provider: 'deepseek', label: 'DeepSeek (deepseek-chat)', key: s, raw: s };
  }
  if (/^sk-(proj-|svcacct-)/i.test(s)) {
    return { provider: 'openai', label: 'ChatGPT / OpenAI (gpt-4o-mini)', key: s, raw: s };
  }
  if (/^sk-/i.test(s)) {
    return { provider: 'sk-auto', label: 'ChatGPT / DeepSeek (Auto)', key: s, raw: s };
  }
  return { provider: 'gemini', label: 'Google Gemini', key: s, raw: s };
}

function maskApiKey(rawEntry) {
  const { key } = classifyProviderKey(rawEntry);
  if (key.length <= 6) return '••••••••••••••••';
  return `••••••••••••••••${key.slice(-4)}`;
}

function getEnvProviderEntries() {
  return [
    ...splitKeyString(process.env.GEMINI_API_KEYS || ''),
    ...splitKeyString(process.env.GEMINI_API_KEY || ''),
    ...splitKeyString(process.env.OPENAI_API_KEYS || '').map(k => `openai:${k}`),
    ...splitKeyString(process.env.OPENAI_API_KEY || '').map(k => `openai:${k}`),
    ...splitKeyString(process.env.DEEPSEEK_API_KEYS || '').map(k => `deepseek:${k}`),
    ...splitKeyString(process.env.DEEPSEEK_API_KEY || '').map(k => `deepseek:${k}`),
    ...splitKeyString(process.env.GROQ_API_KEYS || '').map(k => `groq:${k}`),
    ...splitKeyString(process.env.GROQ_API_KEY || '').map(k => `groq:${k}`),
    ...splitKeyString(process.env.OPENROUTER_API_KEYS || '').map(k => `openrouter:${k}`),
    ...splitKeyString(process.env.OPENROUTER_API_KEY || '').map(k => `openrouter:${k}`),
    ...splitKeyString(process.env.GITHUB_TOKENS || '').map(k => `github:${k}`),
    ...splitKeyString(process.env.GITHUB_TOKEN || '').map(k => `github:${k}`)
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
    ...splitKeyString(req?.headers?.['x-ai-api-key'] || ''),
    ...splitKeyString(req?.headers?.['x-github-token'] || '').map(k => `github:${k}`)
  ];
  const bodyRaw = Array.isArray(req?.body?.apiKeys)
    ? req.body.apiKeys.flatMap(splitKeyString)
    : splitKeyString(req?.body?.apiKey || '');
  const runtimeRaw = getRuntimeStoredKeys();
  const envRaw = getEnvProviderEntries();

  const allEntries = [...new Set([...headerRaw, ...bodyRaw, ...runtimeRaw, ...envRaw])];
  return allEntries.map(classifyProviderKey).filter(item => item.key);
}

function buildKeyPoolStatus() {
  const now = Date.now();
  const runtimeRaw = getRuntimeStoredKeys();
  const envRaw = getEnvProviderEntries();
  const seen = new Set();
  const list = [];

  for (const raw of [...runtimeRaw, ...envRaw]) {
    const info = classifyProviderKey(raw);
    if (!info.key || seen.has(info.key)) continue;
    seen.add(info.key);
    const cooldownAt = keyCooldownUntil.get(info.key) || 0;
    list.push({
      masked: maskApiKey(raw),
      tier: info.label,
      provider: info.provider,
      source: runtimeRaw.includes(raw) ? 'runtime' : 'env',
      status: cooldownAt > now ? 'cooldown' : 'ready'
    });
  }

  return {
    totalKeys: list.length,
    activeKeys: list.filter(x => x.status === 'ready').length,
    tiers: {
      tier1GeminiCount: list.filter(x => x.provider !== 'github').length,
      tier2GitHubCount: list.filter(x => x.provider === 'github').length,
      tier3PollinationsFree: process.env.DISABLE_FREE_FALLBACK !== 'true'
    },
    keys: list
  };
}

/**
 * GET /api/settings/keys
 * Returns masked status of all configured keys & multi-provider rotation pool.
 */
app.get('/api/settings/keys', (req, res) => {
  res.json(buildKeyPoolStatus());
});

/**
 * POST /api/settings/keys
 * Adds one or multiple AI API keys (Gemini, ChatGPT, DeepSeek, Groq, OpenRouter, GitHub) to the rotation pool.
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
 * Generic OpenAI-Compatible Chat Completions Caller
 * Used for ChatGPT (OpenAI), DeepSeek, Groq, OpenRouter, and GitHub Models.
 */
async function callOpenAiCompatible({ endpoint, apiKey, model, fallbackModels = [], providerName, promptText, extraHeaders = {}, useJsonObject = true }) {
  const candidateModels = [...new Set([model, ...fallbackModels].filter(Boolean))];
  let lastErr = null;

  for (const currentModel of candidateModels) {
    const payload = {
      model: currentModel,
      ...(useJsonObject ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: 'You are an official IELTS examiner. Respond ONLY with a valid JSON object matching the exact schema requested.' },
        { role: 'user', content: promptText }
      ],
      temperature: 0.3
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...extraHeaders
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const err = new Error(`${providerName} (${currentModel}) HTTP ${res.status}: ${bodyText.slice(0, 200)}`);
      err.status = res.status;
      lastErr = err;
      // If auth or billing error (401/402/403), stop trying other models on the same key
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw err;
      }
      continue;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
      lastErr = new Error(`${providerName} (${currentModel}) returned an empty response.`);
      continue;
    }
    return { text, usedModel: currentModel };
  }

  throw lastErr || new Error(`${providerName} failed across all candidate models.`);
}

/**
 * Execute a single classified key entry against its corresponding AI provider.
 */
async function executeWithClassifiedKey(entry, promptText, totalPoolSize) {
  const { provider, key } = entry;

  if (provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: key });
    const maxAttempts = totalPoolSize > 1 ? 1 : 2;
    const response = await generateWithRetry(ai, {
      model: config.model,
      contents: promptText,
      config: { responseMimeType: 'application/json' }
    }, maxAttempts);
    return { response, providerLabel: 'Google Gemini' };
  }

  if (provider === 'openai') {
    const response = await callOpenAiCompatible({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: key,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      providerName: 'OpenAI (ChatGPT)',
      promptText
    });
    return { response, providerLabel: 'ChatGPT / OpenAI (gpt-4o-mini)' };
  }

  if (provider === 'deepseek') {
    const response = await callOpenAiCompatible({
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: key,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      providerName: 'DeepSeek',
      promptText
    });
    return { response, providerLabel: 'DeepSeek (deepseek-chat)' };
  }

  if (provider === 'groq') {
    const response = await callOpenAiCompatible({
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: key,
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      fallbackModels: ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
      providerName: 'Groq Cloud',
      promptText
    });
    return { response, providerLabel: `Groq Cloud (${response.usedModel || 'gpt-oss-120b'})` };
  }

  if (provider === 'openrouter') {
    const response = await callOpenAiCompatible({
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: key,
      model: process.env.OPENROUTER_MODEL || 'openrouter/free',
      fallbackModels: ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-lightning:free'],
      providerName: 'OpenRouter',
      promptText,
      useJsonObject: false,
      extraHeaders: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'IELTS Master' }
    });
    return { response, providerLabel: `OpenRouter (${response.usedModel || 'free'})` };
  }

  if (provider === 'github') {
    const response = await callOpenAiCompatible({
      endpoint: 'https://models.inference.ai.azure.com/chat/completions',
      apiKey: key,
      model: process.env.GITHUB_MODEL || 'gpt-4o-mini',
      providerName: 'GitHub Models',
      promptText
    });
    return { response, providerLabel: 'GitHub Models (gpt-4o-mini)' };
  }

  // provider === 'sk-auto': Try OpenAI first; if 401/403, try DeepSeek automatically
  try {
    const response = await callOpenAiCompatible({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: key,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      providerName: 'OpenAI (ChatGPT)',
      promptText
    });
    return { response, providerLabel: 'ChatGPT / OpenAI (gpt-4o-mini)' };
  } catch (openAiErr) {
    const response = await callOpenAiCompatible({
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: key,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      providerName: 'DeepSeek',
      promptText
    });
    return { response, providerLabel: 'DeepSeek (deepseek-chat)' };
  }
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
 * Universal Multi-Provider Execution with Key Pool Auto-Rotation:
 *  - Rotates across all configured keys (Gemini, ChatGPT/OpenAI, DeepSeek, Groq, OpenRouter, GitHub Models)
 *  - Automatically falls back to Pollinations.ai Zero-Key Free AI when no keys or all keys are rate-limited
 */
async function generateWithKeyPool(req, promptText) {
  const pool = collectProviderKeys(req);
  const now = Date.now();
  const errors = [];

  if (pool.length > 0) {
    const rotated = [];
    for (let i = 0; i < pool.length; i++) {
      rotated.push(pool[(roundRobinCursor + i) % pool.length]);
    }
    roundRobinCursor = (roundRobinCursor + 1) % pool.length;

    const readyEntries = rotated.filter(e => (keyCooldownUntil.get(e.key) || 0) <= now);
    const cooldownEntries = rotated.filter(e => (keyCooldownUntil.get(e.key) || 0) > now);
    const orderedPool = [...readyEntries, ...cooldownEntries];

    for (const entry of orderedPool) {
      try {
        const { response, providerLabel } = await executeWithClassifiedKey(entry, promptText, orderedPool.length);
        keyCooldownUntil.delete(entry.key);
        return {
          response,
          provider: providerLabel,
          usedKeyMasked: maskApiKey(entry.raw)
        };
      } catch (err) {
        errors.push(`${entry.label}(${maskApiKey(entry.raw)}): ${err?.status || err?.message}`);
        keyCooldownUntil.set(entry.key, Date.now() + KEY_COOLDOWN_MS);
        console.warn(`[WARN] Key ${maskApiKey(entry.raw)} [${entry.label}] failed (${err?.status || err?.message}). Rotating to next key...`);
      }
    }
  }

  // ── FALLBACK TIER: Pollinations.ai (Zero-Key Free AI Fallback) ────────
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

  if (!pool.length) {
    return { missingKey: true, errors };
  }

  throw new Error(`All AI providers failed: ${errors.join(' | ')}`);
}

/**
 * Call Gemini, retrying temporary failures (HTTP 429 rate limit / 503 overloaded).
 * Waits 2s, 4s, 8s between attempts.
 */
async function generateWithRetry(ai, request, maxAttempts = 4) {
  let activeRequest = { ...request };
  let triedModernFallback = false;
  for (let attempt = 1; ; attempt++) {
    try {
      return await ai.models.generateContent(activeRequest);
    } catch (err) {
      const status = err?.status ?? err?.code;
      const msg = String(err?.message || '');
      if (!triedModernFallback && (status === 404 || /no longer available|not found/i.test(msg))) {
        triedModernFallback = true;
        activeRequest = { ...activeRequest, model: 'gemini-3-flash-preview' };
        console.info(`[INFO] Model ${request.model} unavailable for this key; switching to gemini-3-flash-preview.`);
        continue;
      }
      const retryable = status === 429 || status === 503 || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(msg);
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
const studySrsFile = path.join(resultsDir, 'study_srs.json');
const studyCheckpointsFile = path.join(resultsDir, 'study_checkpoints.json');
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
    .map(c => ({ front: str(c.front), back: str(c.back), example: str(c.example), ipa: str(c.ipa), clozeSentence: str(c.clozeSentence) }));
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
      options: d.options.map(o => String(o)), answer: d.answer, explanation: str(d.explanation), skillTag: str(d.skillTag)
    }));
  const ch = raw.challenge;
  if (flashcards.length < 4 || quiz.length < 4 || drill.length < 3 || !ch || !str(ch.prompt)) return null;
  if (!['Foundation', 'Intermediate', 'Advanced'].includes(raw.levelTag) || !Array.isArray(raw.targetWeakness) || !raw.targetWeakness.length || !str(lesson.feynmanPromptVi) || !Array.isArray(lesson.bandUpgradeExamples) || lesson.bandUpgradeExamples.filter(x => x && str(x.bandLow) && str(x.bandHigh) && str(x.analysisVi)).length < 2 || flashcards.some(c => !c.ipa || !c.clozeSentence.includes('___')) || new Set(drill.map(d => d.skillTag)).size < 3 || !['Reading Paraphrase', 'Grammar Error Fix (GRA)', 'Lexical Collocation (LR)'].every(tag => drill.some(d => d.skillTag === tag))) return null;
  return {
    title: str(raw.title) || fallbackTitle || 'Study Unit',
    levelTag: str(raw.levelTag), targetWeakness: Array.isArray(raw.targetWeakness) ? raw.targetWeakness.map(String) : [],
    lesson: {
      titleEn: str(lesson.titleEn), titleVi: str(lesson.titleVi),
      explanationEn: str(lesson.explanationEn), explanationVi: str(lesson.explanationVi),
      bandUpgradeExamples: (Array.isArray(lesson.bandUpgradeExamples) ? lesson.bandUpgradeExamples : []).filter(x => x && str(x.bandLow) && str(x.bandHigh)).map(x => ({ bandLow: str(x.bandLow), bandHigh: str(x.bandHigh), analysisVi: str(x.analysisVi) })),
      feynmanPromptVi: str(lesson.feynmanPromptVi),
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
      fallback = { ...found.unit.sample, levelTag: found.unit.levelTag, targetWeakness: found.unit.targetWeakness };
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
    try { const raw = parseGeminiJson(gen.response); unit = normalizeStudyUnit({ ...raw, levelTag: raw.levelTag || fallback?.levelTag, targetWeakness: raw.targetWeakness || fallback?.targetWeakness }, unitTitle); } catch { /* handled below */ }
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

/* Phase 8A: diagnostic, reflection and spaced repetition. */
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const mean = xs => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;
const bandValue = v => finite(v) ? clamp(Number(v), 0, 9) : null;
const dueItems = items => items.filter(x => Number.isFinite(Date.parse(x.nextReviewAt)) && Date.parse(x.nextReviewAt) <= Date.now());
const summarySrs = items => ({ totalItems: items.length, dueTodayCount: dueItems(items).length, dueItems: dueItems(items) });
const sectionBand = pct => {
  if (!finite(pct)) return null;
  return [[93,8],[80,7],[67,6],[53,5.5],[40,5],[27,4],[0,3]].find(([n]) => Number(pct) >= n)?.[1] ?? null;
};
const recordBand = r => bandValue(r.result?.overall_band ?? r.overall_band ?? r.overallBand);
const validUnitId = id => typeof id === 'string' && !!id.trim() && id.trim().length <= 120;

app.get('/api/study/diagnostic-status', (req, res) => {
  try {
    const placement = readJsonArray(placementResultsFile), writing = readJsonArray(resultsFile), speaking = readJsonArray(speakingResultsFile);
    const checkpoints = readJsonArray(studyCheckpointsFile), progress = readJsonArray(studyProgressFile), srs = readJsonArray(studySrsFile);
    const counts = { placement: placement.length, writing: writing.length, speaking: speaking.length };
    const base = { unlocked: placement.length > 0, counts, profile: null, recommendedCurriculum: [], srsSummary: summarySrs(srs) };
    if (!base.unlocked) return res.json(base);
    const skills = {
      reading: mean(placement.map(r => sectionBand(r.sectionBreakdown?.reading?.percentage)).filter(x => x != null)),
      listening: mean(placement.map(r => sectionBand(r.sectionBreakdown?.listening?.percentage)).filter(x => x != null)),
      writing: mean(writing.map(recordBand).filter(x => x != null)), speaking: mean(speaking.map(recordBand).filter(x => x != null))
    };
    const placementBands = placement.map(r => parseFloat(r.estimatedBand)).filter(Number.isFinite);
    const inputBand = clamp(mean([...placementBands, ...[skills.writing, skills.speaking].filter(x => x != null)]) ?? 5, 0, 9);
    const recommendedTargetBand = Math.min(9, Math.ceil((inputBand + 0.5) * 2) / 2);
    const scores = [];
    for (const [k, v] of Object.entries(skills)) if (v != null) scores.push([k[0].toUpperCase() + k.slice(1), v]);
    const buckets = {};
    for (const r of [...writing, ...speaking]) for (const c of (r.result?.criteria || r.criteria || [])) {
      const key = String(c.abbreviation || '').toUpperCase();
      if (['TR','CC','LR','GRA','FC','PR'].includes(key) && finite(c.score)) (buckets[key] ||= []).push(clamp(Number(c.score),0,9));
    }
    for (const [key, vals] of Object.entries(buckets)) scores.push([key, mean(vals)]);
    const minimum = scores.length ? Math.min(...scores.map(x => x[1])) : inputBand;
    const weakAreas = scores.filter(([, v]) => v <= minimum + 0.5).map(([k]) => k);
    if (!weakAreas.length) for (const a of placement.flatMap(r => r.weakAreas || [])) {
      const k = String(a.section || '').toLowerCase(); if (['reading','listening'].includes(k)) weakAreas.push(k[0].toUpperCase()+k.slice(1));
    }
    const gaps = checkpoints.map(c => c.metacognition?.calibrationGap).filter(finite).map(Number);
    const profile = { inputBand, recommendedTargetBand, skills, weakAreas: [...new Set(weakAreas)], calibrationIndex: mean(gaps) ?? 0 };
    const matchesWeakness = tag => profile.weakAreas.includes(tag) || (profile.weakAreas.includes('Writing') && ['TR','CC','LR','GRA'].includes(tag)) || (profile.weakAreas.includes('Speaking') && ['FC','LR','GRA','PR'].includes(tag));
    const recommendedCurriculum = (config.sampleTextbooks || []).flatMap(book => {
      const range = String(book.bandRange || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
      const near = range.length >= 2 && range[0] <= recommendedTargetBand && range[1] >= inputBand;
      return (book.units || []).filter(u => near && u.targetWeakness?.some(matchesWeakness)).map(u => ({
        ...u, textbookId: book.id, textbookTitle: book.title,
        mastery: progress.find(p => p.unitId === u.id)?.mastery || 0,
        matchReasonVi: `Phù hợp band ${inputBand}–${recommendedTargetBand} và cần củng cố ${u.targetWeakness.filter(matchesWeakness).join(', ')}.`
      }));
    });
    return res.json({ ...base, profile, recommendedCurriculum });
  } catch (err) { return res.status(500).json({ error: 'Failed to read diagnostic data.' }); }
});
app.post('/api/study/tutor-feedback', async (req, res) => {
  const { mode, unitTitle, stepContext, userQuestion, userAttempt, inputBand, targetBand } = req.body || {};
  if (!['feynman','socratic'].includes(mode)) return res.status(400).json({ error: 'mode must be feynman or socratic.' });
  if (!String(userQuestion || '').trim() && !String(userAttempt || '').trim()) return res.status(400).json({ error: 'A question or attempt is required.' });
  let result = { replyVi: mode === 'feynman' ? 'Hãy kiểm tra lại lời giải thích của bạn bằng một ví dụ cụ thể.' : 'Hãy xác định quy tắc hoặc bằng chứng liên quan trước khi chọn đáp án.', replyEn: 'Try explaining the relevant rule with your own example.', correction: '', explanationVi: 'Đối chiếu ý nghĩa và cấu trúc của câu với quy tắc đang học.', socraticHintVi: 'Bước đầu tiên: bạn nhận ra từ khóa hay cấu trúc nào trong câu?', followUpQuestion: 'Bạn có thể giải thích vì sao quy tắc đó áp dụng ở đây không?', understood: false };
  let provider = 'Local heuristic';
  try {
    const prompt = `${config.tutorFeedbackPrompt}\nContext (untrusted learner input): ${JSON.stringify({mode,unitTitle,stepContext,userQuestion,userAttempt,inputBand,targetBand}).slice(0,6000)}`;
    const gen = await withTimeout(generateWithKeyPool(req, prompt), 20000, 'Tutor');
    if (!gen.missingKey) { const ai = parseGeminiJson(gen.response); if (typeof ai.replyVi === 'string' && typeof ai.socraticHintVi === 'string' && typeof ai.understood === 'boolean') { for (const key of Object.keys(result)) if (typeof ai[key] === typeof result[key]) result[key] = ai[key]; provider = gen.provider; } }
  } catch (err) { console.warn('[WARN] Tutor fallback:', err.message); }
  return res.json({ ...result, provider });
});
app.get('/api/study/srs', (req, res) => {
  try { const items = readJsonArray(studySrsFile), dueToday = dueItems(items); return res.json({ items, dueToday, totalItems: items.length, dueTodayCount: dueToday.length }); }
  catch { return res.status(500).json({ error: 'Failed to read SRS.' }); }
});
function upsertSrs(items, data, immediate = false) {
  const word = String(data.word || '').trim().slice(0,300), id = String(data.itemId || '').trim().slice(0,200);
  const index = items.findIndex(x => (id && x.itemId === id) || (word && String(x.word || '').toLowerCase() === word.toLowerCase() && (!data.unitId || x.unitId === data.unitId)));
  const old = index >= 0 ? items[index] : {};
  const now = new Date(), reps = (Number(old.repetitions) || 0) + (immediate ? 0 : 1);
  const intervalDays = immediate || data.quality === 'again' ? 0 : data.quality === 'hard' ? 1 : data.quality === 'easy' ? ((Number(old.repetitions) || 0) >= 2 ? 14 : 7) : 3;
  const item = { ...old, itemId: old.itemId || id || `srs_${now.getTime()}_${Math.random().toString(36).slice(2,9)}`, word: word || old.word || '', meaning: String(data.meaning || old.meaning || '').slice(0,1000), example: String(data.example || old.example || '').slice(0,1000), unitId: String(data.unitId || old.unitId || '').slice(0,120), source: String(data.source || old.source || '').slice(0,80), intervalDays, nextReviewAt: new Date(now.getTime() + intervalDays * 86400000).toISOString(), repetitions: reps, lastReviewedAt: immediate ? (old.lastReviewedAt || null) : now.toISOString() };
  if (index >= 0) items[index] = item; else items.push(item);
  return item;
}
app.post('/api/study/srs/review', (req, res) => {
  const data = req.body || {};
  if (!String(data.itemId || '').trim() && !String(data.word || '').trim()) return res.status(400).json({ error: 'itemId or word is required.' });
  if (data.quality != null && !['again','hard','good','easy'].includes(data.quality)) return res.status(400).json({ error: 'Invalid quality.' });
  try { const items = readJsonArray(studySrsFile), item = upsertSrs(items, data); writeJsonArray(studySrsFile, items); return res.json(item); }
  catch { return res.status(500).json({ error: 'Failed to save SRS.' }); }
});
app.get('/api/study/checkpoints', (req, res) => {
  try { return res.json(readJsonArray(studyCheckpointsFile)); } catch { return res.status(500).json({ error: 'Failed to read checkpoints.' }); }
});
app.post('/api/study/checkpoint-evaluate', async (req, res) => {
  const d = req.body || {}, outputText = String(d.writtenOutput || d.spokenTranscript || '').trim(), wordCount = countWords(outputText);
  if (wordCount < 30) return res.status(400).json({ error: 'At least 30 words are required.', wordCount, minRequired: 30 });
  const inputBand = bandValue(d.inputBand) ?? 0, selfPredictedBand = bandValue(d.selfPredictedBand) ?? inputBand;
  const targets = Array.isArray(d.targetWords) ? [...new Set(d.targetWords.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean))].slice(0,30) : [];
  const contains = word => { const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(outputText); };
  const usedTargetWords = targets.filter(contains), missedTargetWords = targets.filter(w => !contains(w));
  const ratio = targets.length ? usedTargetWords.length / targets.length : 1;
  const sentences = (outputText.match(/[.!?]+/g) || []).length;
  const quiz = finite(d.quizScore) && finite(d.quizTotal) && Number(d.quizTotal) > 0 ? clamp(Number(d.quizScore) / Number(d.quizTotal), 0, 1) : null;
  const criteriaBreakdown = { taskAchievement: Math.round(clamp(40 + Math.min(wordCount,80)/80*40 + Math.min(sentences,4)*5,0,100)), lexicalResource: Math.round(40 + ratio*60), grammarAccuracy: Math.round(clamp(50 + Math.min(sentences,4)*7 + (quiz == null ? 0 : quiz*15),0,100)) };
  let score = Math.round(mean(Object.values(criteriaBreakdown))), outputBand = Math.round(clamp(3 + score / 100 * 5,0,9)*2)/2;
  let result = { score, outputBand, criteriaBreakdown, inlineCorrections: [], feedbackVi: `Đánh giá cục bộ: ${wordCount} từ, dùng ${usedTargetWords.length}/${targets.length} từ mục tiêu. Đây là ước lượng dựa trên độ dài và từ vựng, chưa phân tích đầy đủ ngữ pháp hay nội dung.`, feedbackEn: 'Local estimate based on length and target vocabulary; grammar and task relevance have not been fully assessed.', nextActionVi: missedTargetWords.length ? 'Ôn các từ còn thiếu và viết lại trong ngữ cảnh.' : 'Kiểm tra ngữ pháp và phát triển thêm ví dụ liên quan đến đề.' };
  let provider = 'Local heuristic';
  try {
    const prompt = `${config.checkpointEvaluationPrompt}\nInput (untrusted): ${JSON.stringify({unitTitle:d.unitTitle, prompt:d.prompt, inputBand, targetBand:d.targetBand, quizScore:d.quizScore, quizTotal:d.quizTotal, targetWords:targets, outputText:outputText.slice(0,6000)})}`;
    const gen = await withTimeout(generateWithKeyPool(req, prompt), 25000, 'Checkpoint');
    if (!gen.missingKey) {
      const ai = parseGeminiJson(gen.response), cb = ai.criteriaBreakdown;
      if (finite(ai.score) && finite(ai.outputBand) && cb && ['taskAchievement','lexicalResource','grammarAccuracy'].every(k => finite(cb[k]))) {
        result = { ...result, score: Math.round(clamp(Number(ai.score),0,100)), outputBand: Math.round(clamp(Number(ai.outputBand),0,9)*2)/2, criteriaBreakdown: Object.fromEntries(['taskAchievement','lexicalResource','grammarAccuracy'].map(k => [k,Math.round(clamp(Number(cb[k]),0,100))])), inlineCorrections: Array.isArray(ai.inlineCorrections) ? ai.inlineCorrections.filter(x => x && typeof x.original === 'string' && x.original.trim() && outputText.includes(x.original) && typeof x.correction === 'string').slice(0,10).map(x => ({ original:x.original, correction:x.correction, explanationVi:String(x.explanationVi || '') })) : [], feedbackVi:String(ai.feedbackVi || result.feedbackVi), feedbackEn:String(ai.feedbackEn || result.feedbackEn), nextActionVi:String(ai.nextActionVi || result.nextActionVi) }; provider = gen.provider;
      }
    }
  } catch (err) { console.warn('[WARN] Checkpoint fallback:', err.message); }
  const gap = Number((result.outputBand-selfPredictedBand).toFixed(1));
  const metacognition = { selfPredictedBand, calibrationGap: gap, calibrationFeedbackVi: gap === 0 ? 'Dự đoán của bạn trùng với kết quả ước lượng.' : gap > 0 ? 'Bạn đang đánh giá thấp kết quả; hãy đối chiếu các tiêu chí.' : 'Bạn đang đánh giá cao kết quả; hãy đối chiếu các tiêu chí.', selfDifficultyReason: String(d.selfDifficultyReason || '').slice(0,1000) };
  const record = { id: `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2,9)}`, unitId: validUnitId(d.unitId) ? d.unitId.trim() : '', unitTitle: String(d.unitTitle || '').slice(0,200), timestamp:new Date().toISOString(), ...result, inputBand, outputBand:result.outputBand, bandDelta:Number((result.outputBand-inputBand).toFixed(1)), metacognition, passed:result.score >= 70, usedTargetWords, missedTargetWords, provider, wordCount };
  try {
    const items = readJsonArray(studySrsFile);
    for (const word of missedTargetWords) upsertSrs(items, {word, unitId:record.unitId, source:'checkpoint'}, true);
    for (const c of result.inlineCorrections) upsertSrs(items, {word:c.original, meaning:c.correction, example:c.explanationVi, unitId:record.unitId, source:'checkpoint-correction'}, true);
    writeJsonArray(studySrsFile, items);
    const checkpoints = readJsonArray(studyCheckpointsFile); checkpoints.push(record); writeJsonArray(studyCheckpointsFile, checkpoints);
    if (record.passed && record.unitId) { const progress = readJsonArray(studyProgressFile), i = progress.findIndex(x => x.unitId === record.unitId); const updated = { ...(i >= 0 ? progress[i] : {unitId:record.unitId, title:record.unitTitle, source:'checkpoint', steps:[]}), mastery:100, updatedAt:new Date().toISOString() }; if (i >= 0) progress[i] = updated; else progress.push(updated); writeJsonArray(studyProgressFile, progress); }
    return res.json(record);
  } catch { return res.status(500).json({ error: 'Failed to save checkpoint.' }); }
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

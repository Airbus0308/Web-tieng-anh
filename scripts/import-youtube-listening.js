#!/usr/bin/env node
/**
 * IELTS Master — YouTube Curriculum Listening Extractor
 *
 * Usage:
 *   npm run import:youtube -- "<YouTube_URL>" [output_slug] [start_time] [end_time]
 *
 * Examples:
 *   npm run import:youtube -- "https://www.youtube.com/watch?v=dQw4w9WgXcQ" cambridge-18-test-1
 *   npm run import:youtube -- "https://www.youtube.com/watch?v=dQw4w9WgXcQ" cambridge-18-sec1 00:00:30 00:07:45
 *
 * Extracts high-quality MP3 audio + English subtitles/auto-captions into:
 *   - assets/audio/<output_slug>.mp3
 *   - assets/audio/<output_slug>.en.vtt (if captions exist)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const audioDir = path.join(projectRoot, 'assets', 'audio');

if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

const args = process.argv.slice(2);
const youtubeUrl = args[0];
const slug = (args[1] || `ielts-listening-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-');
const startTime = args[2] || null;
const endTime = args[3] || null;

if (!youtubeUrl) {
  console.log(`
======================================================================
 🎧 IELTS Master — YouTube Curriculum Listening Extractor
======================================================================
Usage:
  npm run import:youtube -- "<YouTube_URL>" [output_name] [start_HH:MM:SS] [end_HH:MM:SS]

Example:
  npm run import:youtube -- "https://www.youtube.com/watch?v=XXXX" cambridge18-test1 00:00:15 00:06:40

Output:
  Saves extracted MP3 to: assets/audio/<output_name>.mp3
  You can then set audioUrl: "assets/audio/<output_name>.mp3" in js/questions.js!
======================================================================
`);
  process.exit(0);
}

// Detect yt-dlp and ffmpeg on Windows / PATH
const ytDlpCandidates = ['C:\\yt dlp\\yt-dlp.exe', 'yt-dlp'];
const ffmpegCandidates = ['C:\\yt dlp', 'C:\\ffmpeg\\ffmpeg-2025-01-30-git-1911a6ec26-full_build\\ffmpeg-2025-01-30-git-1911a6ec26-full_build\\bin'];

const ytDlpBin = ytDlpCandidates.find(p => p === 'yt-dlp' || fs.existsSync(p));
const ffmpegDir = ffmpegCandidates.find(d => fs.existsSync(d));

const outputTemplate = path.join(audioDir, `${slug}.%(ext)s`);
const ytArgs = [
  '--extract-audio',
  '--audio-format', 'mp3',
  '--audio-quality', '2',
  '--write-auto-sub',
  '--sub-lang', 'en',
  '--output', outputTemplate
];

if (ffmpegDir) {
  ytArgs.push('--ffmpeg-location', ffmpegDir);
}

if (startTime || endTime) {
  const range = `*${startTime || '00:00:00'}-${endTime || 'inf'}`;
  ytArgs.push('--download-sections', range);
}

ytArgs.push(youtubeUrl);

console.log(`[INFO] Extracting curriculum audio from: ${youtubeUrl}`);
console.log(`[INFO] Target file: assets/audio/${slug}.mp3`);

const result = spawnSync(ytDlpBin, ytArgs, { stdio: 'inherit' });

if (result.status === 0) {
  console.log(`\n[SUCCESS] Audio extracted to: assets/audio/${slug}.mp3`);
  console.log(`[TIP] Update listeningConfig.audioUrl = "assets/audio/${slug}.mp3" in js/questions.js to use it in the test!`);
} else {
  console.error(`\n[ERROR] yt-dlp exited with code ${result.status}`);
  process.exit(result.status || 1);
}

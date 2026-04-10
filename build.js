#!/usr/bin/env node
/**
 * WayPoint — Build Script
 * ════════════════════════════════════════════════════════════
 * Reads credentials from .env (local) or Netlify env vars
 * (production), injects them into HTML source files, and
 * writes deployment-ready files to /dist.
 *
 * Usage:
 *   npm run build          — full build → dist/
 *   node build.js --check  — validate env vars only
 *
 * ── NETLIFY SETUP (one-time) ────────────────────────────────
 *   1. Go to: Netlify Dashboard → Your Site → Site Configuration
 *             → Environment Variables → Add a variable
 *   2. Add these two variables:
 *        Key:   FIREBASE_PROJECT_ID
 *        Value: your-project-id   (from Firebase Console)
 *
 *        Key:   FIREBASE_API_KEY
 *        Value: AIzaSy...         (from Firebase Console)
 *   3. Trigger a new deploy — it will succeed.
 *
 *   Find values: Firebase Console → ⚙ Project Settings
 *                → Your apps → Web app → firebaseConfig
 * ════════════════════════════════════════════════════════════
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── 1. Load .env if it exists (local dev) ──────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
  console.log('✅  Loaded credentials from .env');
} else {
  console.log('ℹ️   No .env file — reading from Netlify environment variables');
}

// ── 2. Validate required variables ─────────────────────────
const REQUIRED = ['FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY'];
const missing  = REQUIRED.filter(k => !process.env[k] ||
                                       process.env[k].includes('your-') ||
                                       process.env[k].startsWith('__'));

if (missing.length) {
  console.error('\n╔══════════════════════════════════════════════════════════╗');
  console.error('║            ❌  BUILD FAILED — Missing credentials         ║');
  console.error('╠══════════════════════════════════════════════════════════╣');
  console.error('║                                                          ║');
  console.error('║  Missing environment variables:                          ║');
  missing.forEach(k => console.error(`║    • ${k.padEnd(52)}║`));
  console.error('║                                                          ║');
  console.error('║  ── HOW TO FIX ON NETLIFY ──────────────────────────────║');
  console.error('║                                                          ║');
  console.error('║  1. Open: Netlify Dashboard → your site                  ║');
  console.error('║  2. Go to: Site configuration → Environment variables    ║');
  console.error('║  3. Click "Add a variable" and add:                      ║');
  console.error('║                                                          ║');
  console.error('║     FIREBASE_PROJECT_ID = indoor-nav-59cd2               ║');
  console.error('║     FIREBASE_API_KEY    = AIzaSyBTzj9w1E22...            ║');
  console.error('║                                                          ║');
  console.error('║  4. Retrigger deploy — it will succeed.                  ║');
  console.error('║                                                          ║');
  console.error('║  ── WHERE TO FIND YOUR VALUES ─────────────────────────  ║');
  console.error('║  Firebase Console → ⚙ Project Settings                  ║');
  console.error('║  → Your apps → Web app → firebaseConfig                  ║');
  console.error('║  → Copy projectId  and  apiKey                           ║');
  console.error('║                                                          ║');
  console.error('╚══════════════════════════════════════════════════════════╝\n');
  process.exit(1);
}

if (process.argv.includes('--check')) {
  console.log('✅  All credentials present. Run `npm run build` to build.');
  process.exit(0);
}

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const API_KEY    = process.env.FIREBASE_API_KEY;

console.log(`\n🔥  Firebase Project: ${PROJECT_ID}`);
console.log(`🔑  API Key:          ${API_KEY.slice(0, 8)}${'*'.repeat(20)}\n`);

// ── 3. Files to process ────────────────────────────────────
const SRC_FILES = [
  'admin.html',
  'app.html',
  'index.html',
  'manifest.json',
  'sw.js',
  'routing-engine.js',
  'gps-worker.js',
];

// Binary files to copy as-is
const BINARY_FILES = [
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

// ── 4. Ensure dist/ exists and generate config.js ──────────
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// config.js is the runtime credential loader
const configContent = `window.WP_CONFIG={projectId:'${PROJECT_ID}',apiKey:'${API_KEY}'};`;
fs.writeFileSync(path.join(distDir, 'config.js'), configContent, 'utf8');
console.log('  ✅  config.js  (generated)');

// ── 5. Token replacement map ────────────────────────────────
const TOKENS = {
  '__FIREBASE_PROJECT_ID__': PROJECT_ID,
  '__FIREBASE_API_KEY__':    API_KEY,
};

// ── 6. Process text source files ────────────────────────────
let processed = 0;
for (const file of SRC_FILES) {
  const srcPath  = path.join(__dirname, file);
  const distPath = path.join(distDir, file);

  if (!fs.existsSync(srcPath)) {
    console.warn(`  ⚠️  Skipping (not found): ${file}`);
    continue;
  }

  let content = fs.readFileSync(srcPath, 'utf8');

  let replacements = 0;
  for (const [token, value] of Object.entries(TOKENS)) {
    const regex = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const count = (content.match(regex) || []).length;
    if (count > 0) {
      content = content.replace(regex, value);
      replacements += count;
    }
  }

  fs.writeFileSync(distPath, content, 'utf8');
  console.log(`  ✅  ${file}  (${replacements} token${replacements !== 1 ? 's' : ''} replaced)`);
  processed++;
}

// ── 7. Copy binary files ────────────────────────────────────
for (const file of BINARY_FILES) {
  const srcPath  = path.join(__dirname, file);
  const distPath = path.join(distDir, file);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, distPath);
    console.log(`  📋  ${file}  (copied)`);
  } else {
    console.warn(`  ⚠️  Skipping binary (not found): ${file}`);
  }
}

// ── 8. Verify no tokens leaked into dist ───────────────────
console.log('\n🔍  Verifying no placeholder tokens in dist...');
let leaks = 0;
for (const file of SRC_FILES) {
  const distPath = path.join(distDir, file);
  if (!fs.existsSync(distPath)) continue;
  const content = fs.readFileSync(distPath, 'utf8');
  for (const token of Object.keys(TOKENS)) {
    if (content.includes(token)) {
      console.error(`  ❌  LEAK: ${token} still present in ${file}`);
      leaks++;
    }
  }
}

if (leaks === 0) {
  console.log('  ✅  No token leaks detected.\n');
} else {
  console.error(`\n  ❌  ${leaks} token leak(s) found — do not deploy.\n`);
  process.exit(1);
}

console.log(`✨  Build complete → ./dist/  (${processed} files processed)\n`);
console.log('📦  Deploy the contents of ./dist/ to Netlify.\n');
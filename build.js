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
  console.log('ℹ️   No .env file — reading from environment (Netlify)');
}

// ── 2. Validate required variables ─────────────────────────
const REQUIRED = ['FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY'];
const missing  = REQUIRED.filter(k => !process.env[k] ||
                                       process.env[k].includes('your-'));

if (missing.length) {
  console.error('\n❌  Missing or placeholder credentials:');
  missing.forEach(k => console.error(`    ${k}`));
  console.error('\n   → Open .env and fill in your real Firebase values.');
  console.error('   → Firebase Console → Project Settings → Your apps → Config\n');
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

// ── 4. Generate dist/config.js with real credentials ───
// This ensures the config.js fallback in app.html works in dist/
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}
const configContent = `window.WP_CONFIG={projectId:'${PROJECT_ID}',apiKey:'${API_KEY}'};`;
fs.writeFileSync(path.join(distDir, 'config.js'), configContent, 'utf8');
console.log('  ✅  config.js  (generated for dist)');

// ── 5. Ensure dist/ exists ─────────────────────────────
// (already ensured above in config.js generation)

// ── 5. Token map ───────────────────────────────────────────
const TOKENS = {
  '__FIREBASE_PROJECT_ID__': PROJECT_ID,
  '__FIREBASE_API_KEY__':    API_KEY,
};

// ── 6. Process text files — inject credentials ─────────────
let processed = 0;
for (const file of SRC_FILES) {
  const srcPath  = path.join(__dirname, file);
  const distPath = path.join(distDir, file);

  if (!fs.existsSync(srcPath)) {
    console.warn(`  ⚠️  Skipping (not found): ${file}`);
    continue;
  }

  let content = fs.readFileSync(srcPath, 'utf8');

  // Replace tokens
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

// ── 7. Copy binary files ───────────────────────────────────
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

// ── 8. Verify no tokens leaked into dist ──────────────────
console.log('\n🔍  Verifying no placeholder tokens in dist...');
let leaks = 0;
for (const file of SRC_FILES) {
  const distPath = path.join(distDir, file);
  if (!fs.existsSync(distPath)) continue;
  const content = fs.readFileSync(distPath, 'utf8');
  for (const token of Object.keys(TOKENS)) {
    if (content.includes(token)) {
      console.error(`  ❌  LEAK: ${token} still in ${file}`);
      leaks++;
    }
  }
}

if (leaks === 0) {
  console.log('  ✅  No token leaks detected.\n');
} else {
  console.error(`\n  ❌  ${leaks} token leak(s) found! Do not deploy.\n`);
  process.exit(1);
}

console.log(`✨  Build complete → ./dist/  (${processed} files processed)\n`);
console.log('📦  Deploy the contents of ./dist/ to Netlify.\n');

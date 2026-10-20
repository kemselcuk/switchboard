import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 3110;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ADMIN_TOKEN = 'video-token';
const FLAG_KEY = 'demo-checkout';
const USER_KEPT = 'demo-user-01';
const USER_NEW = 'demo-user-14';

const rawDir = mkdtempSync(join(tmpdir(), 'switchboard-video-'));
const dbDir = mkdtempSync(join(tmpdir(), 'switchboard-video-db-'));
const outDir = join(ROOT, 'demo');
const outputPath = join(outDir, 'switchboard-demo.mp4');

mkdirSync(outDir, { recursive: true });

let server = null;
let browser = null;
let context = null;
let page = null;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || options.allowFailure) {
        resolvePromise({ code, stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function waitForHealth(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/healthz`);

      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await delay(100);
  }

  throw new Error('Server did not become healthy in time.');
}

async function startServer() {
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ADMIN_TOKEN,
      DB_PATH: join(dbDir, 'switchboard.db'),
      PORT: String(PORT),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';

  server.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  server.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  server.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Server exited with ${code}\n${logs}`);
    }
  });

  await waitForHealth();
}

async function stopServer() {
  if (!server) {
    return;
  }

  const child = server;

  server = null;

  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await new Promise((resolvePromise) => {
    child.once('exit', resolvePromise);
    setTimeout(resolvePromise, 3000);
  });
}

async function launchChrome() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
  }
}

async function setCaption(text) {
  await page.evaluate((caption) => {
    let node = document.getElementById('__switchboard_caption');

    if (!node) {
      node = document.createElement('div');
      node.id = '__switchboard_caption';
      document.body.append(node);
    }

    Object.assign(node.style, {
      position: 'fixed',
      top: '18px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      width: 'min(1040px, calc(100vw - 48px))',
      padding: '12px 18px',
      borderRadius: '12px',
      background: 'rgba(8, 12, 20, 0.92)',
      color: '#f6f7fb',
      border: '1px solid rgba(255, 255, 255, 0.16)',
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.35)',
      font: '600 19px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      textAlign: 'center',
      pointerEvents: 'none',
    });
    node.textContent = caption;
  }, text);
}

function titleCard() {
  return `<!doctype html>
  <html lang="tr">
    <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 20%,#19314f,#080b12 60%);color:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <main style="text-align:center;padding:48px">
        <p style="letter-spacing:.22em;text-transform:uppercase;font-size:13px;color:#7dd3fc;margin:0 0 18px">Feature flag service</p>
        <h1 style="font-size:74px;line-height:1;margin:0 0 18px">Switchboard</h1>
        <p style="font-size:24px;color:#cbd5e1;margin:0">Deterministik yüzdelik rollout.<br>Aynı kullanıcı, aynı sonuç.</p>
        <p style="margin-top:42px;color:#64748b;font-size:15px">Kısa demo · ses yok · gerçek servis</p>
      </main>
    </body>
  </html>`;
}

function card(title, lines, footer = '') {
  const body = lines
    .map((line) => `<p style="margin:8px 0;color:#cbd5e1;font-size:19px">${line}</p>`)
    .join('');

  return `<!doctype html>
  <html lang="tr">
    <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 80% 10%,#143047,#080b12 65%);color:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <main style="width:min(1080px,calc(100vw - 80px));padding:48px 56px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:rgba(9,14,24,.78);box-shadow:0 30px 80px rgba(0,0,0,.35)">
        <h1 style="font-size:38px;margin:0 0 24px">${title}</h1>
        ${body}
        <p style="margin:30px 0 0;color:#7dd3fc;font-size:15px">${footer}</p>
      </main>
    </body>
  </html>`;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function main() {
  await startServer();
  browser = await launchChrome();
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: rawDir,
      size: { width: 1280, height: 720 },
    },
  });
  page = await context.newPage();

  await page.setContent(titleCard());
  await delay(5000);

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('#health-status')?.textContent === 'Sağlıklı',
    { timeout: 10000 },
  );
  await setCaption('1/6 — Servis sağlıklı. Admin token ile bağlanıyoruz.');
  await delay(4000);

  await page.fill('#admin-token', ADMIN_TOKEN);
  await page.click('#token-form button[type="submit"]');
  await page.waitForSelector('#flag-list .empty', { timeout: 10000 });
  await delay(1200);

  await setCaption('2/6 — Yeni flag: demo-checkout, %20 rollout, açık.');
  await page.fill('#flag-key', FLAG_KEY);
  await page.fill('#flag-description', 'Video demo: deterministik rollout');
  await page.check('#flag-enabled');
  await page.fill('#flag-rollout', '20');
  await page.click('#create-flag-form button[type="submit"]');
  await page.waitForFunction(
    (key) => document.querySelector('#flag-list')?.textContent.includes(key),
    FLAG_KEY,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    (key) => document.querySelector('#evaluate-flag')?.value === key,
    FLAG_KEY,
    { timeout: 10000 },
  );
  await delay(3500);

  await setCaption(`3/6 — ${USER_KEPT}: aynı kullanıcı, aynı bucket.`);
  await page.fill('#evaluate-user', USER_KEPT);
  await page.click('#evaluate-form button[type="submit"]');
  await page.waitForSelector('#evaluation-result:not([hidden])', {
    timeout: 10000,
  });
  const keptBucket = (await page.textContent('#result-bucket')).trim();
  const keptEnabled = (await page.textContent('#result-enabled')).trim();
  await delay(4000);

  await setCaption(`4/6 — ${USER_NEW}: %20'de kapalı.`);
  await page.fill('#evaluate-user', USER_NEW);
  await page.click('#evaluate-form button[type="submit"]');
  await page.waitForFunction(
    (user) => document.querySelector('#result-user')?.textContent === user,
    USER_NEW,
    { timeout: 10000 },
  );
  await delay(4000);

  await setCaption('5/6 — %20 → %40: önceki açık grup korunuyor.');
  await page.click('#compare-run');
  await page.waitForSelector('#compare-summary:not([hidden])', {
    timeout: 20000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('#compare-body tr').length === 12,
    { timeout: 10000 },
  );
  const summary = (await page.textContent('#compare-summary')).trim();
  await delay(6500);

  await setCaption('6/6 — Sunucu yeniden başlatılıyor. Aynı ayar, aynı kullanıcı.');
  await stopServer();
  await startServer();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('#health-status')?.textContent === 'Sağlıklı',
    { timeout: 10000 },
  );
  await page.waitForFunction(
    (key) => document.querySelector('#evaluate-flag')?.value === key,
    FLAG_KEY,
    { timeout: 10000 },
  );
  await page.fill('#evaluate-user', USER_KEPT);
  await page.click('#evaluate-form button[type="submit"]');
  await page.waitForSelector('#evaluation-result:not([hidden])', {
    timeout: 10000,
  });
  const afterRestartBucket = (await page.textContent('#result-bucket')).trim();
  const afterRestartEnabled = (await page.textContent('#result-enabled')).trim();
  await setCaption(
    `Restart sonrası: bucket ${afterRestartBucket}, durum ${afterRestartEnabled}. `
      + `Önce: bucket ${keptBucket}, durum ${keptEnabled}.`,
  );
  await delay(6500);

  const tests = await run('npm', ['test']);
  const testTail = tests.stdout
    .trim()
    .split('\n')
    .slice(-12)
    .join('\n');
  const testMatch = tests.stdout.match(/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)/);
  const testLabel = testMatch
    ? `${testMatch[2]}/${testMatch[1]} test geçti.`
    : 'Testler geçti.';

  await page.setContent(card(
    'Testler',
    [
      `<span style="color:#86efac">${escapeHtml(testLabel)}</span>`,
      `Demo özeti: ${escapeHtml(summary)}`,
    ],
    'npm test · node:test · Fastify inject',
  ));
  await page.evaluate((text) => {
    const pre = document.createElement('pre');

    pre.textContent = text;
    Object.assign(pre.style, {
      margin: '22px 0 0',
      padding: '16px',
      borderRadius: '12px',
      background: '#020617',
      color: '#cbd5e1',
      fontSize: '13px',
      lineHeight: '1.45',
      whiteSpace: 'pre-wrap',
      overflow: 'hidden',
    });
    document.querySelector('main').append(pre);
  }, testTail);
  await delay(9000);

  await page.setContent(card(
    'Switchboard',
    [
      'Deterministik bucket: SHA-256(flagKey + ":" + userId)',
      'Boolean flag + yüzdelik rollout + SQLite kalıcılığı',
      'API: POST /api/evaluate · demo: /',
    ],
    'github.com/kemselcuk/switchboard · docs/EVIDENCE.md',
  ));
  await delay(8000);

  const video = page.video();

  await context.close();
  context = null;
  await browser.close();
  browser = null;

  const rawVideo = await video.path();

  await run('ffmpeg', [
    '-y',
    '-i',
    rawVideo,
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ]);

  const size = statSync(outputPath).size;

  console.log(`Video: ${outputPath}`);
  console.log(`Boyut: ${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Demo: ${summary}`);
  console.log(`Restart: bucket ${keptBucket} -> ${afterRestartBucket}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopServer();

  if (context) {
    await context.close().catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
  }

  rmSync(rawDir, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
}

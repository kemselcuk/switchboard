import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 3111;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ADMIN_TOKEN = 'video-admin-token';
const USER_ID = 'demo-user-07';
const ROLLOUT_USERS = Array.from(
  { length: 500 },
  (_, index) => `rollout-user-${String(index + 1).padStart(4, '0')}`,
);

const rawDir = mkdtempSync(join(tmpdir(), 'switchboard-v2-video-'));
const dbDir = mkdtempSync(join(tmpdir(), 'switchboard-v2-video-db-'));
const outDir = join(ROOT, 'demo');
const outputPath = join(outDir, 'switchboard-v2-demo.mp4');

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

async function api(path, { method = 'GET', body, apiKey, admin = true } = {}) {
  const headers = { accept: 'application/json' };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  if (admin) {
    headers.authorization = `Bearer ${ADMIN_TOKEN}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  return { status: response.status, payload };
}

async function waitForHealth(timeoutMs = 15000) {
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
      SWITCHBOARD_V2: 'true',
      V2_DB_PATH: join(dbDir, 'switchboard-v2.db'),
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
      width: 'min(1120px, calc(100vw - 48px))',
      padding: '12px 18px',
      borderRadius: '12px',
      background: 'rgba(8, 12, 20, 0.94)',
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function pageShell(content) {
  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 18% 12%,#17324f,#070a11 62%);color:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <main style="width:min(1120px,calc(100vw - 72px));padding:44px 52px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:rgba(9,14,24,.8);box-shadow:0 30px 80px rgba(0,0,0,.38)">
        ${content}
      </main>
    </body>
  </html>`;
}

function card(title, lines, footer = '') {
  const body = lines
    .map((line) => `<p style="margin:10px 0;color:#cbd5e1;font-size:20px">${line}</p>`)
    .join('');

  return pageShell(`
    <p style="letter-spacing:.2em;text-transform:uppercase;font-size:12px;color:#7dd3fc;margin:0 0 14px">Switchboard v2 evidence</p>
    <h1 style="font-size:38px;line-height:1.15;margin:0 0 22px">${title}</h1>
    ${body}
    <p style="margin:28px 0 0;color:#7dd3fc;font-size:15px">${footer}</p>
  `);
}

function terminalCard(title, output, footer = '') {
  return pageShell(`
    <p style="letter-spacing:.2em;text-transform:uppercase;font-size:12px;color:#7dd3fc;margin:0 0 12px">Switchboard v2 evidence</p>
    <h1 style="font-size:34px;margin:0 0 18px">${title}</h1>
    <pre style="margin:0;padding:18px;border-radius:14px;background:#020617;color:#dbeafe;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap">${escapeHtml(output)}</pre>
    <p style="margin:18px 0 0;color:#7dd3fc;font-size:15px">${footer}</p>
  `);
}

async function submit(selector) {
  await page.click(`${selector} button[type="submit"]`);
}

async function waitStatus(id) {
  try {
    await page.waitForFunction(
      (statusId) => document.querySelector(`#${statusId}`)?.dataset.kind === 'ok',
      id,
      { timeout: 15000 },
    );
  } catch (error) {
    console.error(`Status ${id}:`, await page.textContent(`#${id}`));
    throw error;
  }
}

async function showUi() {
  await page.goto(`${BASE_URL}/v2.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelector('#health-status')?.textContent === 'Healthy',
    { timeout: 10000 },
  );
}

async function evaluate(key, flagKey, userId) {
  const response = await api(
    `/ofrep/v1/evaluate/flags/${encodeURIComponent(flagKey)}`,
    {
      method: 'POST',
      admin: false,
      apiKey: key,
      body: { context: { targetingKey: userId } },
    },
  );

  return response;
}

async function createFlag(project, flagKey, rolloutPercentage) {
  const response = await api(
    `/api/v1/projects/${project}/environments/production/flags`,
    {
      method: 'POST',
      body: {
        key: flagKey,
        description: 'v2 video evidence',
        enabled: true,
        rolloutPercentage,
      },
    },
  );

  if (response.status !== 201) {
    throw new Error(`createFlag ${flagKey}: ${response.status} ${JSON.stringify(response.payload)}`);
  }

  return response.payload;
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

  await page.setContent(pageShell(`
    <p style="letter-spacing:.22em;text-transform:uppercase;font-size:13px;color:#7dd3fc;margin:0 0 18px">Feature flag service · v2</p>
    <h1 style="font-size:66px;line-height:1.05;margin:0 0 20px">Switchboard v2</h1>
    <p style="font-size:24px;color:#cbd5e1;margin:0;max-width:820px">Projects, environments, environment API keys, OFREP evaluation, and deterministic percentage rollouts.</p>
    <p style="margin-top:42px;color:#64748b;font-size:15px">Silent recording · real local service · 2–3 minutes</p>
  `));
  await delay(7000);

  await showUi();
  await setCaption('1/8 — Admin token and project bootstrap.');
  await page.fill('#admin-token', ADMIN_TOKEN);
  await submit('#token-form');
  await page.fill('#project-key', 'demo');
  await page.fill('#project-name', 'Checkout demo');
  await submit('#project-form');
  await waitStatus('project-status');
  await delay(6000);

  await setCaption('2/8 — A production environment inside the project.');
  await page.fill('#env-key', 'production');
  await submit('#environment-form');
  await waitStatus('environment-status');
  await delay(6000);

  await setCaption('3/8 — Boolean flag new-checkout, enabled at 20%.');
  await page.fill('#flag-key', 'new-checkout');
  await page.fill('#flag-description', 'New checkout flow');
  await page.fill('#flag-rollout', '20');
  await submit('#flag-form');
  await waitStatus('flag-status');
  await delay(6000);

  await setCaption('4/8 — Environment API key, shown once and stored hashed.');
  await submit('#key-form');
  await waitStatus('key-status');
  const apiKey = (await page.textContent('#api-key-secret')).trim();
  await delay(5500);

  await setCaption(`5/8 — OFREP evaluation for ${USER_ID}.`);
  await page.fill('#evaluate-user', USER_ID);
  await submit('#evaluate-form');
  await page.waitForSelector('#evaluate-result:not([hidden])', { timeout: 10000 });
  const uiValue = (await page.textContent('#result-value')).trim();
  const uiReason = (await page.textContent('#result-reason')).trim();
  await delay(6500);

  const other = await api('/api/v1/projects', {
    method: 'POST',
    body: { key: 'other', name: 'Other service' },
  });
  if (other.status !== 201) {
    throw new Error(`other project: ${other.status}`);
  }
  await api('/api/v1/projects/other/environments', {
    method: 'POST',
    body: { key: 'production', name: 'Production' },
  });
  await createFlag('other', 'other-only', 100);
  const otherKey = await api(
    '/api/v1/projects/other/environments/production/api-keys',
    { method: 'POST', body: { name: 'other server' } },
  );

  const crossProject = await evaluate(apiKey, 'other-only', USER_ID);
  const sameProject = await evaluate(otherKey.payload.key, 'other-only', USER_ID);

  await page.setContent(card('Project isolation', [
    `demo key + <code>other-only</code> → <strong>HTTP ${crossProject.status}</strong> ${escapeHtml(JSON.stringify(crossProject.payload))}`,
    `other key + <code>other-only</code> → <strong>HTTP ${sameProject.status}</strong>, value <strong>${sameProject.payload.value}</strong>`,
    'Environment API keys are scoped to one project/environment.',
  ], 'Cross-project requests return flag-not-found; no key can read another project.'));
  await delay(12000);

  await createFlag('demo', 'rollout-check', 20);
  const demoKey = await api(
    '/api/v1/projects/demo/environments/production/api-keys',
    { method: 'POST', body: { name: 'rollout check' } },
  );
  const key = demoKey.payload.key;

  async function includedUsers() {
    const included = [];

    for (const user of ROLLOUT_USERS) {
      const result = await evaluate(key, 'rollout-check', user);

      if (result.payload?.value === true) {
        included.push(user);
      }
    }

    return included;
  }

  const at20 = await includedUsers();
  await api('/api/v1/projects/demo/environments/production/flags/rollout-check', {
    method: 'PATCH',
    body: { rolloutPercentage: 40 },
  });
  const at40 = await includedUsers();
  const subset = at20.every((user) => at40.includes(user));

  if (!subset) {
    throw new Error('20% set is not a subset of the 40% set');
  }

  await page.setContent(card('20% → 40% monotonicity', [
    `Fixed user list: <strong>${ROLLOUT_USERS.length}</strong> IDs`,
    `Included at 20%: <strong>${at20.length}</strong>`,
    `Included at 40%: <strong>${at40.length}</strong>`,
    `Every 20% user is still included at 40%: <strong>${subset}</strong>`,
  ], 'Same SHA-256 buckets; raising the threshold only adds users.'));
  await delay(13000);

  const demo = await run('npm', ['run', 'demo:v2'], {
    env: {
      ADMIN_TOKEN,
      BASE_URL,
      SWITCHBOARD_PROJECT: 'demo',
      SWITCHBOARD_ENV: 'production',
      SWITCHBOARD_FLAG: 'new-checkout',
      SWITCHBOARD_USER: USER_ID,
    },
  });
  const serviceLines = demo.stdout
    .split('\n')
    .filter((line) => line.startsWith('{"service"'))
    .join('\n');
  const demoLines = demo.stdout
    .split('\n')
    .filter((line) => /^(Project|Environment|Flag|API key prefix):/.test(line))
    .join('\n');

  await page.setContent(terminalCard(
    'Two services · one flag',
    `${demoLines}\n\n${serviceLines}`,
    'service-a uses the SDK; service-b uses the OpenFeature provider.',
  ));
  await delay(17000);

  const legacyCreate = await api('/api/flags', {
    method: 'POST',
    body: {
      key: 'legacy-checkout',
      description: 'Legacy compatibility',
      enabled: true,
      rolloutPercentage: 37,
    },
  });
  const legacyList = await api('/api/flags');
  const legacyEvaluation = await api('/api/evaluate', {
    method: 'POST',
    body: { flagKey: 'legacy-checkout', userId: USER_ID },
  });
  const legacyFlag = legacyList.payload.flags.find(
    (flag) => flag.key === 'legacy-checkout',
  );

  await page.setContent(terminalCard(
    'Legacy v1 API compatibility',
    [
      `POST /api/flags → HTTP ${legacyCreate.status}`,
      JSON.stringify(legacyFlag),
      '',
      `POST /api/evaluate → HTTP ${legacyEvaluation.status}`,
      JSON.stringify(legacyEvaluation.payload),
    ].join('\n'),
    'Numeric ID preserved via legacy_id; v1 bucket algorithm unchanged.',
  ));
  await delay(15000);

  const tests = await run('npm', ['test']);
  const match = tests.stdout.match(/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ skipped (\d+)/);
  const testLabel = match
    ? `${match[2]}/${match[1]} passed, ${match[3]} skipped`
    : 'tests passed';

  await page.setContent(card('Verification', [
    `<span style="color:#86efac">${escapeHtml(testLabel)}</span>`,
    `UI OFREP result: value <strong>${escapeHtml(uiValue)}</strong>, reason <strong>${escapeHtml(uiReason)}</strong>`,
    `Legacy numeric id: <strong>${escapeHtml(legacyFlag.id)}</strong>`,
    `Monotonic 20% → 40%: <strong>${subset}</strong>`,
  ], 'npm test · Fastify inject · SQLite v2'));
  await delay(12000);

  await page.setContent(pageShell(`
    <p style="letter-spacing:.22em;text-transform:uppercase;font-size:13px;color:#7dd3fc;margin:0 0 18px">Switchboard v2</p>
    <h1 style="font-size:56px;line-height:1.08;margin:0 0 20px">Projects, keys, OFREP, SDK</h1>
    <p style="font-size:23px;color:#cbd5e1;margin:0;max-width:860px">Deterministic rollouts, isolated projects, official-provider compatibility, and the legacy API preserved.</p>
    <p style="margin-top:40px;color:#64748b;font-size:15px">Evidence: README · docs/EVIDENCE.md · docs/EXPANSION_PLAN.md</p>
  `));
  await delay(12000);

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
  console.log(`Size: ${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`20% included: ${at20.length}/${ROLLOUT_USERS.length}`);
  console.log(`40% included: ${at40.length}/${ROLLOUT_USERS.length}`);
  console.log(`Subset: ${subset}`);
  console.log(`Legacy id: ${legacyFlag.id}`);
  console.log(serviceLines);
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

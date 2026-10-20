import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import http from 'node:http';

const ROOT = new URL('..', import.meta.url).pathname;
const ADMIN_TOKEN = 'bench-admin-token';
const PROJECT_KEY = `bench-${Date.now().toString(36)}`;
const ENVIRONMENT_KEY = 'production';
const FLAG_KEY = 'bench-flag';
const USER_ID = 'bench-user-001';
const DURATION = Number(process.env.BENCH_DURATION ?? 10);
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS ?? 10);
const DATABASE_URL = process.env.DATABASE_URL;
const WARMUP_REQUESTS = 20;

const dbDirectory = mkdtempSync(join(tmpdir(), 'switchboard-bench-'));

let server = null;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();

      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);

      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await delay(100);
  }

  throw new Error('Benchmark server did not become healthy in time.');
}

async function request(baseUrl, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

async function startServer(port) {
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ADMIN_TOKEN,
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      ...(DATABASE_URL
        ? { DATABASE_URL }
        : {
          SWITCHBOARD_V2: 'true',
          V2_DB_PATH: join(dbDirectory, 'switchboard-v2.db'),
        }),
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
      console.error(`Benchmark server exited with ${code}\n${logs}`);
    }
  });
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
  await new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(resolve, 3000);
  });
}

function once(url, path, apiKey, agent) {
  const body = JSON.stringify({ context: { targetingKey: USER_ID } });

  return new Promise((resolve, reject) => {
    const started = performance.now();
    const request = http.request(
      `${url}${path}`,
      {
        method: 'POST',
        agent,
        headers: {
          'x-api-key': apiKey,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let bytes = 0;

        response.on('data', (chunk) => {
          bytes += chunk.length;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            latency: performance.now() - started,
            bytes,
          });
        });
        response.on('error', reject);
      },
    );

    request.on('error', reject);
    request.end(body);
  });
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length),
  );

  return sorted[index];
}

async function load({ url, path, apiKey }) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const deadline = performance.now() + DURATION * 1000;
  const latencies = [];
  const statusCodeCounts = new Map();
  let requests = 0;
  let errors = 0;

  async function worker() {
    while (performance.now() < deadline) {
      try {
        const result = await once(url, path, apiKey, agent);

        requests += 1;
        latencies.push(result.latency);
        statusCodeCounts.set(
          result.status,
          (statusCodeCounts.get(result.status) ?? 0) + 1,
        );
      } catch {
        requests += 1;
        errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: CONNECTIONS }, worker));

  const sorted = [...latencies].sort((left, right) => left - right);
  const non2xx = [...statusCodeCounts.entries()]
    .filter(([status]) => status < 200 || status >= 300)
    .reduce((total, [, count]) => total + count, 0);

  return {
    requests,
    requestsPerSecond: Number((requests / DURATION).toFixed(1)),
    latencyAvgMs: Number(
      (latencies.reduce((total, value) => total + value, 0)
        / Math.max(latencies.length, 1)).toFixed(2),
    ),
    latencyP50Ms: Number(percentile(sorted, 0.5).toFixed(2)),
    latencyP99Ms: Number(percentile(sorted, 0.99).toFixed(2)),
    errors,
    non2xx,
  };
}

async function warmup(url, apiKey) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

  for (let index = 0; index < WARMUP_REQUESTS; index += 1) {
    const result = await once(
      url,
      `/ofrep/v1/evaluate/flags/${FLAG_KEY}`,
      apiKey,
      agent,
    );

    if (result.status !== 200) {
      throw new Error(`Warmup failed: HTTP ${result.status}`);
    }
  }
}

function printScenario(name, result) {
  console.log(`Scenario: ${name}`);
  console.log(`  Requests/sec: ${result.requestsPerSecond}`);
  console.log(`  Latency avg: ${result.latencyAvgMs} ms`);
  console.log(`  Latency p50: ${result.latencyP50Ms} ms`);
  console.log(`  Latency p99: ${result.latencyP99Ms} ms`);
  console.log(`  Errors: ${result.errors}, non-2xx: ${result.non2xx}`);
  console.log('');
}

async function main() {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const baseUrl = url;

  await startServer(port);
  await waitForHealth(baseUrl);

  try {
    await request(baseUrl, '/api/v1/projects', {
      method: 'POST',
      body: { key: PROJECT_KEY, name: 'Benchmark project' },
    });
    await request(
      baseUrl,
      `/api/v1/projects/${PROJECT_KEY}/environments`,
      { method: 'POST', body: { key: ENVIRONMENT_KEY, name: 'Production' } },
    );
    await request(
      baseUrl,
      `/api/v1/projects/${PROJECT_KEY}/environments/${ENVIRONMENT_KEY}/flags`,
      {
        method: 'POST',
        body: { key: FLAG_KEY, enabled: true, rolloutPercentage: 100 },
      },
    );
    const key = await request(
      baseUrl,
      `/api/v1/projects/${PROJECT_KEY}/environments/${ENVIRONMENT_KEY}/api-keys`,
      { method: 'POST', body: { name: 'benchmark' } },
    );

    await warmup(url, key.key);

    const single = await load({
      url,
      path: `/ofrep/v1/evaluate/flags/${FLAG_KEY}`,
      apiKey: key.key,
    });
    const bulk = await load({
      url,
      path: '/ofrep/v1/evaluate/flags',
      apiKey: key.key,
    });

    console.log(`Dialect: ${DATABASE_URL ? 'postgres' : 'sqlite'}`);
    console.log(`Connections: ${CONNECTIONS}, duration: ${DURATION}s per scenario`);
    console.log('');

    printScenario(`single-flag (${FLAG_KEY})`, single);
    printScenario('bulk-flags', bulk);

    if (
      single.errors > 0 || single.non2xx > 0
      || bulk.errors > 0 || bulk.non2xx > 0
    ) {
      throw new Error('Benchmark scenarios reported errors or non-2xx responses.');
    }
  } finally {
    await stopServer();
    rmSync(dbDirectory, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopServer();
}

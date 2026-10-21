import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SwitchboardClient } from '../src/index.js';

async function startServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Could not get server address');
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }

    await sleep(5);
  }
}

function bulkResponse(flags: unknown[]): string {
  return JSON.stringify({
    flags,
    metadata: { version: 'bulk-v1' },
  });
}

type ChildResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

// Runs a script in a fresh Node process so the test can prove the SDK keeps a
// standalone awaited call alive on its own, without the test runner's handles.
function runChildNode(
  script: string,
  env: Record<string, string>,
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';

    // Safety net: a hung child must fail the test instead of blocking it.
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(
        `child process did not exit; stdout=${stdout} stderr=${stderr}`,
      ));
    }, 15000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(killTimer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolve({ code, stdout, stderr });
    });
  });
}

test('sends the API key and evaluation context to OFREP', async (t) => {
  let received: unknown;
  const server = await startServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      received = {
        apiKey: request.headers['x-api-key'],
        body: JSON.parse(body),
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        key: 'new-checkout',
        value: true,
        reason: 'SPLIT',
        variant: 'enabled',
      }));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'sb_srv_test_key',
  });
  t.after(() => client.close());

  const details = await client.getBooleanDetails(
    'new-checkout',
    false,
    { targetingKey: 'user-1', plan: 'premium' },
  );

  assert.deepEqual(details, {
    key: 'new-checkout',
    value: true,
    reason: 'SPLIT',
    variant: 'enabled',
  });
  assert.deepEqual(received, {
    apiKey: 'sb_srv_test_key',
    body: { context: { targetingKey: 'user-1', plan: 'premium' } },
  });
});

test('falls back to the default on FLAG_NOT_FOUND', async (t) => {
  const server = await startServer((_request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      key: 'missing',
      errorCode: 'FLAG_NOT_FOUND',
    }));
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
  });
  t.after(() => client.close());

  const details = await client.getBooleanDetails('missing', true);

  assert.equal(details.value, true);
  assert.equal(details.errorCode, 'FLAG_NOT_FOUND');
  assert.equal(details.reason, 'ERROR');
});

test('falls back to the default on 503', async (t) => {
  const server = await startServer((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
  });
  t.after(() => client.close());

  const details = await client.getBooleanDetails('flag', true);

  assert.equal(details.value, true);
  assert.equal(details.errorCode, 'EVALUATION_UNAVAILABLE');
});

test('times out with a stable error code', async (t) => {
  const server = await startServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ key: 'flag', value: true, reason: 'SPLIT' }));
    }, 200);
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    timeoutMs: 30,
  });
  t.after(() => client.close());

  const details = await client.getBooleanDetails('flag', false);

  assert.equal(details.value, false);
  assert.equal(details.errorCode, 'TIMEOUT');
});

test('returns a network error when the server is unreachable', async () => {
  const client = new SwitchboardClient({
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'key',
    timeoutMs: 100,
    retryBaseDelayMs: 0,
  });

  try {
    const details = await client.getBooleanDetails('flag', false);

    assert.equal(details.value, false);
    assert.equal(details.errorCode, 'NETWORK_ERROR');
  } finally {
    client.close();
  }
});

test('bulk mode evaluates two flags for one context with one request', async (t) => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const server = await startServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({
        url: request.url ?? '',
        body: JSON.parse(body),
      });
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"bulk-v1"',
      });
      response.end(bulkResponse([
        {
          key: 'checkout',
          value: true,
          reason: 'TARGETING_MATCH',
          variant: 'on',
        },
        { key: 'search', value: false, reason: 'DEFAULT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'sb_srv_test_key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
  });
  t.after(() => client.close());

  const [checkout, search] = await Promise.all([
    client.getBooleanDetails('checkout', false, {
      targetingKey: 'user-1',
      traits: { plan: 'pro', beta: true },
    }),
    client.getBooleanDetails('search', true, {
      traits: { beta: true, plan: 'pro' },
      targetingKey: 'user-1',
    }),
  ]);

  assert.deepEqual(checkout, {
    key: 'checkout',
    value: true,
    reason: 'TARGETING_MATCH',
    variant: 'on',
  });
  assert.deepEqual(search, {
    key: 'search',
    value: false,
    reason: 'DEFAULT',
    variant: undefined,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/ofrep/v1/evaluate/flags');
  assert.deepEqual(requests[0].body, {
    context: {
      targetingKey: 'user-1',
      traits: { plan: 'pro', beta: true },
    },
  });
});

test('revalidates with If-None-Match and reuses the cache on 304', async (t) => {
  const requests: Array<{ ifNoneMatch?: string; status: number }> = [];
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const ifNoneMatch = request.headers['if-none-match'];

      if (ifNoneMatch === '"bulk-v1"') {
        requests.push({ ifNoneMatch, status: 304 });
        response.writeHead(304, { etag: '"bulk-v1"' });
        response.end();
        return;
      }

      requests.push({
        ifNoneMatch: typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined,
        status: 200,
      });
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"bulk-v1"',
      });
      response.end(bulkResponse([
        { key: 'checkout', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 50,
  });
  t.after(() => client.close());

  const first = await client.getBooleanDetails(
    'checkout',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(first.value, true);
  assert.equal(requests.length, 1);

  await sleep(100);

  const second = await client.getBooleanDetails(
    'checkout',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(second.value, true);
  assert.equal(second.reason, 'SPLIT');
  assert.equal(second.errorCode, undefined);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].ifNoneMatch, '"bulk-v1"');
  assert.equal(requests[1].status, 304);
});

test('serves repeated evaluations from a fresh per-context cache', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"fresh-v1"',
      });
      response.end(bulkResponse([
        { key: 'alpha', value: true, reason: 'SPLIT' },
        { key: 'beta', value: false, reason: 'DEFAULT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
  });
  t.after(() => client.close());

  const first = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );
  const second = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );
  const third = await client.getBooleanValue(
    'beta',
    true,
    { targetingKey: 'user-1' },
  );

  assert.equal(first.value, true);
  assert.equal(second.value, true);
  assert.equal(third, false);
  assert.equal(requestCount, 1);

  const otherContext = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-2' },
  );

  assert.equal(otherContext.value, true);
  assert.equal(requestCount, 2);
});

test('keeps background polling disabled by default', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"static-v1"',
      });
      response.end(bulkResponse([
        { key: 'alpha', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 20,
  });
  t.after(() => client.close());

  const first = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );

  await sleep(60);

  assert.equal(first.value, true);
  assert.equal(requestCount, 1);

  const second = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(second.value, true);
  assert.equal(requestCount, 2);
});

test('maps missing and non-boolean bulk flags to error details', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(bulkResponse([
        { key: 'stringy', value: 'yes', reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
  });
  t.after(() => client.close());

  const missing = await client.getBooleanDetails(
    'missing',
    true,
    { targetingKey: 'user-1' },
  );
  const stringy = await client.getBooleanDetails(
    'stringy',
    false,
    { targetingKey: 'user-1' },
  );

  assert.deepEqual(missing, {
    key: 'missing',
    value: true,
    reason: 'ERROR',
    errorCode: 'FLAG_NOT_FOUND',
    errorMessage: "Flag 'missing' was not found",
  });
  assert.deepEqual(stringy, {
    key: 'stringy',
    value: false,
    reason: 'ERROR',
    errorCode: 'TYPE_MISMATCH',
    errorMessage: 'Switchboard returned a non-boolean value',
  });
  assert.equal(requestCount, 1);
});

test('returns string, number and object values from OFREP', async (t) => {
  const server = await startServer((request, response) => {
    const key = decodeURIComponent((request.url ?? '').split('/').pop() ?? '');
    const evaluations: Record<
      string,
      { value: unknown; reason: string; variant?: string }
    > = {
      theme: { value: 'dark', reason: 'SPLIT', variant: 'on' },
      'max-seats': { value: 12, reason: 'SPLIT', variant: 'on' },
      'ui-config': {
        value: { theme: 'dark', columns: 3 },
        reason: 'SPLIT',
        variant: 'on',
      },
    };

    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ key, ...evaluations[key] }));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
  });
  t.after(() => client.close());

  const theme = await client.getStringDetails('theme', 'light');
  const seats = await client.getNumberDetails('max-seats', 1);
  const config = await client.getObjectDetails(
    'ui-config',
    { theme: 'light' },
    { targetingKey: 'user-1' },
  );

  assert.deepEqual(theme, {
    key: 'theme',
    value: 'dark',
    reason: 'SPLIT',
    variant: 'on',
  });
  assert.deepEqual(seats, {
    key: 'max-seats',
    value: 12,
    reason: 'SPLIT',
    variant: 'on',
  });
  assert.deepEqual(config, {
    key: 'ui-config',
    value: { theme: 'dark', columns: 3 },
    reason: 'SPLIT',
    variant: 'on',
  });

  assert.equal(await client.getStringValue('theme', 'light'), 'dark');
  assert.equal(await client.getNumberValue('max-seats', 1), 12);
  assert.deepEqual(
    await client.getObjectValue('ui-config', { theme: 'light' }),
    { theme: 'dark', columns: 3 },
  );
});

test('falls back with TYPE_MISMATCH when a value has the wrong type', async (t) => {
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        key: 'flag',
        value: true,
        reason: 'SPLIT',
      }));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
  });
  t.after(() => client.close());

  const stringDetails = await client.getStringDetails('flag', 'fallback');
  const numberDetails = await client.getNumberDetails('flag', 7);
  const objectDetails = await client.getObjectDetails(
    'flag',
    { fallback: true },
  );

  assert.deepEqual(stringDetails, {
    key: 'flag',
    value: 'fallback',
    reason: 'ERROR',
    errorCode: 'TYPE_MISMATCH',
    errorMessage: 'Switchboard returned a non-string value',
  });
  assert.deepEqual(numberDetails, {
    key: 'flag',
    value: 7,
    reason: 'ERROR',
    errorCode: 'TYPE_MISMATCH',
    errorMessage: 'Switchboard returned a non-number value',
  });
  assert.deepEqual(objectDetails, {
    key: 'flag',
    value: { fallback: true },
    reason: 'ERROR',
    errorCode: 'TYPE_MISMATCH',
    errorMessage: 'Switchboard returned a non-object value',
  });
});

test('treats non-finite numbers as TYPE_MISMATCH', async (t) => {
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      // 1e400 parses to Infinity, which JSON cannot represent on the wire.
      response.end('{"key":"ratio","value":1e400,"reason":"SPLIT"}');
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
  });
  t.after(() => client.close());

  const details = await client.getNumberDetails('ratio', 1.5);
  const value = await client.getNumberValue('ratio', 1.5);

  assert.deepEqual(details, {
    key: 'ratio',
    value: 1.5,
    reason: 'ERROR',
    errorCode: 'TYPE_MISMATCH',
    errorMessage: 'Switchboard returned a non-number value',
  });
  assert.equal(value, 1.5);
});

test('types bulk-cached values at read time', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(bulkResponse([
        { key: 'theme', value: 'dark', reason: 'SPLIT', variant: 'on' },
        { key: 'max-seats', value: 12, reason: 'SPLIT', variant: 'on' },
        {
          key: 'ui-config',
          value: { theme: 'dark' },
          reason: 'SPLIT',
          variant: 'on',
        },
        { key: 'enabled', value: true, reason: 'SPLIT', variant: 'on' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
  });
  t.after(() => client.close());

  const context = { targetingKey: 'user-1' };
  const theme = await client.getStringDetails('theme', 'light', context);
  const seats = await client.getNumberDetails('max-seats', 1, context);
  const config = await client.getObjectDetails(
    'ui-config',
    { theme: 'light' },
    context,
  );
  const enabled = await client.getBooleanDetails('enabled', false, context);

  assert.deepEqual(theme, {
    key: 'theme',
    value: 'dark',
    reason: 'SPLIT',
    variant: 'on',
  });
  assert.deepEqual(seats, {
    key: 'max-seats',
    value: 12,
    reason: 'SPLIT',
    variant: 'on',
  });
  assert.deepEqual(config, {
    key: 'ui-config',
    value: { theme: 'dark' },
    reason: 'SPLIT',
    variant: 'on',
  });
  assert.deepEqual(enabled, {
    key: 'enabled',
    value: true,
    reason: 'SPLIT',
    variant: 'on',
  });
  assert.equal(
    await client.getStringValue('theme', 'light', context),
    'dark',
  );
  assert.equal(await client.getNumberValue('max-seats', 1, context), 12);
  assert.deepEqual(
    await client.getObjectValue('ui-config', {}, context),
    { theme: 'dark' },
  );
  assert.equal(requestCount, 1);
});

test('bulk mode reports TYPE_MISMATCH and accepts array objects', async (t) => {
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(bulkResponse([
        { key: 'theme', value: 7, reason: 'SPLIT' },
        { key: 'ratio', value: '1.5', reason: 'SPLIT' },
        { key: 'config', value: 'nope', reason: 'SPLIT' },
        { key: 'enabled', value: 'yes', reason: 'SPLIT' },
        { key: 'list', value: [1, 2], reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
  });
  t.after(() => client.close());

  const context = { targetingKey: 'user-1' };
  const theme = await client.getStringDetails('theme', 'light', context);
  const ratio = await client.getNumberDetails('ratio', 1.5, context);
  const config = await client.getObjectDetails(
    'config',
    { fallback: true },
    context,
  );
  const enabled = await client.getBooleanDetails('enabled', false, context);
  const list = await client.getObjectDetails<number[]>('list', [], context);

  assert.equal(theme.value, 'light');
  assert.equal(theme.errorCode, 'TYPE_MISMATCH');
  assert.equal(theme.errorMessage, 'Switchboard returned a non-string value');
  assert.equal(ratio.value, 1.5);
  assert.equal(ratio.errorCode, 'TYPE_MISMATCH');
  assert.equal(ratio.errorMessage, 'Switchboard returned a non-number value');
  assert.deepEqual(config.value, { fallback: true });
  assert.equal(config.errorCode, 'TYPE_MISMATCH');
  assert.equal(config.errorMessage, 'Switchboard returned a non-object value');
  assert.equal(enabled.value, false);
  assert.equal(enabled.errorCode, 'TYPE_MISMATCH');
  assert.equal(
    enabled.errorMessage,
    'Switchboard returned a non-boolean value',
  );
  assert.deepEqual(list.value, [1, 2]);
  assert.equal(list.reason, 'SPLIT');
});

test('bulk object values are cloned so callers cannot poison the cache', async (t) => {
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(bulkResponse([
        {
          key: 'config',
          value: { nested: { count: 1 }, labels: ['a'] },
          reason: 'SPLIT',
        },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
  });
  t.after(() => client.close());

  const context = { targetingKey: 'user-1' };
  const first = await client.getObjectDetails('config', {}, context);
  first.value.nested.count = 99;
  first.value.labels.push('mutated');

  const second = await client.getObjectDetails('config', {}, context);

  assert.deepEqual(second.value, { nested: { count: 1 }, labels: ['a'] });
});

test('retries 5xx responses up to maxRetries', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;

      if (requestCount <= 2) {
        response.writeHead(503);
        response.end();
        return;
      }

      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"retry-v1"',
      });
      response.end(bulkResponse([
        { key: 'flag', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    maxRetries: 2,
    retryBaseDelayMs: 0,
    cacheTtlMs: 60000,
  });
  t.after(() => client.close());

  const details = await client.getBooleanDetails(
    'flag',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(details.value, true);
  assert.equal(requestCount, 3);
});

test('does not retry 4xx responses', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    maxRetries: 2,
    retryBaseDelayMs: 0,
  });
  t.after(() => client.close());

  const details = await client.getBooleanDetails(
    'flag',
    true,
    { targetingKey: 'user-1' },
  );

  assert.equal(details.value, true);
  assert.equal(details.errorCode, 'UNAUTHORIZED');
  assert.equal(requestCount, 1);
});

test('times out in single-flag mode without retries', async (t) => {
  let requestCount = 0;
  const server = await startServer((_request, response) => {
    requestCount += 1;
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ key: 'flag', value: true, reason: 'SPLIT' }));
    }, 200);
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    timeoutMs: 30,
    maxRetries: 0,
  });
  t.after(() => client.close());

  const details = await client.getBooleanDetails('flag', false);

  assert.equal(details.value, false);
  assert.equal(details.errorCode, 'TIMEOUT');
  assert.equal(requestCount, 1);
});

test('close aborts an in-flight request and settles quickly', async (t) => {
  let requestStarted = false;
  const server = await startServer((_request, _response) => {
    requestStarted = true;
    // Never respond; the client must abort the request on close().
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    timeoutMs: 5000,
  });
  t.after(() => client.close());

  const startedAt = Date.now();
  const pending = client.getBooleanDetails('flag', true);

  await waitFor(() => requestStarted);
  client.close();

  const details = await pending;
  const elapsedMs = Date.now() - startedAt;

  assert.equal(details.value, true);
  assert.equal(details.reason, 'ERROR');
  assert.equal(details.errorCode, 'NETWORK_ERROR');
  assert.ok(elapsedMs < 1000, `request settled after ${elapsedMs}ms`);
});

test('close interrupts the retry backoff sleep', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(503);
      response.end();
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    maxRetries: 2,
    retryBaseDelayMs: 2000,
  });
  t.after(() => client.close());

  const startedAt = Date.now();
  const pending = client.getBooleanDetails('flag', true);

  await waitFor(() => requestCount >= 1);
  await sleep(50);
  client.close();

  const details = await pending;
  const elapsedMs = Date.now() - startedAt;

  assert.equal(details.value, true);
  assert.equal(details.reason, 'ERROR');
  assert.ok(details.errorCode);
  assert.equal(requestCount, 1);
  assert.ok(elapsedMs < 1000, `request settled after ${elapsedMs}ms`);
});

test('an awaited call survives the retry backoff without other handles', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;

      if (requestCount === 1) {
        // Close the connection so the only handle the client has during the
        // backoff is the retry timer itself.
        response.writeHead(503, { connection: 'close' });
        response.end();
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        key: 'flag',
        value: true,
        reason: 'SPLIT',
      }));
    });
  });
  t.after(server.close);

  const result = await runChildNode(
    `
      const { SwitchboardClient } = await import(
        process.env.SWITCHBOARD_SDK_ENTRY
      );
      const client = new SwitchboardClient({
        baseUrl: process.env.SWITCHBOARD_BASE_URL,
        apiKey: 'key',
        timeoutMs: 5000,
        maxRetries: 1,
        retryBaseDelayMs: 150,
      });
      const details = await client.getBooleanDetails('flag', false);
      console.log('value=' + details.value + ' reason=' + details.reason);
      client.close();
    `,
    {
      SWITCHBOARD_SDK_ENTRY: new URL('../src/index.js', import.meta.url).href,
      SWITCHBOARD_BASE_URL: server.baseUrl,
    },
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'value=true reason=SPLIT');
  assert.equal(requestCount, 2);
});

test('retries single-flag 5xx responses exactly maxRetries + 1 times', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(503);
      response.end();
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    maxRetries: 2,
    retryBaseDelayMs: 0,
  });
  t.after(() => client.close());

  const details = await client.getBooleanDetails('flag', true);

  assert.equal(details.value, true);
  assert.equal(details.errorCode, 'EVALUATION_UNAVAILABLE');
  assert.equal(requestCount, 3);
});

test('close stops background polling', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"poll-v1"',
      });
      response.end(bulkResponse([
        { key: 'flag', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    pollingIntervalMs: 20,
    cacheTtlMs: 60000,
  });
  t.after(() => client.close());

  const details = await client.getBooleanDetails(
    'flag',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(details.value, true);

  await waitFor(() => requestCount >= 2);

  client.close();
  await sleep(50);

  const afterClose = requestCount;
  await sleep(100);

  assert.equal(requestCount, afterClose);
});

test('non-finite polling intervals do not schedule a poll loop', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"no-poll-v1"',
      });
      response.end(bulkResponse([
        { key: 'flag', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const clients = [Number.NaN, Number.POSITIVE_INFINITY].map(
    (pollingIntervalMs) => new SwitchboardClient({
      baseUrl: server.baseUrl,
      apiKey: 'key',
      bulkEvaluation: true,
      cacheTtlMs: 60000,
      pollingIntervalMs,
    }),
  );
  t.after(() => {
    for (const client of clients) {
      client.close();
    }
  });

  for (const client of clients) {
    const details = await client.getBooleanDetails(
      'flag',
      false,
      { targetingKey: 'user-1' },
    );

    assert.equal(details.value, true);
  }

  await sleep(100);

  assert.equal(requestCount, 2);
});

test('non-finite maxRetries still performs one request', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        key: 'flag',
        value: true,
        reason: 'SPLIT',
      }));
    });
  });
  t.after(server.close);

  const clients = [Number.NaN, Number.POSITIVE_INFINITY].map(
    (maxRetries) => new SwitchboardClient({
      baseUrl: server.baseUrl,
      apiKey: 'key',
      maxRetries,
      retryBaseDelayMs: 0,
    }),
  );
  t.after(() => {
    for (const client of clients) {
      client.close();
    }
  });

  for (const client of clients) {
    const details = await client.getBooleanDetails('flag', false);

    assert.equal(details.value, true);
  }

  assert.equal(requestCount, 2);
});

test('non-finite cacheTtlMs and timeoutMs use their defaults', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"finite-options-v1"',
      });
      response.end(bulkResponse([
        { key: 'flag', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: Number.NaN,
    timeoutMs: Number.POSITIVE_INFINITY,
  });
  t.after(() => client.close());

  const first = await client.getBooleanDetails(
    'flag',
    false,
    { targetingKey: 'user-1' },
  );
  const second = await client.getBooleanDetails(
    'flag',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(first.value, true);
  assert.equal(second.value, true);
  assert.equal(requestCount, 1);
});

test('refreshes the cached flag set after cacheTtlMs expires', async (t) => {
  let requestCount = 0;
  const ifNoneMatchHeaders: Array<string | undefined> = [];
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;

      const ifNoneMatch = request.headers['if-none-match'];

      ifNoneMatchHeaders.push(
        typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined,
      );

      response.writeHead(200, {
        'content-type': 'application/json',
        etag: `"ttl-${requestCount}"`,
      });
      response.end(bulkResponse([
        { key: 'alpha', value: requestCount === 1, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 50,
  });
  t.after(() => client.close());

  const first = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );
  const cached = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(first.value, true);
  assert.equal(cached.value, true);
  assert.equal(requestCount, 1);

  await sleep(100);

  const refreshed = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(refreshed.value, false);
  assert.equal(requestCount, 2);
  assert.equal(ifNoneMatchHeaders[1], '"ttl-1"');
});

test('cacheTtlMs 0 fetches on every evaluation', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"no-cache-v1"',
      });
      response.end(bulkResponse([
        { key: 'alpha', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 0,
  });
  t.after(() => client.close());

  const first = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );
  const second = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(first.value, true);
  assert.equal(second.value, true);
  assert.equal(requestCount, 2);
});

test('a 200 response without ETag clears the cached validator', async (t) => {
  let requestCount = 0;
  const ifNoneMatchHeaders: Array<string | undefined> = [];
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;

      const ifNoneMatch = request.headers['if-none-match'];

      ifNoneMatchHeaders.push(
        typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined,
      );

      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };

      if (requestCount !== 2) {
        headers.etag = `"etag-${requestCount}"`;
      }

      response.writeHead(200, headers);
      response.end(bulkResponse([
        { key: 'alpha', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 30,
  });
  t.after(() => client.close());

  await client.getBooleanDetails('alpha', false, { targetingKey: 'user-1' });

  await sleep(60);
  await client.getBooleanDetails('alpha', false, { targetingKey: 'user-1' });

  await sleep(60);
  const details = await client.getBooleanDetails(
    'alpha',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(details.value, true);
  assert.deepEqual(ifNoneMatchHeaders, [undefined, '"etag-1"', undefined]);
});

test('non-finite maxCachedContexts keeps the cache bounded', async () => {
  let requestCount = 0;
  const client = new SwitchboardClient({
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
    maxCachedContexts: Number.NaN,
    fetch: async () => {
      requestCount += 1;

      return new Response(
        bulkResponse([{ key: 'flag', value: true, reason: 'SPLIT' }]),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: '"bounded-v1"',
          },
        },
      );
    },
  });

  try {
    for (let index = 0; index < 1001; index += 1) {
      const details = await client.getBooleanDetails(
        'flag',
        false,
        { targetingKey: `user-${index}` },
      );

      assert.equal(details.value, true);
    }

    const cacheSize = (client as unknown as {
      bulkCache: Map<string, unknown>;
    }).bulkCache.size;

    assert.equal(requestCount, 1001);
    assert.equal(cacheSize, 1000);
  } finally {
    client.close();
  }
});

test('evicts the least recently used context at maxCachedContexts', async (t) => {
  const contexts: string[] = [];
  const server = await startServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const payload = JSON.parse(body) as {
        context: { targetingKey: string };
      };
      const targetingKey = payload.context.targetingKey;

      contexts.push(targetingKey);
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: `"lru-${targetingKey}"`,
      });
      response.end(bulkResponse([
        {
          key: 'flag',
          value: targetingKey === 'a',
          reason: 'SPLIT',
        },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
    maxCachedContexts: 1,
  });
  t.after(() => client.close());

  const firstA = await client.getBooleanDetails(
    'flag',
    false,
    { targetingKey: 'a' },
  );
  const firstB = await client.getBooleanDetails(
    'flag',
    false,
    { targetingKey: 'b' },
  );
  const secondA = await client.getBooleanDetails(
    'flag',
    false,
    { targetingKey: 'a' },
  );

  assert.equal(firstA.value, true);
  assert.equal(firstB.value, false);
  assert.equal(secondA.value, true);
  assert.deepEqual(contexts, ['a', 'b', 'a']);

  const cacheSize = (client as unknown as {
    bulkCache: Map<string, unknown>;
  }).bulkCache.size;

  assert.equal(cacheSize, 1);
});

test('eviction clears the polling timer of the displaced context', async (t) => {
  const polledContexts: string[] = [];
  const server = await startServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const payload = JSON.parse(body) as {
        context: { targetingKey: string };
      };

      polledContexts.push(payload.context.targetingKey);
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: `"poll-${payload.context.targetingKey}"`,
      });
      response.end(bulkResponse([
        { key: 'flag', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
    maxCachedContexts: 1,
    pollingIntervalMs: 150,
  });
  t.after(() => client.close());

  await client.getBooleanDetails('flag', false, { targetingKey: 'a' });
  await client.getBooleanDetails('flag', false, { targetingKey: 'b' });

  const aCountAfterEviction = polledContexts.filter(
    (context) => context === 'a',
  ).length;

  assert.equal(aCountAfterEviction, 1);

  await waitFor(
    () => polledContexts.filter((context) => context === 'b').length >= 2,
    3000,
  );

  const bCount = polledContexts.filter(
    (context) => context === 'b',
  ).length;

  await sleep(400);

  assert.equal(
    polledContexts.filter((context) => context === 'a').length,
    aCountAfterEviction,
  );
  assert.ok(bCount >= 2);
  assert.ok(
    polledContexts.filter((context) => context === 'b').length > bCount,
  );

  const cacheSize = (client as unknown as {
    bulkCache: Map<string, unknown>;
  }).bulkCache.size;

  assert.equal(cacheSize, 1);
});

test('background polling failures leave the cached flags untouched', async (t) => {
  let requestCount = 0;
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;

      if (requestCount === 1) {
        response.writeHead(200, {
          'content-type': 'application/json',
          etag: '"poll-failure-v1"',
        });
        response.end(bulkResponse([
          { key: 'flag', value: true, reason: 'SPLIT' },
        ]));
        return;
      }

      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'GENERAL' } }));
    });
  });
  t.after(server.close);

  const client = new SwitchboardClient({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: true,
    cacheTtlMs: 60000,
    pollingIntervalMs: 20,
    maxRetries: 0,
  });
  t.after(() => client.close());

  const first = await client.getBooleanDetails(
    'flag',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(first.value, true);

  await waitFor(() => requestCount >= 2);
  await sleep(30);

  const cached = await client.getBooleanDetails(
    'flag',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(cached.value, true);
  assert.equal(cached.reason, 'SPLIT');
  assert.equal(cached.errorCode, undefined);
});

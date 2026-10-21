import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

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
  let requestCount = 0;
  const server = await startServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requestCount += 1;
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
    pollingIntervalMs: 30,
  });
  t.after(() => client.close());

  await client.getBooleanDetails('flag', false, { targetingKey: 'a' });
  await client.getBooleanDetails('flag', false, { targetingKey: 'b' });

  await waitFor(() => requestCount >= 4);

  assert.equal(
    polledContexts.filter((context) => context === 'a').length,
    1,
  );
  assert.ok(
    polledContexts.filter((context) => context === 'b').length >= 3,
  );
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

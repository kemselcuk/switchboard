import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

import {
  ErrorCode,
  OpenFeature,
} from '@openfeature/server-sdk';

import { SwitchboardProvider } from '../src/index.js';

async function startServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Could not get server address');
  }

  return {
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

test('resolves two flags for one context with a single bulk request', async (t) => {
  const requests: Array<{ method?: string; url?: string; body: unknown }> = [];
  const server = await startServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        body: JSON.parse(body),
      });
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"bulk-v1"',
      });
      response.end(bulkResponse([
        {
          key: 'new-checkout',
          value: true,
          reason: 'SPLIT',
          variant: 'enabled',
        },
        { key: 'search', value: false, reason: 'DEFAULT' },
      ]));
    });
  });
  const provider = new SwitchboardProvider({
    baseUrl: server.baseUrl,
    apiKey: 'key',
  });
  t.after(async () => {
    await OpenFeature.clearProviders();
    provider.onClose();
    await server.close();
  });

  await OpenFeature.setProviderAndWait(provider);
  const client = OpenFeature.getClient();
  const context = { targetingKey: 'user-1' };

  const checkout = await client.getBooleanDetails(
    'new-checkout',
    false,
    context,
  );
  const search = await client.getBooleanDetails('search', true, context);

  assert.equal(checkout.value, true);
  assert.equal(checkout.reason, 'SPLIT');
  assert.equal(checkout.variant, 'enabled');
  assert.equal(search.value, false);
  assert.equal(search.reason, 'DEFAULT');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/ofrep/v1/evaluate/flags');
  assert.deepEqual(requests[0].body, { context });
});

test('treats an explicit bulkEvaluation: undefined as the bulk default', async (t) => {
  const requests: Array<{ method?: string; url?: string; body: unknown }> = [];
  const server = await startServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        body: JSON.parse(body),
      });
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"bulk-default"',
      });
      response.end(bulkResponse([
        { key: 'alpha', value: true, reason: 'SPLIT' },
        { key: 'beta', value: false, reason: 'DEFAULT' },
      ]));
    });
  });
  const provider = new SwitchboardProvider({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: undefined,
  });
  t.after(async () => {
    await OpenFeature.clearProviders();
    provider.onClose();
    await server.close();
  });

  await OpenFeature.setProviderAndWait(provider);
  const client = OpenFeature.getClient();
  const context = { targetingKey: 'user-1' };

  const alpha = await client.getBooleanDetails('alpha', false, context);
  const beta = await client.getBooleanDetails('beta', true, context);

  assert.equal(alpha.value, true);
  assert.equal(beta.value, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/ofrep/v1/evaluate/flags');
  assert.deepEqual(requests[0].body, { context });
});

test('maps an unknown flag in a bulk response to FLAG_NOT_FOUND', async (t) => {
  const server = await startServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, {
        'content-type': 'application/json',
        etag: '"bulk-v1"',
      });
      response.end(bulkResponse([
        { key: 'new-checkout', value: true, reason: 'SPLIT' },
      ]));
    });
  });
  t.after(server.close);

  const provider = new SwitchboardProvider({
    baseUrl: server.baseUrl,
    apiKey: 'key',
  });
  t.after(() => provider.onClose());

  const details = await provider.resolveBooleanEvaluation(
    'missing',
    true,
    { targetingKey: 'user-1' },
  );

  assert.equal(details.value, true);
  assert.equal(details.reason, 'ERROR');
  assert.equal(details.errorCode, ErrorCode.FLAG_NOT_FOUND);
});

test('honours an explicit bulkEvaluation: false override', async (t) => {
  const urls: string[] = [];
  const server = await startServer((request, response) => {
    urls.push(request.url ?? '');
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

  const provider = new SwitchboardProvider({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    bulkEvaluation: false,
  });
  t.after(() => provider.onClose());

  const details = await provider.resolveBooleanEvaluation(
    'flag',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(details.value, true);
  assert.deepEqual(urls, ['/ofrep/v1/evaluate/flags/flag']);
});

test('returns TYPE_MISMATCH for non-boolean flag types', async () => {
  const provider = new SwitchboardProvider({
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'key',
  });

  try {
    const stringDetails = await provider.resolveStringEvaluation(
      'flag',
      'default',
    );
    const numberDetails = await provider.resolveNumberEvaluation('flag', 1);
    const objectDetails = await provider.resolveObjectEvaluation(
      'flag',
      { enabled: true },
    );

    assert.equal(stringDetails.value, 'default');
    assert.equal(stringDetails.errorCode, ErrorCode.TYPE_MISMATCH);
    assert.equal(numberDetails.value, 1);
    assert.equal(numberDetails.errorCode, ErrorCode.TYPE_MISMATCH);
    assert.deepEqual(objectDetails.value, { enabled: true });
    assert.equal(objectDetails.errorCode, ErrorCode.TYPE_MISMATCH);
  } finally {
    provider.onClose();
  }
});

test('onClose completes and stops background polling timers', async (t) => {
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

  const provider = new SwitchboardProvider({
    baseUrl: server.baseUrl,
    apiKey: 'key',
    pollingIntervalMs: 20,
    cacheTtlMs: 60000,
  });
  t.after(() => provider.onClose());

  const details = await provider.resolveBooleanEvaluation(
    'flag',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(details.value, true);

  await waitFor(() => requestCount >= 2);
  await provider.onClose();

  const afterClose = requestCount;
  await sleep(60);

  assert.equal(requestCount, afterClose);
});

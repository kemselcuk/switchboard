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
  const details = await client.getBooleanDetails('flag', false);

  assert.equal(details.value, false);
  assert.equal(details.errorCode, 'NETWORK_ERROR');
});

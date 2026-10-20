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

test('resolves a boolean flag through OpenFeature', async (t) => {
  const server = await startServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      key: 'new-checkout',
      value: true,
      reason: 'SPLIT',
      variant: 'enabled',
    }));
  });
  t.after(server.close);

  await OpenFeature.setProviderAndWait(new SwitchboardProvider({
    baseUrl: server.baseUrl,
    apiKey: 'key',
  }));
  t.after(() => OpenFeature.clearProviders());

  const details = await OpenFeature
    .getClient()
    .getBooleanDetails('new-checkout', false, { targetingKey: 'user-1' });

  assert.equal(details.value, true);
  assert.equal(details.reason, 'SPLIT');
  assert.equal(details.variant, 'enabled');
});

test('maps an unknown flag to FLAG_NOT_FOUND', async (t) => {
  const server = await startServer((_request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ key: 'missing', errorCode: 'FLAG_NOT_FOUND' }));
  });
  t.after(server.close);

  await OpenFeature.setProviderAndWait(new SwitchboardProvider({
    baseUrl: server.baseUrl,
    apiKey: 'key',
  }));
  t.after(() => OpenFeature.clearProviders());

  const details = await OpenFeature
    .getClient()
    .getBooleanDetails('missing', true, { targetingKey: 'user-1' });

  assert.equal(details.value, true);
  assert.equal(details.errorCode, ErrorCode.FLAG_NOT_FOUND);
});

test('returns TYPE_MISMATCH for non-boolean flag types', async () => {
  const provider = new SwitchboardProvider({
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'key',
  });
  const details = await provider.resolveStringEvaluation('flag', 'default');

  assert.equal(details.value, 'default');
  assert.equal(details.errorCode, ErrorCode.TYPE_MISMATCH);
});

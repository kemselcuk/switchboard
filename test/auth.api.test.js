import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/app.js';

const ADMIN_TOKEN = 'test-admin-token';
const AUTHORIZATION = { authorization: `Bearer ${ADMIN_TOKEN}` };

function createApp(overrides = {}) {
  return buildApp({ adminToken: ADMIN_TOKEN, ...overrides });
}

test('admin routes reject a request without a token', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/flags' });

  assert.equal(response.statusCode, 401);
  assert.equal(response.headers['www-authenticate'], 'Bearer');
  assert.deepEqual(response.json(), {
    error: {
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid bearer token',
    },
  });
});

test('admin routes reject a wrong token', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: { authorization: 'Bearer wrong-token' },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.headers['www-authenticate'], 'Bearer');
  assert.equal(response.json().error.code, 'UNAUTHORIZED');
  assert.equal(response.body.includes('wrong-token'), false);
  assert.equal(response.body.includes(ADMIN_TOKEN), false);
});

test('admin routes reject a token of a different length', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}-and-more` },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHORIZED');
});

test('admin routes reject a malformed authorization header', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: { authorization: `Basic ${ADMIN_TOKEN}` },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHORIZED');
});

test('auth runs before body validation', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/api/flags' });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHORIZED');
});

test('admin routes accept the configured bearer token', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: AUTHORIZATION,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { flags: [] });
});

test('admin routes reject every token when no token is configured', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: AUTHORIZATION,
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHORIZED');
});

test('health check stays public', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/healthz' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

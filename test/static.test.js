import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/app.js';

const ADMIN_TOKEN = 'test-admin-token';

function createApp(t) {
  const app = buildApp({ adminToken: ADMIN_TOKEN });
  t.after(() => app.close());
  return app;
}

function assertNotFoundEnvelope(response) {
  assert.equal(response.statusCode, 404);

  const body = response.json();

  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(typeof body.error.message, 'string');
  assert.equal(response.headers['content-type'].includes('application/json'), true);
}

test('GET / serves the single-page demo', async (t) => {
  const app = createApp(t);
  const response = await app.inject({ method: 'GET', url: '/' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.equal(response.body.includes('Switchboard'), true);
  assert.equal(response.body.includes('id="token-form"'), true);
  assert.equal(response.body.includes('id="compare-run"'), true);
  assert.equal(response.body.includes(ADMIN_TOKEN), false);
  assert.equal(response.body.includes('dev-token-change-me'), false);
});

test('GET /app.js serves the demo script without innerHTML user data', async (t) => {
  const app = createApp(t);
  const response = await app.inject({ method: 'GET', url: '/app.js' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /javascript/);
  assert.equal(response.body.includes('sessionStorage'), true);
  assert.equal(response.body.includes('textContent'), true);
  assert.equal(response.body.includes('innerHTML'), false);
});

test('GET /styles.css serves the demo stylesheet', async (t) => {
  const app = createApp(t);
  const response = await app.inject({ method: 'GET', url: '/styles.css' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^text\/css/);
  assert.equal(response.body.includes('.panel'), true);
});

test('unknown API routes keep the JSON NOT_FOUND envelope', async (t) => {
  const app = createApp(t);
  const response = await app.inject({ method: 'GET', url: '/api/unknown' });

  assertNotFoundEnvelope(response);
});

test('unknown static paths fall back to the JSON NOT_FOUND envelope', async (t) => {
  const app = createApp(t);
  const response = await app.inject({
    method: 'GET',
    url: '/does-not-exist.txt',
  });

  assertNotFoundEnvelope(response);
});

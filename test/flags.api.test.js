import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/app.js';

const ADMIN_TOKEN = 'test-admin-token';
const AUTHORIZATION = { authorization: `Bearer ${ADMIN_TOKEN}` };
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FLAG_FIELDS = [
  'createdAt',
  'description',
  'enabled',
  'id',
  'key',
  'rolloutPercentage',
  'updatedAt',
];

function createApp(repository) {
  return buildApp({ adminToken: ADMIN_TOKEN, repository });
}

function createFlag(app, payload) {
  return app.inject({
    method: 'POST',
    url: '/api/flags',
    headers: AUTHORIZATION,
    payload,
  });
}

function assertError(response, statusCode, code) {
  assert.equal(response.statusCode, statusCode);

  const body = response.json();

  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.equal(body.error.stack, undefined);
  assert.equal(body.stack, undefined);
  assert.equal(response.body.includes(ADMIN_TOKEN), false);

  return body;
}

test('POST /api/flags creates a flag and returns the planned fields', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await createFlag(app, {
    key: 'new-checkout',
    description: 'Yeni ödeme akışı',
    enabled: true,
    rolloutPercentage: 20,
  });

  assert.equal(response.statusCode, 201);

  const flag = response.json();

  assert.deepEqual(Object.keys(flag).sort(), FLAG_FIELDS);
  assert.equal(flag.id, 1);
  assert.equal(flag.key, 'new-checkout');
  assert.equal(flag.description, 'Yeni ödeme akışı');
  assert.equal(flag.enabled, true);
  assert.equal(flag.rolloutPercentage, 20);
  assert.match(flag.createdAt, ISO_TIMESTAMP);
  assert.match(flag.updatedAt, ISO_TIMESTAMP);
});

test('POST /api/flags applies defaults for optional fields', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await createFlag(app, { key: 'defaults' });

  assert.equal(response.statusCode, 201);

  const flag = response.json();

  assert.equal(flag.description, '');
  assert.equal(flag.enabled, false);
  assert.equal(flag.rolloutPercentage, 0);
});

test('POST /api/flags rejects a duplicate key', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  assert.equal((await createFlag(app, { key: 'duplicate' })).statusCode, 201);

  const response = await createFlag(app, { key: 'duplicate' });

  assertError(response, 409, 'FLAG_EXISTS');
  assert.equal((await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: AUTHORIZATION,
  })).json().flags.length, 1);
});

test('POST /api/flags rejects invalid keys', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const invalidKeys = [
    'New-Checkout',
    '-leading',
    'with space',
    'a'.repeat(65),
    'çok',
  ];

  for (const key of invalidKeys) {
    const response = await createFlag(app, { key });
    assertError(response, 400, 'VALIDATION_ERROR');
  }

  const missingKey = await createFlag(app, { description: 'no key' });
  assertError(missingKey, 400, 'VALIDATION_ERROR');
});

test('POST /api/flags rejects invalid rollout percentages', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  for (const rolloutPercentage of [101, -1, 1.5, '20', null]) {
    const response = await createFlag(app, {
      key: `invalid-rollout-${String(rolloutPercentage).replace('.', '-')}`,
      rolloutPercentage,
    });
    assertError(response, 400, 'VALIDATION_ERROR');
  }
});

test('POST /api/flags rejects invalid enabled and description values', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  assertError(
    await createFlag(app, { key: 'bad-enabled', enabled: 'true' }),
    400,
    'VALIDATION_ERROR',
  );
  assertError(
    await createFlag(app, {
      key: 'long-description',
      description: 'x'.repeat(281),
    }),
    400,
    'VALIDATION_ERROR',
  );
});

test('POST /api/flags rejects unknown body fields', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await createFlag(app, {
    key: 'unknown-field',
    surprise: true,
  });

  assertError(response, 400, 'VALIDATION_ERROR');
});

test('GET /api/flags lists flags in creation order', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  await createFlag(app, { key: 'beta' });
  await createFlag(app, { key: 'alpha', enabled: true });

  const response = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: AUTHORIZATION,
  });

  assert.equal(response.statusCode, 200);

  const body = response.json();

  assert.deepEqual(Object.keys(body), ['flags']);
  assert.deepEqual(body.flags.map((flag) => flag.key), ['beta', 'alpha']);
});

test('GET /api/flags/:key returns a flag or FLAG_NOT_FOUND', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  await createFlag(app, {
    key: 'checkout',
    description: 'checkout flow',
    enabled: true,
    rolloutPercentage: 30,
  });

  const found = await app.inject({
    method: 'GET',
    url: '/api/flags/checkout',
    headers: AUTHORIZATION,
  });

  assert.equal(found.statusCode, 200);
  assert.equal(found.json().key, 'checkout');
  assert.equal(found.json().enabled, true);
  assert.equal(found.json().rolloutPercentage, 30);

  const missing = await app.inject({
    method: 'GET',
    url: '/api/flags/missing',
    headers: AUTHORIZATION,
  });

  assertError(missing, 404, 'FLAG_NOT_FOUND');
});

test('PATCH /api/flags/:key updates only the provided fields', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const created = (await createFlag(app, {
    key: 'checkout',
    description: 'first',
    enabled: true,
    rolloutPercentage: 20,
  })).json();

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/flags/checkout',
    headers: AUTHORIZATION,
    payload: { description: 'second', enabled: false },
  });

  assert.equal(response.statusCode, 200);

  const updated = response.json();

  assert.deepEqual(Object.keys(updated).sort(), FLAG_FIELDS);
  assert.equal(updated.id, created.id);
  assert.equal(updated.key, 'checkout');
  assert.equal(updated.description, 'second');
  assert.equal(updated.enabled, false);
  assert.equal(updated.rolloutPercentage, 20);
  assert.ok(updated.updatedAt >= created.updatedAt);

  const rolloutOnly = await app.inject({
    method: 'PATCH',
    url: '/api/flags/checkout',
    headers: AUTHORIZATION,
    payload: { rolloutPercentage: 40 },
  });

  assert.equal(rolloutOnly.statusCode, 200);
  assert.equal(rolloutOnly.json().description, 'second');
  assert.equal(rolloutOnly.json().enabled, false);
  assert.equal(rolloutOnly.json().rolloutPercentage, 40);
});

test('PATCH /api/flags/:key rejects empty and unknown fields', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  await createFlag(app, { key: 'checkout' });

  const empty = await app.inject({
    method: 'PATCH',
    url: '/api/flags/checkout',
    headers: AUTHORIZATION,
    payload: {},
  });
  assertError(empty, 400, 'VALIDATION_ERROR');

  const unknown = await app.inject({
    method: 'PATCH',
    url: '/api/flags/checkout',
    headers: AUTHORIZATION,
    payload: { key: 'renamed' },
  });
  assertError(unknown, 400, 'VALIDATION_ERROR');

  const invalidRollout = await app.inject({
    method: 'PATCH',
    url: '/api/flags/checkout',
    headers: AUTHORIZATION,
    payload: { rolloutPercentage: 101 },
  });
  assertError(invalidRollout, 400, 'VALIDATION_ERROR');
});

test('PATCH /api/flags/:key rejects an unknown key', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/flags/missing',
    headers: AUTHORIZATION,
    payload: { enabled: true },
  });

  assertError(response, 404, 'FLAG_NOT_FOUND');
});

test('unknown routes return the NOT_FOUND envelope', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/unknown' });

  assertError(response, 404, 'NOT_FOUND');
});

test('repository SQLite errors become 503 without internal details', async (t) => {
  const repository = {
    createFlag() {
      throw new Error('not used');
    },
    listFlags() {
      const error = new Error(
        'SQLITE_IOERR: disk I/O error at /private/data/switchboard.db',
      );
      error.code = 'SQLITE_IOERR';
      throw error;
    },
    getFlag() {
      throw new Error('not used');
    },
    updateFlag() {
      throw new Error('not used');
    },
  };

  const app = createApp(repository);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: AUTHORIZATION,
  });

  const body = assertError(response, 503, 'EVALUATION_UNAVAILABLE');

  assert.equal(body.error.message, 'Flag storage is unavailable');
  assert.equal(response.body.includes('SQLITE_IOERR'), false);
  assert.equal(response.body.includes('switchboard.db'), false);
});

test('unexpected errors become 500 without internal details', async (t) => {
  const repository = {
    createFlag() {
      throw new Error('not used');
    },
    listFlags() {
      throw new Error('kaboom: sensitive internals');
    },
    getFlag() {
      throw new Error('not used');
    },
    updateFlag() {
      throw new Error('not used');
    },
  };

  const app = createApp(repository);
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: AUTHORIZATION,
  });

  const body = assertError(response, 500, 'INTERNAL_ERROR');

  assert.equal(body.error.message, 'Internal server error');
  assert.equal(response.body.includes('kaboom'), false);
  assert.equal(response.body.includes('sensitive internals'), false);
});

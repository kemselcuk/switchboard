import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/app.js';

const ADMIN_TOKEN = 'test-admin-token';
const AUTHORIZATION = { authorization: `Bearer ${ADMIN_TOKEN}` };

function createApp(t, options = {}) {
  const app = buildApp({ adminToken: ADMIN_TOKEN, ...options });
  t.after(() => app.close());
  return app;
}

async function createFlag(app, payload) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/flags',
    headers: AUTHORIZATION,
    payload,
  });

  assert.equal(response.statusCode, 201);
  return response.json();
}

function evaluate(app, payload) {
  return app.inject({
    method: 'POST',
    url: '/api/evaluate',
    payload,
  });
}

function assertValidationError(response) {
  assert.equal(response.statusCode, 400);

  const body = response.json();

  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message']);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(typeof body.error.message, 'string');
  assert.equal(body.error.stack, undefined);
  assert.equal(response.body.includes('SQLITE_'), false);
}

test('known flag returns the exact evaluation contract', async (t) => {
  const app = createApp(t);
  await createFlag(app, {
    key: 'new-checkout',
    enabled: true,
    rolloutPercentage: 40,
  });

  const response = await evaluate(app, {
    flagKey: 'new-checkout',
    userId: 'user-0000',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    flagKey: 'new-checkout',
    userId: 'user-0000',
    enabled: true,
    reason: 'BUCKET_INCLUDED',
    bucket: 3,
    rolloutPercentage: 40,
  });
});

test('users are included or excluded according to their bucket', async (t) => {
  const app = createApp(t);
  await createFlag(app, {
    key: 'new-checkout',
    enabled: true,
    rolloutPercentage: 20,
  });

  const included = await evaluate(app, {
    flagKey: 'new-checkout',
    userId: 'user-0000',
  });
  assert.equal(included.statusCode, 200);
  assert.deepEqual(included.json(), {
    flagKey: 'new-checkout',
    userId: 'user-0000',
    enabled: true,
    reason: 'BUCKET_INCLUDED',
    bucket: 3,
    rolloutPercentage: 20,
  });

  const excluded = await evaluate(app, {
    flagKey: 'new-checkout',
    userId: 'user-0005',
  });
  assert.equal(excluded.statusCode, 200);
  assert.deepEqual(excluded.json(), {
    flagKey: 'new-checkout',
    userId: 'user-0005',
    enabled: false,
    reason: 'BUCKET_EXCLUDED',
    bucket: 30,
    rolloutPercentage: 20,
  });
});

test('disabled flag returns FLAG_DISABLED with the computed bucket', async (t) => {
  const app = createApp(t);
  await createFlag(app, {
    key: 'disabled-flag',
    enabled: false,
    rolloutPercentage: 100,
  });

  const response = await evaluate(app, {
    flagKey: 'disabled-flag',
    userId: 'user-123',
  });

  assert.equal(response.statusCode, 200);

  const body = response.json();

  assert.deepEqual(Object.keys(body).sort(), [
    'bucket',
    'enabled',
    'flagKey',
    'reason',
    'rolloutPercentage',
    'userId',
  ]);
  assert.equal(body.flagKey, 'disabled-flag');
  assert.equal(body.userId, 'user-123');
  assert.equal(body.enabled, false);
  assert.equal(body.reason, 'FLAG_DISABLED');
  assert.equal(body.rolloutPercentage, 100);
  assert.equal(Number.isInteger(body.bucket), true);
  assert.ok(body.bucket >= 0 && body.bucket <= 99);
});

test('unknown flag returns 200 with FLAG_NOT_FOUND and null fields', async (t) => {
  const app = createApp(t);

  const response = await evaluate(app, {
    flagKey: 'missing-flag',
    userId: 'user-123',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    flagKey: 'missing-flag',
    userId: 'user-123',
    enabled: false,
    reason: 'FLAG_NOT_FOUND',
    bucket: null,
    rolloutPercentage: null,
  });
});

test('invalid bodies return VALIDATION_ERROR', async (t) => {
  const app = createApp(t);
  await createFlag(app, {
    key: 'new-checkout',
    enabled: true,
    rolloutPercentage: 20,
  });

  const invalidBodies = [
    {},
    { flagKey: 'new-checkout' },
    { userId: 'user-123' },
    { flagKey: 'new-checkout', userId: 123 },
    { flagKey: 'New-Checkout', userId: 'user-123' },
    { flagKey: 'new-checkout', userId: '' },
    { flagKey: 'new-checkout', userId: '   ' },
    { flagKey: 'new-checkout', userId: 'x'.repeat(129) },
    { flagKey: 'new-checkout', userId: 'user-123', extra: true },
  ];

  for (const body of invalidBodies) {
    assertValidationError(await evaluate(app, body));
  }
});

test('evaluation is public while admin routes stay protected', async (t) => {
  const app = createApp(t);
  await createFlag(app, {
    key: 'public-flag',
    enabled: true,
    rolloutPercentage: 100,
  });

  const evaluation = await evaluate(app, {
    flagKey: 'public-flag',
    userId: 'user-123',
  });
  assert.equal(evaluation.statusCode, 200);

  const admin = await app.inject({ method: 'GET', url: '/api/flags' });
  assert.equal(admin.statusCode, 401);
  assert.equal(admin.json().error.code, 'UNAUTHORIZED');
});

test('repository SQLITE errors become 503 without internal details', async (t) => {
  const repository = {
    createFlag() {
      throw new Error('not used');
    },
    listFlags() {
      throw new Error('not used');
    },
    getFlag() {
      const error = new Error(
        'SQLITE_IOERR: disk I/O error at /private/data/switchboard.db',
      );
      error.code = 'SQLITE_IOERR';
      throw error;
    },
    updateFlag() {
      throw new Error('not used');
    },
  };
  const app = createApp(t, { repository });

  const response = await evaluate(app, {
    flagKey: 'new-checkout',
    userId: 'user-123',
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: {
      code: 'EVALUATION_UNAVAILABLE',
      message: 'Flag storage is unavailable',
    },
  });
  assert.equal(response.body.includes('SQLITE_IOERR'), false);
  assert.equal(response.body.includes('switchboard.db'), false);
  assert.equal(response.body.includes('stack'), false);
});

test('a closed database returns 503 instead of 500', async (t) => {
  const app = createApp(t);

  app.db.close();

  const response = await evaluate(app, {
    flagKey: 'new-checkout',
    userId: 'user-123',
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'EVALUATION_UNAVAILABLE');
  assert.equal(
    response.body.includes('database connection is not open'),
    false,
  );
});

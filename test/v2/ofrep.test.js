import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHORIZATION,
  createApiKey,
  createEnvironment,
  createFlag,
  createProject,
  createV2App,
} from './helpers.js';

async function setup(t) {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production', {
    enabled: true,
    rolloutPercentage: 100,
  });
  const key = await createApiKey(app, 'demo', 'production');

  return { app, key: key.key };
}

function evaluate(app, key, userId, flagKey = 'new-checkout') {
  return app.inject({
    method: 'POST',
    url: `/ofrep/v1/evaluate/flags/${flagKey}`,
    headers: { 'x-api-key': key },
    payload: { context: { targetingKey: userId } },
  });
}

test('evaluates a boolean flag over OFREP with an X-API-Key', async (t) => {
  const { app, key } = await setup(t);
  const response = await evaluate(app, key, 'user-1');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    key: 'new-checkout',
    value: true,
    reason: 'SPLIT',
    variant: 'enabled',
  });
});

test('accepts a Bearer environment key', async (t) => {
  const { app, key } = await setup(t);
  const response = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/new-checkout',
    headers: { authorization: `Bearer ${key}` },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().value, true);
});

test('returns FLAG_NOT_FOUND for an unknown OFREP flag', async (t) => {
  const { app, key } = await setup(t);
  const response = await evaluate(app, key, 'user-1', 'missing-flag');

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    key: 'missing-flag',
    errorCode: 'FLAG_NOT_FOUND',
    errorDetails: "Flag 'missing-flag' was not found",
  });
});

test('returns DISABLED when the flag is off', async (t) => {
  const { app, key } = await setup(t);

  await app.inject({
    method: 'PATCH',
    url: '/api/v1/projects/demo/environments/production/flags/new-checkout',
    headers: AUTHORIZATION,
    payload: { enabled: false, rolloutPercentage: 100 },
  });

  const response = await evaluate(app, key, 'user-1');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().value, false);
  assert.equal(response.json().reason, 'DISABLED');
  assert.equal(response.json().variant, 'disabled');
});

test('bulk evaluation returns flags and a stable ETag', async (t) => {
  const { app, key } = await setup(t);
  const first = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: { 'x-api-key': key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(first.statusCode, 200);
  assert.equal(Array.isArray(first.json().flags), true);
  assert.equal(first.json().flags.length, 1);
  assert.equal(typeof first.headers.etag, 'string');

  const second = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: {
      'x-api-key': key,
      'if-none-match': first.headers.etag,
    },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(second.statusCode, 304);
});

test('keeps project and environment isolation', async (t) => {
  const { app, key } = await setup(t);
  await createProject(app, 'other', 'Other');
  await createEnvironment(app, 'other');
  await createFlag(app, 'other', 'production', { key: 'other-flag' });

  const response = await evaluate(app, key, 'user-1', 'other-flag');
  assert.equal(response.statusCode, 404);
});

test('legacy API still works against the default environment in v2 mode', async (t) => {
  const { app } = await createV2App(t);
  const create = await app.inject({
    method: 'POST',
    url: '/api/flags',
    headers: AUTHORIZATION,
    payload: { key: 'legacy-check', enabled: true, rolloutPercentage: 100 },
  });
  const evaluation = await app.inject({
    method: 'POST',
    url: '/api/evaluate',
    payload: { flagKey: 'legacy-check', userId: 'user-1' },
  });

  assert.equal(create.statusCode, 201);
  assert.equal(create.json().key, 'legacy-check');
  assert.equal(evaluation.statusCode, 200);
  assert.equal(evaluation.json().enabled, true);
  assert.equal(evaluation.json().rolloutPercentage, 100);
});

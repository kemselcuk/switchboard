import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHORIZATION,
  createApiKey,
  createEnvironment,
  createProject,
  createV2App,
} from './helpers.js';

test('creates a server key once and never lists the secret', async (t) => {
  const { app, v2 } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');

  const created = await createApiKey(app, 'demo', 'production', 'CI key');

  assert.equal(created.type, 'server');
  assert.match(created.prefix, /^sb_srv_[a-f0-9]{8}$/);
  assert.match(created.key, /^sb_srv_[a-f0-9]{8}_/);

  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/api-keys',
    headers: AUTHORIZATION,
  });

  assert.equal(list.statusCode, 200);
  assert.equal(list.json().apiKeys.length, 1);
  assert.equal(list.json().apiKeys[0].key, undefined);
  assert.equal(list.json().apiKeys[0].hash, undefined);

  const stored = await v2.db
    .selectFrom('api_keys')
    .selectAll()
    .executeTakeFirst();

  assert.notEqual(stored.hash, created.key);
  assert.equal(stored.hash.length, 64);
});

test('revokes an API key and rejects it afterwards', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  const created = await createApiKey(app, 'demo', 'production');

  const before = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/missing',
    headers: { 'x-api-key': created.key },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(before.statusCode, 404);

  const revoke = await app.inject({
    method: 'DELETE',
    url: `/api/v1/projects/demo/environments/production/api-keys/${created.id}`,
    headers: AUTHORIZATION,
  });
  assert.equal(revoke.statusCode, 200);

  const after = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/missing',
    headers: { 'x-api-key': created.key },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(after.statusCode, 401);
});

test('rejects unknown API keys and missing keys', async (t) => {
  const { app } = await createV2App(t);

  const missing = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/missing',
    payload: { context: {} },
  });
  const unknown = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/missing',
    headers: { 'x-api-key': 'sb_srv_deadbeef_invalid' },
    payload: { context: {} },
  });

  assert.equal(missing.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
});

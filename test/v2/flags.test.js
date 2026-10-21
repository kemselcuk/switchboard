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

test('creates and lists flags with percentage precision', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');

  const flag = await createFlag(app, 'demo', 'production', {
    rolloutPercentage: 20.125,
  });

  assert.equal(flag.key, 'new-checkout');
  assert.equal(flag.enabled, true);
  assert.equal(flag.rolloutPercentage, 20.125);

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags',
    headers: AUTHORIZATION,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().flags.length, 1);
});

test('supports the same flag key in two environments', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo', 'production', 'Production');
  await createEnvironment(app, 'demo', 'staging', 'Staging');

  await createFlag(app, 'demo', 'production', { enabled: true, rolloutPercentage: 40 });
  await createFlag(app, 'demo', 'staging', { enabled: false, rolloutPercentage: 10 });

  const production = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags/new-checkout',
    headers: AUTHORIZATION,
  });
  const staging = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/staging/flags/new-checkout',
    headers: AUTHORIZATION,
  });

  assert.equal(production.statusCode, 200);
  assert.equal(production.json().enabled, true);
  assert.equal(production.json().rolloutPercentage, 40);
  assert.equal(staging.statusCode, 200);
  assert.equal(staging.json().enabled, false);
  assert.equal(staging.json().rolloutPercentage, 10);
});

test('exposes per-project numeric legacy ids on the legacy API', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app, 'demo');
  await createEnvironment(app, 'demo');

  await createFlag(app, 'demo', 'production', { key: 'demo-flag' });
  await createFlag(app, 'default', 'production', { key: 'default-flag' });
  await createFlag(app, 'default', 'production', { key: 'second-default-flag' });

  const legacy = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: AUTHORIZATION,
  });

  assert.equal(legacy.statusCode, 200);
  const flags = legacy.json().flags;
  assert.deepEqual(
    flags.map((flag) => [flag.key, flag.id]),
    [['default-flag', 1], ['second-default-flag', 2]],
  );
});

test('patches flag description, enabled state and rollout', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production');

  const response = await app.inject({
    method: 'PATCH',
    url: '/api/v1/projects/demo/environments/production/flags/new-checkout',
    headers: AUTHORIZATION,
    payload: { description: 'Updated', enabled: false, rolloutPercentage: 5.5 },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().description, 'Updated');
  assert.equal(response.json().enabled, false);
  assert.equal(response.json().rolloutPercentage, 5.5);
});

test('rejects duplicate flags in the same environment', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production');

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/demo/environments/production/flags',
    headers: AUTHORIZATION,
    payload: { key: 'new-checkout' },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'FLAG_EXISTS');
});

test('isolates flags by project', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app, 'alpha', 'Alpha');
  await createProject(app, 'beta', 'Beta');
  await createEnvironment(app, 'alpha');
  await createEnvironment(app, 'beta');
  await createFlag(app, 'alpha', 'production', { key: 'alpha-flag' });

  const alpha = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/alpha/environments/production/flags/alpha-flag',
    headers: AUTHORIZATION,
  });
  const beta = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/beta/environments/production/flags/alpha-flag',
    headers: AUTHORIZATION,
  });

  assert.equal(alpha.statusCode, 200);
  assert.equal(beta.statusCode, 404);
  assert.equal(beta.json().error.code, 'FLAG_NOT_FOUND');
});

test('does not mutate another environment on a failed description-only PATCH', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo', 'production', 'Production');
  await createEnvironment(app, 'demo', 'staging', 'Staging');
  await createFlag(app, 'demo', 'production', {
    description: 'production description',
  });

  const failed = await app.inject({
    method: 'PATCH',
    url: '/api/v1/projects/demo/environments/staging/flags/new-checkout',
    headers: AUTHORIZATION,
    payload: { description: 'should not leak' },
  });
  const production = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags/new-checkout',
    headers: AUTHORIZATION,
  });

  assert.equal(failed.statusCode, 404);
  assert.equal(failed.json().error.code, 'FLAG_NOT_FOUND');
  assert.equal(production.statusCode, 200);
  assert.equal(production.json().description, 'production description');
});

test('validates rollout precision and unknown flags', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');

  const tooPrecise = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/demo/environments/production/flags',
    headers: AUTHORIZATION,
    payload: { key: 'precise', rolloutPercentage: 1.2345 },
  });
  const missing = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags/missing',
    headers: AUTHORIZATION,
  });

  assert.equal(tooPrecise.statusCode, 400);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'FLAG_NOT_FOUND');
});


test('deletes a flag and all environment configs without touching other projects', async (t) => {
  const { app, v2 } = await createV2App(t);
  await createProject(app, 'demo', 'Demo');
  await createEnvironment(app, 'demo', 'production');
  await createEnvironment(app, 'demo', 'staging');
  await createFlag(app, 'demo', 'production', { key: 'new-checkout' });
  await createFlag(app, 'demo', 'staging', { key: 'new-checkout' });
  const key = await createApiKey(app, 'demo', 'production');

  await createProject(app, 'other', 'Other');
  await createEnvironment(app, 'other', 'production');
  await createFlag(app, 'other', 'production', { key: 'new-checkout' });

  const before = await v2.db
    .selectFrom('flags')
    .innerJoin('projects', 'projects.id', 'flags.project_id')
    .select(['flags.id', 'flags.legacy_id'])
    .where('projects.key', '=', 'demo')
    .where('flags.key', '=', 'new-checkout')
    .executeTakeFirst();

  const deleted = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/flags/new-checkout',
    headers: AUTHORIZATION,
  });

  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.json(), { key: 'new-checkout', deleted: true });

  for (const environment of ['production', 'staging']) {
    const flag = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/demo/environments/${environment}/flags/new-checkout`,
      headers: AUTHORIZATION,
    });
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/demo/environments/${environment}/flags`,
      headers: AUTHORIZATION,
    });

    assert.equal(flag.statusCode, 404);
    assert.equal(list.json().flags.length, 0);
  }

  const other = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/other/environments/production/flags/new-checkout',
    headers: AUTHORIZATION,
  });
  assert.equal(other.statusCode, 200);

  const evaluation = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/new-checkout',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(evaluation.statusCode, 404);
  assert.equal(evaluation.json().errorCode, 'FLAG_NOT_FOUND');

  const remainingConfigs = await v2.db
    .selectFrom('flag_configs')
    .innerJoin('flags', 'flags.id', 'flag_configs.flag_id')
    .innerJoin('projects', 'projects.id', 'flags.project_id')
    .select('flag_configs.id')
    .where('projects.key', '=', 'demo')
    .execute();
  assert.equal(remainingConfigs.length, 0);

  const recreated = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/demo/environments/production/flags',
    headers: AUTHORIZATION,
    payload: { key: 'new-checkout', enabled: true, rolloutPercentage: 10 },
  });
  assert.equal(recreated.statusCode, 201);

  const after = await v2.db
    .selectFrom('flags')
    .innerJoin('projects', 'projects.id', 'flags.project_id')
    .select(['flags.id', 'flags.legacy_id'])
    .where('projects.key', '=', 'demo')
    .where('flags.key', '=', 'new-checkout')
    .executeTakeFirst();

  assert.notEqual(after.id, before.id);
  assert.equal(after.legacy_id, before.legacy_id + 1);
});

test('validates flag deletion requests', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app, 'demo');
  await createEnvironment(app, 'demo', 'production');
  await createFlag(app, 'demo', 'production');

  const unknownProject = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/missing/flags/new-checkout',
    headers: AUTHORIZATION,
  });
  const unknownFlag = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/flags/missing',
    headers: AUTHORIZATION,
  });
  const unauthenticated = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/flags/new-checkout',
  });
  const invalidKey = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/flags/BAD',
    headers: AUTHORIZATION,
  });

  assert.equal(unknownProject.statusCode, 404);
  assert.equal(unknownProject.json().error.code, 'PROJECT_NOT_FOUND');
  assert.equal(unknownFlag.statusCode, 404);
  assert.equal(unknownFlag.json().error.code, 'FLAG_NOT_FOUND');
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(invalidKey.statusCode, 400);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHORIZATION,
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

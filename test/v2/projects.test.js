import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHORIZATION,
  createEnvironment,
  createProject,
  createV2App,
} from './helpers.js';

test('v2 management routes require the admin token', async (t) => {
  const { app } = await createV2App(t);
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/projects',
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHORIZED');
});

test('creates and lists projects', async (t) => {
  const { app } = await createV2App(t);
  const project = await createProject(app, 'checkout', 'Checkout');

  assert.equal(project.key, 'checkout');
  assert.equal(project.name, 'Checkout');

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/projects',
    headers: AUTHORIZATION,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(
    response.json().projects.some(
      (item) => item.key === 'checkout' && item.name === 'Checkout',
    ),
    true,
  );
});

test('rejects a duplicate project key', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app, 'duplicate', 'First');

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: AUTHORIZATION,
    payload: { key: 'duplicate', name: 'Second' },
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'PROJECT_EXISTS');
});

test('creates and lists environments inside a project', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app, 'demo', 'Demo');
  const environment = await createEnvironment(app, 'demo', 'staging', 'Staging');

  assert.equal(environment.key, 'staging');

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments',
    headers: AUTHORIZATION,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().environments.length, 1);
  assert.equal(response.json().environments[0].key, 'staging');
});

test('rejects a duplicate environment key and unknown project', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app, 'demo', 'Demo');
  await createEnvironment(app, 'demo', 'staging', 'Staging');

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/demo/environments',
    headers: AUTHORIZATION,
    payload: { key: 'staging', name: 'Again' },
  });

  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'ENVIRONMENT_EXISTS');

  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/missing/environments',
    headers: AUTHORIZATION,
    payload: { key: 'staging', name: 'Staging' },
  });

  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'PROJECT_NOT_FOUND');
});

test('validates project keys and bodies', async (t) => {
  const { app } = await createV2App(t);
  const invalidKey = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: AUTHORIZATION,
    payload: { key: 'Bad Key', name: 'Bad' },
  });
  const missingName = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: AUTHORIZATION,
    payload: { key: 'valid' },
  });

  assert.equal(invalidKey.statusCode, 400);
  assert.equal(missingName.statusCode, 400);
  assert.equal(invalidKey.json().error.code, 'VALIDATION_ERROR');
});

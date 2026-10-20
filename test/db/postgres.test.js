import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { buildApp } from '../../src/app.js';
import { initializeV2Database } from '../../src/v2/db.js';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = DATABASE_URL ? false : 'DATABASE_URL is not set';

test('Postgres migrations and v2 evaluation flow', { skip }, async (t) => {
  const v2 = await initializeV2Database({ databaseUrl: DATABASE_URL });
  const app = buildApp({ v2, adminToken: 'postgres-test-token' });
  const auth = { authorization: 'Bearer postgres-test-token' };
  const projectKey = `pg-${randomUUID().slice(0, 8)}`;

  t.after(() => app.close());

  const project = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: auth,
    payload: { key: projectKey, name: 'Postgres test' },
  });
  assert.equal(project.statusCode, 201);

  const environment = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectKey}/environments`,
    headers: auth,
    payload: { key: 'production', name: 'Production' },
  });
  assert.equal(environment.statusCode, 201);

  const flag = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectKey}/environments/production/flags`,
    headers: auth,
    payload: { key: 'checkout', enabled: true, rolloutPercentage: 100 },
  });
  assert.equal(flag.statusCode, 201);

  const key = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectKey}/environments/production/api-keys`,
    headers: auth,
    payload: { name: 'server' },
  });
  assert.equal(key.statusCode, 201);

  const evaluation = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/checkout',
    headers: { 'x-api-key': key.json().key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(evaluation.statusCode, 200);
  assert.equal(evaluation.json().value, true);
  assert.equal(evaluation.json().reason, 'SPLIT');
});

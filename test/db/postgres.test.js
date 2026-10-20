import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildApp } from '../../src/app.js';
import { openDatabase } from '../../src/db.js';
import { createRepository } from '../../src/flags/repository.js';
import { initializeV2Database } from '../../src/v2/db.js';
import { migrateLegacyFlags } from '../../src/v2/migrate-legacy.js';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = DATABASE_URL ? false : 'DATABASE_URL is not set';

test('maps a Postgres storage failure to 503', { skip }, async (t) => {
  const v2 = await initializeV2Database({ databaseUrl: DATABASE_URL });
  const app = buildApp({ v2, adminToken: 'postgres-test-token' });

  t.after(() => app.close());

  const original = v2.db.selectFrom.bind(v2.db);
  v2.db.selectFrom = () => {
    const error = new Error('terminating connection due to administrator command');

    error.code = '57P01';
    throw error;
  };

  let response;

  try {
    response = await app.inject({
      method: 'GET',
      url: '/api/flags',
      headers: { authorization: 'Bearer postgres-test-token' },
    });
  } finally {
    v2.db.selectFrom = original;
  }

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: {
      code: 'EVALUATION_UNAVAILABLE',
      message: 'Flag storage is unavailable',
    },
  });
});

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


test('Postgres covers migration, legacy routes, isolation and revocation', { skip }, async (t) => {
  const v2 = await initializeV2Database({ databaseUrl: DATABASE_URL });
  const app = buildApp({ v2, adminToken: 'postgres-test-token' });
  const auth = { authorization: 'Bearer postgres-test-token' };
  const suffix = randomUUID().slice(0, 8);
  const directory = mkdtempSync(join(tmpdir(), 'switchboard-pg-migration-'));

  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function createProject(key) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: auth,
      payload: { key, name: key },
    });

    assert.equal(response.statusCode, 201);
  }

  async function createFlag(project, key) {
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project}/environments`,
      headers: auth,
      payload: { key: 'production', name: 'Production' },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project}/environments/production/flags`,
      headers: auth,
      payload: { key, enabled: true, rolloutPercentage: 100 },
    });

    assert.equal(response.statusCode, 201);
  }

  async function createKey(project) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project}/environments/production/api-keys`,
      headers: auth,
      payload: { name: 'server' },
    });

    assert.equal(response.statusCode, 201);

    return response.json();
  }

  const projectA = `pga-${suffix}`;
  const projectB = `pgb-${suffix}`;
  await createProject(projectA);
  await createFlag(projectA, 'shared-flag');
  const keyA = await createKey(projectA);
  await createProject(projectB);
  await createFlag(projectB, 'only-b');
  const keyB = await createKey(projectB);

  const crossProject = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/only-b',
    headers: { 'x-api-key': keyA.key },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(crossProject.statusCode, 404);

  const ownProject = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/only-b',
    headers: { 'x-api-key': keyB.key },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(ownProject.statusCode, 200);
  assert.equal(ownProject.json().value, true);

  const revoked = await app.inject({
    method: 'DELETE',
    url: `/api/v1/projects/${projectB}/environments/production/api-keys/${keyB.id}`,
    headers: auth,
  });
  assert.equal(revoked.statusCode, 200);

  const afterRevoke = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/only-b',
    headers: { 'x-api-key': keyB.key },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(afterRevoke.statusCode, 401);

  const legacyKey = `pg-legacy-${suffix}`;
  const legacyCreate = await app.inject({
    method: 'POST',
    url: '/api/flags',
    headers: auth,
    payload: { key: legacyKey, enabled: true, rolloutPercentage: 37 },
  });
  assert.equal(legacyCreate.statusCode, 201);
  assert.equal(typeof legacyCreate.json().id, 'number');

  const legacyPath = join(directory, 'legacy.db');
  const legacyDb = openDatabase({ dbPath: legacyPath });
  const legacyRepository = createRepository(legacyDb);
  const migratedKey = `pg-migrated-${suffix}`;
  legacyRepository.createFlag({
    key: migratedKey,
    enabled: true,
    rolloutPercentage: 37,
  });
  legacyDb.close();

  const migrated = await migrateLegacyFlags({
    legacyDbPath: legacyPath,
    db: v2.db,
    projectId: v2.defaultProjectId,
    environmentId: v2.defaultEnvironmentId,
  });
  assert.deepEqual(migrated, { total: 1, migrated: 1, skipped: 0 });

  const legacyList = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: auth,
  });
  assert.equal(legacyList.statusCode, 200);
  const migratedFlag = legacyList.json().flags.find(
    (flag) => flag.key === migratedKey,
  );
  assert.equal(typeof migratedFlag.id, 'number');
  assert.equal(migratedFlag.rolloutPercentage, 37);

  const legacyEvaluation = await app.inject({
    method: 'POST',
    url: '/api/evaluate',
    payload: { flagKey: migratedKey, userId: 'user-1' },
  });
  assert.equal(legacyEvaluation.statusCode, 200);
  assert.equal(legacyEvaluation.json().rolloutPercentage, 37);

  await assert.rejects(() => v2.db
    .updateTable('flag_configs')
    .set({ enabled: 2 })
    .execute());
  await assert.rejects(() => v2.db
    .updateTable('flag_configs')
    .set({ rollout_basis_points: 100001 })
    .execute());
});

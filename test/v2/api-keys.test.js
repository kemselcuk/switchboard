import test from 'node:test';
import assert from 'node:assert/strict';

import {
  API_KEY_CACHE_TTL_MS,
  createApiKeyRepository,
} from '../../src/v2/repositories/api-keys.js';
import {
  AUTHORIZATION,
  createApiKey,
  createEnvironment,
  createProject,
  createV2App,
} from './helpers.js';

function countSelectFrom(t, v2) {
  const original = v2.db.selectFrom;
  const calls = { total: 0, apiKeys: 0 };

  v2.db.selectFrom = (...args) => {
    calls.total += 1;

    if (args[0] === 'api_keys') {
      calls.apiKeys += 1;
    }

    return original.apply(v2.db, args);
  };

  t.after(() => {
    v2.db.selectFrom = original;
  });

  return calls;
}

function countUpdateTable(t, v2) {
  const original = v2.db.updateTable;
  const calls = { total: 0, apiKeys: 0 };

  v2.db.updateTable = (...args) => {
    calls.total += 1;

    if (args[0] === 'api_keys') {
      calls.apiKeys += 1;
    }

    return original.apply(v2.db, args);
  };

  t.after(() => {
    v2.db.updateTable = original;
  });

  return calls;
}

// A db stub whose first selectFrom(...).executeTakeFirst() stays pending until
// the test resolves it, while later lookups return the current row. It models
// a read that started before a revoke and answers after it.
function createRacingDb() {
  const liveRow = {
    key_id: 'key-1',
    hash: 'a'.repeat(64),
    type: 'server',
    revoked_at: null,
    last_used_at: null,
    environment_id: 'env-1',
    environment_key: 'production',
    environment_name: 'Production',
    project_id: 'project-1',
    project_key: 'demo',
    project_name: 'Demo',
  };
  const revokedRow = {
    ...liveRow,
    revoked_at: '2026-10-21T00:00:00.000Z',
  };
  let currentRow = liveRow;
  let lookups = 0;
  let markStarted;
  let resolveLookup;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });

  const selectQuery = {
    innerJoin() {
      return this;
    },
    select() {
      return this;
    },
    where() {
      return this;
    },
    executeTakeFirst() {
      lookups += 1;

      if (lookups === 1) {
        markStarted();

        return new Promise((resolve) => {
          resolveLookup = resolve;
        });
      }

      return Promise.resolve(currentRow);
    },
  };

  const updateQuery = {
    set() {
      return this;
    },
    where() {
      return this;
    },
    executeTakeFirst() {
      return Promise.resolve({ numUpdatedRows: 1 });
    },
  };

  return {
    db: {
      selectFrom() {
        return selectQuery;
      },
      updateTable() {
        return updateQuery;
      },
    },
    liveRow,
    revokedRow,
    started,
    resolveLookup: (row) => resolveLookup(row),
    revoke: () => {
      currentRow = revokedRow;
    },
    lookupCount: () => lookups,
  };
}

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

test('records last use once and throttles repeat writes', async (t) => {
  const { app, v2 } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  const created = await createApiKey(app, 'demo', 'production');

  // Keep both evaluations inside the one-minute throttle window even though
  // the wall clock moves while they run.
  let now = Date.now() + 1000;
  t.mock.method(Date, 'now', () => now);

  const updates = countUpdateTable(t, v2);
  const repository = createApiKeyRepository(v2.db);

  const evaluate = () => app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/missing',
    headers: { 'x-api-key': created.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal((await evaluate()).statusCode, 404);

  now += 100;
  assert.equal((await evaluate()).statusCode, 404);

  // Both requests evaluated, but only the first one wrote last_used_at.
  assert.equal(updates.apiKeys, 1);

  const stored = await v2.db
    .selectFrom('api_keys')
    .select('last_used_at')
    .where('id', '=', created.id)
    .executeTakeFirst();

  assert.equal(typeof stored.last_used_at, 'string');

  // The cached record carries the same value the touch wrote, so the next
  // throttled evaluation still sees a fresh timestamp.
  const cachedAfterUse = await repository.findApiKeyByPrefix(created.prefix);

  assert.equal(cachedAfterUse.last_used_at, stored.last_used_at);
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

test('serves repeat API key prefix lookups from the cache', async (t) => {
  const { app, v2 } = await createV2App(t);
  await createProject(app);
  const environment = await createEnvironment(app, 'demo');
  const created = await createApiKey(app, 'demo', 'production');

  const calls = countSelectFrom(t, v2);
  const repository = createApiKeyRepository(v2.db);

  const first = await repository.findApiKeyByPrefix(created.prefix);

  assert.equal(first.key_id, created.id);
  assert.equal(first.environment_id, environment.id);
  assert.equal(calls.apiKeys, 1);
  assert.equal(calls.total, 1);

  // The OFREP auth hook builds its own repository over the same db; the
  // cache must be shared, not duplicated per repository instance.
  const authRepository = createApiKeyRepository(v2.db);
  const second = await authRepository.findApiKeyByPrefix(created.prefix);

  assert.equal(second.key_id, created.id);
  assert.equal(second.hash, first.hash);
  assert.equal(second.last_used_at, null);
  assert.equal(calls.apiKeys, 1);
  assert.equal(calls.total, 1);

  // Unknown prefixes are never cached.
  assert.equal(await repository.findApiKeyByPrefix('sb_srv_00000000'), null);
  assert.equal(await repository.findApiKeyByPrefix('sb_srv_00000000'), null);
  assert.equal(calls.apiKeys, 3);

  const evaluate = () => app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/missing',
    headers: { 'x-api-key': created.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  const beforeEvaluations = calls.total;

  assert.equal((await evaluate()).statusCode, 404);
  assert.equal((await evaluate()).statusCode, 404);

  // Each evaluation still reads flags, but the prefix stays cached.
  assert.equal(calls.apiKeys, 3);
  assert.equal(calls.total, beforeEvaluations + 2);

  // A cache hit returns the same last_used_at a fresh query would, so the
  // once-per-minute touch throttle keeps working off cached records.
  const stored = await v2.db
    .selectFrom('api_keys')
    .select('last_used_at')
    .where('id', '=', created.id)
    .executeTakeFirst();
  const cachedAfterUse = await repository.findApiKeyByPrefix(created.prefix);

  assert.equal(typeof stored.last_used_at, 'string');
  assert.equal(cachedAfterUse.last_used_at, stored.last_used_at);
});

test('revoking a key invalidates the cached prefix immediately', async (t) => {
  const { app, v2 } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  const created = await createApiKey(app, 'demo', 'production');

  // Freeze the clock so the cached entry can never expire during this test:
  // the fresh read below can only come from invalidation, not the TTL.
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);

  const calls = countSelectFrom(t, v2);
  const repository = createApiKeyRepository(v2.db);

  const cached = await repository.findApiKeyByPrefix(created.prefix);

  assert.equal(cached.revoked_at, null);
  assert.equal(calls.apiKeys, 1);

  // The management route uses a different repository instance over the same
  // db, so this also proves the shared cache is invalidated.
  const revoke = await app.inject({
    method: 'DELETE',
    url: `/api/v1/projects/demo/environments/production/api-keys/${created.id}`,
    headers: AUTHORIZATION,
  });

  assert.equal(revoke.statusCode, 200);

  const reloaded = await repository.findApiKeyByPrefix(created.prefix);

  assert.notEqual(reloaded.revoked_at, null);
  assert.equal(calls.apiKeys, 2);
  assert.equal(Date.now(), now);

  const evaluation = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/missing',
    headers: { 'x-api-key': created.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(evaluation.statusCode, 401);
  assert.equal(calls.apiKeys, 2);
});

test('serves the cached prefix up to the TTL and re-reads at the boundary', async (t) => {
  const { app, v2 } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  const created = await createApiKey(app, 'demo', 'production');

  let now = Date.now();
  t.mock.method(Date, 'now', () => now);

  const calls = countSelectFrom(t, v2);
  const repository = createApiKeyRepository(v2.db);

  assert.equal(
    (await repository.findApiKeyByPrefix(created.prefix)).key_id,
    created.id,
  );
  assert.equal(calls.apiKeys, 1);

  // One millisecond before the TTL the cached entry is still valid.
  now += API_KEY_CACHE_TTL_MS - 1;

  assert.equal(
    (await repository.findApiKeyByPrefix(created.prefix)).key_id,
    created.id,
  );
  assert.equal(calls.apiKeys, 1);

  // At exactly the TTL the entry has expired and the row is queried again.
  now += 1;

  assert.equal(
    (await repository.findApiKeyByPrefix(created.prefix)).key_id,
    created.id,
  );
  assert.equal(calls.apiKeys, 2);
});

test('does not cache a lookup that raced with a revocation', async () => {
  const fake = createRacingDb();
  const repository = createApiKeyRepository(fake.db);
  const prefix = 'sb_srv_race0000';

  const pending = repository.findApiKeyByPrefix(prefix);

  await fake.started;

  // The revoke and its invalidation land while the lookup is in flight.
  await repository.revokeApiKey('env-1', 'key-1');
  fake.revoke();
  fake.resolveLookup(fake.liveRow);

  const stale = await pending;

  // The caller still gets the row the query returned, even though it is now
  // stale, but that row must not be stored in the invalidated cache.
  assert.equal(stale.key_id, 'key-1');
  assert.equal(stale.revoked_at, null);
  assert.equal(fake.lookupCount(), 1);

  const reloaded = await repository.findApiKeyByPrefix(prefix);

  assert.equal(reloaded.key_id, 'key-1');
  assert.equal(reloaded.revoked_at, fake.revokedRow.revoked_at);
  assert.equal(fake.lookupCount(), 2);

  // Normal caching resumes once the generation is stable again.
  const cached = await repository.findApiKeyByPrefix(prefix);

  assert.equal(cached.revoked_at, fake.revokedRow.revoked_at);
  assert.equal(fake.lookupCount(), 2);
});

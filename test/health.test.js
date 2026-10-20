import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createV2App } from './v2/helpers.js';

test('GET /healthz returns ok', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/healthz' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('buildApp accepts an injected repository without opening a database', async (t) => {
  const repository = {
    createFlag() {
      throw new Error('not implemented');
    },
    listFlags() {
      return [];
    },
    getFlag() {
      return null;
    },
    updateFlag() {
      throw new Error('not implemented');
    },
  };

  const app = buildApp({ repository });
  t.after(() => app.close());

  assert.equal(app.repository, repository);
  assert.equal(app.hasDecorator('db'), false);

  const response = await app.inject({ method: 'GET', url: '/healthz' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('app.close() closes the owned database', async () => {
  const app = buildApp();
  const db = app.db;

  assert.equal(db.open, true);

  await app.close();

  assert.equal(db.open, false);
});

test('GET /readyz pings v1 storage and returns ready', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/readyz' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ready' });
});

test('GET /readyz returns 503 when v1 storage is unavailable', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  app.db.close();

  const response = await app.inject({ method: 'GET', url: '/readyz' });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: {
      code: 'EVALUATION_UNAVAILABLE',
      message: 'Flag storage is unavailable',
    },
  });
  assert.equal(response.body.includes('database connection'), false);
  assert.equal(response.body.includes('health.test.js'), false);
});

test('GET /readyz pings v2 storage and returns ready', async (t) => {
  const { app } = await createV2App(t);

  const response = await app.inject({ method: 'GET', url: '/readyz' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ready' });
});

test('GET /readyz returns 503 when v2 storage is unavailable', async (t) => {
  const { app, v2 } = await createV2App(t);
  const original = v2.db.getExecutor.bind(v2.db);

  v2.db.getExecutor = () => {
    throw new Error('storage down');
  };
  t.after(() => {
    v2.db.getExecutor = original;
  });

  const response = await app.inject({ method: 'GET', url: '/readyz' });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: {
      code: 'EVALUATION_UNAVAILABLE',
      message: 'Flag storage is unavailable',
    },
  });
  assert.equal(response.body.includes('storage down'), false);
  assert.equal(response.body.includes('health.test.js'), false);
});

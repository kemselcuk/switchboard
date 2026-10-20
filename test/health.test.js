import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

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

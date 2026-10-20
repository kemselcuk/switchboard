import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, parsePoolMax } from '../../src/v2/db.js';

const DUMMY_DATABASE_URL =
  'postgres://user:pass@127.0.0.1:65432/switchboard';

function createPostgresHandle(poolMax) {
  const previous = process.env.DATABASE_POOL_MAX;

  if (poolMax === undefined) {
    delete process.env.DATABASE_POOL_MAX;
  } else {
    process.env.DATABASE_POOL_MAX = poolMax;
  }

  try {
    return createDatabase({ databaseUrl: DUMMY_DATABASE_URL });
  } finally {
    if (previous === undefined) {
      delete process.env.DATABASE_POOL_MAX;
    } else {
      process.env.DATABASE_POOL_MAX = previous;
    }
  }
}

test('parsePoolMax accepts positive integers', () => {
  assert.equal(parsePoolMax('5'), 5);
  assert.equal(parsePoolMax(5), 5);
  assert.equal(parsePoolMax('10'), 10);
});

test('parsePoolMax rejects unset and non-positive-integer values', () => {
  assert.equal(parsePoolMax(undefined), undefined);
  assert.equal(parsePoolMax(null), undefined);
  assert.equal(parsePoolMax('abc'), undefined);
  assert.equal(parsePoolMax('0'), undefined);
  assert.equal(parsePoolMax('-3'), undefined);
  assert.equal(parsePoolMax('2.5'), undefined);
});

test('createDatabase builds a postgres handle with a valid pool max', async () => {
  const handle = createPostgresHandle('5');

  assert.equal(handle.dialect, 'postgres');
  await handle.destroy();
});

test('createDatabase builds a postgres handle with the pool max unset', async () => {
  const handle = createPostgresHandle(undefined);

  assert.equal(handle.dialect, 'postgres');
  await handle.destroy();
});

test('createDatabase builds a postgres handle with an invalid pool max', async () => {
  const handle = createPostgresHandle('abc');

  assert.equal(handle.dialect, 'postgres');
  await handle.destroy();
});

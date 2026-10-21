import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, parsePoolMax } from '../../src/v2/db.js';

const DUMMY_DATABASE_URL =
  'postgres://user:pass@127.0.0.1:65432/switchboard';

async function withPoolMax(value, fn) {
  const previous = process.env.DATABASE_POOL_MAX;

  if (value === undefined) {
    delete process.env.DATABASE_POOL_MAX;
  } else {
    process.env.DATABASE_POOL_MAX = value;
  }

  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.DATABASE_POOL_MAX;
    } else {
      process.env.DATABASE_POOL_MAX = previous;
    }
  }
}

async function withPostgresHandle(poolMax, fn) {
  return withPoolMax(poolMax, async () => {
    const handle = createDatabase({ databaseUrl: DUMMY_DATABASE_URL });

    try {
      return await fn(handle);
    } finally {
      await handle.destroy();
    }
  });
}

test('parsePoolMax accepts positive integer strings and numbers', () => {
  assert.equal(parsePoolMax('5'), 5);
  assert.equal(parsePoolMax(5), 5);
  assert.equal(parsePoolMax('10'), 10);
  assert.equal(parsePoolMax('1000'), 1000);
});

test('parsePoolMax rejects missing, malformed, and out-of-range values', () => {
  const invalidValues = [
    undefined,
    null,
    '',
    ' 5',
    '5.0',
    '1e3',
    '0x10',
    true,
    'abc',
    '0',
    '-3',
    '2.5',
    '1001',
  ];

  for (const value of invalidValues) {
    assert.equal(
      parsePoolMax(value),
      undefined,
      `expected ${String(value)} to be rejected`,
    );
  }
});

test('createDatabase builds a postgres handle with a valid pool max', async () => {
  await withPostgresHandle('5', async (handle) => {
    assert.equal(handle.dialect, 'postgres');
    assert.equal(handle.pool.options.max, 5);
  });
});

test('createDatabase builds a postgres handle with the pool max unset', async () => {
  await withPostgresHandle(undefined, async (handle) => {
    assert.equal(handle.dialect, 'postgres');
    assert.equal(handle.pool.options.max, 10);
  });
});

test('createDatabase builds a postgres handle with an invalid pool max', async () => {
  await withPostgresHandle('abc', async (handle) => {
    assert.equal(handle.dialect, 'postgres');
    assert.equal(handle.pool.options.max, 10);
  });
});

test('createDatabase ignores DATABASE_POOL_MAX for sqlite', async () => {
  await withPoolMax('5', async () => {
    const handle = createDatabase({ dbPath: ':memory:' });

    try {
      assert.equal(handle.dialect, 'sqlite');
      assert.equal(Object.hasOwn(handle, 'pool'), false);
    } finally {
      await handle.destroy();
    }
  });
});

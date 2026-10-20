import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase } from '../src/db.js';
import {
  createRepository,
  FlagExistsError,
  FlagNotFoundError,
} from '../src/flags/repository.js';

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function createTestRepository() {
  const db = openDatabase();
  return { db, repository: createRepository(db) };
}

test('createFlag stores a flag and returns it in camelCase', (t) => {
  const { db, repository } = createTestRepository();
  t.after(() => db.close());

  const flag = repository.createFlag({
    key: 'new-checkout',
    description: 'Yeni ödeme akışı',
    enabled: true,
    rolloutPercentage: 20,
  });

  assert.equal(flag.id, 1);
  assert.equal(flag.key, 'new-checkout');
  assert.equal(flag.description, 'Yeni ödeme akışı');
  assert.equal(flag.enabled, true);
  assert.equal(typeof flag.enabled, 'boolean');
  assert.equal(flag.rolloutPercentage, 20);
  assert.match(flag.createdAt, ISO_TIMESTAMP);
  assert.match(flag.updatedAt, ISO_TIMESTAMP);

  assert.deepEqual(repository.getFlag('new-checkout'), flag);
});

test('createFlag applies defaults for optional fields', (t) => {
  const { db, repository } = createTestRepository();
  t.after(() => db.close());

  const flag = repository.createFlag({ key: 'defaults' });

  assert.equal(flag.description, '');
  assert.equal(flag.enabled, false);
  assert.equal(typeof flag.enabled, 'boolean');
  assert.equal(flag.rolloutPercentage, 0);
});

test('getFlag returns null for an unknown key', (t) => {
  const { db, repository } = createTestRepository();
  t.after(() => db.close());

  assert.equal(repository.getFlag('missing'), null);
});

test('listFlags returns flags in creation order', (t) => {
  const { db, repository } = createTestRepository();
  t.after(() => db.close());

  assert.deepEqual(repository.listFlags(), []);

  repository.createFlag({ key: 'beta' });
  repository.createFlag({ key: 'alpha' });

  assert.deepEqual(
    repository.listFlags().map((flag) => flag.key),
    ['beta', 'alpha'],
  );
});

test('updateFlag only changes the provided fields', (t) => {
  const { db, repository } = createTestRepository();
  t.after(() => db.close());

  const created = repository.createFlag({
    key: 'checkout',
    description: 'first',
    enabled: true,
    rolloutPercentage: 20,
  });

  const updated = repository.updateFlag('checkout', {
    description: 'second',
    enabled: false,
  });

  assert.equal(updated.id, created.id);
  assert.equal(updated.key, created.key);
  assert.equal(updated.description, 'second');
  assert.equal(updated.enabled, false);
  assert.equal(updated.rolloutPercentage, 20);
  assert.match(updated.updatedAt, ISO_TIMESTAMP);
  assert.ok(updated.updatedAt >= created.updatedAt);

  const rolloutOnly = repository.updateFlag('checkout', {
    rolloutPercentage: 40,
  });

  assert.equal(rolloutOnly.description, 'second');
  assert.equal(rolloutOnly.enabled, false);
  assert.equal(rolloutOnly.rolloutPercentage, 40);
});

test('updateFlag with an empty patch returns the current flag', (t) => {
  const { db, repository } = createTestRepository();
  t.after(() => db.close());

  const created = repository.createFlag({ key: 'unchanged', enabled: true });
  const updated = repository.updateFlag('unchanged', {});

  assert.deepEqual(updated, created);
});

test('createFlag rejects a duplicate key', (t) => {
  const { db, repository } = createTestRepository();
  t.after(() => db.close());

  repository.createFlag({ key: 'duplicate' });

  assert.throws(
    () => repository.createFlag({ key: 'duplicate' }),
    (error) => {
      assert.ok(error instanceof FlagExistsError);
      assert.equal(error.code, 'FLAG_EXISTS');
      return true;
    },
  );
  assert.equal(repository.listFlags().length, 1);
});

test('updateFlag rejects an unknown key', (t) => {
  const { db, repository } = createTestRepository();
  t.after(() => db.close());

  assert.throws(
    () => repository.updateFlag('missing', { enabled: true }),
    (error) => {
      assert.ok(error instanceof FlagNotFoundError);
      assert.equal(error.code, 'FLAG_NOT_FOUND');
      return true;
    },
  );
});

test('schema enforces the rollout percentage bounds', (t) => {
  const { db, repository } = createTestRepository();
  t.after(() => db.close());

  assert.throws(
    () => repository.createFlag({ key: 'too-high', rolloutPercentage: 101 }),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => repository.createFlag({ key: 'negative', rolloutPercentage: -1 }),
    /CHECK constraint failed/,
  );
  assert.equal(repository.listFlags().length, 0);
});

test('file database keeps flags after close and reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'switchboard-test-'));
  const dbPath = join(directory, 'nested', 'switchboard.db');
  let db;

  try {
    db = openDatabase({ dbPath });
    const repository = createRepository(db);
    const created = repository.createFlag({
      key: 'persisted',
      description: 'survives restart',
      enabled: true,
      rolloutPercentage: 25,
    });

    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('user_version', { simple: true }), 1);

    db.close();
    db = null;

    db = openDatabase({ dbPath });
    const reopened = createRepository(db);

    assert.deepEqual(reopened.getFlag('persisted'), created);
  } finally {
    if (db && db.open) {
      db.close();
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

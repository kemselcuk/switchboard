import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildApp } from '../../src/app.js';
import { openDatabase } from '../../src/db.js';
import { createRepository } from '../../src/flags/repository.js';
import { evaluateFlag } from '../../src/flags/evaluator.js';
import { initializeV2Database } from '../../src/v2/db.js';
import { migrateLegacyFlags } from '../../src/v2/migrate-legacy.js';

const ADMIN_TOKEN = 'migration-admin';

test('migrates legacy SQLite flags and preserves evaluation', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'switchboard-migration-'));
  const legacyPath = join(directory, 'legacy.db');
  const legacyDb = openDatabase({ dbPath: legacyPath });
  const legacyRepository = createRepository(legacyDb);

  const legacyFlag = legacyRepository.createFlag({
    key: 'legacy-checkout',
    description: 'Migrated flag',
    enabled: true,
    rolloutPercentage: 37,
  });
  const before = evaluateFlag(legacyFlag, 'user-123');
  legacyDb.close();

  const v2 = await initializeV2Database();
  const app = buildApp({ v2, adminToken: ADMIN_TOKEN });

  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const result = await migrateLegacyFlags({
    legacyDbPath: legacyPath,
    db: v2.db,
    projectId: v2.defaultProjectId,
    environmentId: v2.defaultEnvironmentId,
  });

  assert.deepEqual(result, { total: 1, migrated: 1, skipped: 0 });

  const list = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().flags[0].key, 'legacy-checkout');
  assert.equal(list.json().flags[0].rolloutPercentage, 37);

  const evaluation = await app.inject({
    method: 'POST',
    url: '/api/evaluate',
    payload: { flagKey: 'legacy-checkout', userId: 'user-123' },
  });

  assert.equal(evaluation.statusCode, 200);
  assert.equal(evaluation.json().bucket, before.bucket);
  assert.equal(evaluation.json().enabled, before.enabled);
  assert.equal(evaluation.json().reason, before.reason);

  const again = await migrateLegacyFlags({
    legacyDbPath: legacyPath,
    db: v2.db,
    projectId: v2.defaultProjectId,
    environmentId: v2.defaultEnvironmentId,
  });
  assert.deepEqual(again, { total: 1, migrated: 0, skipped: 1 });
});

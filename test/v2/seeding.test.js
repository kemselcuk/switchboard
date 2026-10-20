import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeV2Database, seedDefaultProject } from '../../src/v2/db.js';

test('default project and environment seeding is idempotent under concurrency', async (t) => {
  const v2 = await initializeV2Database();

  t.after(() => v2.destroy());

  const results = await Promise.all(
    Array.from({ length: 10 }, () => seedDefaultProject(v2.db)),
  );

  const first = results[0];

  for (const result of results) {
    assert.deepEqual(result, first);
  }

  const projects = await v2.db
    .selectFrom('projects')
    .select('id')
    .where('key', '=', 'default')
    .execute();
  const environments = await v2.db
    .selectFrom('environments')
    .select('id')
    .where('project_id', '=', first.defaultProjectId)
    .where('key', '=', 'production')
    .execute();

  assert.equal(projects.length, 1);
  assert.equal(environments.length, 1);
  assert.equal(first.defaultProjectId, v2.defaultProjectId);
  assert.equal(first.defaultEnvironmentId, v2.defaultEnvironmentId);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { initializeV2Database } from '../../src/v2/db.js';
import {
  nextLegacyId,
  reserveLegacyId,
} from '../../src/v2/repositories/legacy-ids.js';
import { createProjectRepository } from '../../src/v2/repositories/projects.js';

test('reserving a lower legacy id never lowers the project sequence', async (t) => {
  const v2 = await initializeV2Database();

  t.after(() => v2.destroy());

  const projects = createProjectRepository(v2.db);
  const project = await projects.createProject({
    key: 'legacy-seq',
    name: 'Legacy sequence',
  });

  const reservedTen = await v2.db.transaction().execute(
    (trx) => reserveLegacyId(trx, project.id, 10),
  );
  const reservedSeven = await v2.db.transaction().execute(
    (trx) => reserveLegacyId(trx, project.id, 7),
  );
  const next = await v2.db.transaction().execute(
    (trx) => nextLegacyId(trx, project.id),
  );

  assert.equal(reservedTen, 10);
  assert.equal(reservedSeven, 7);
  assert.equal(next, 11);
});

test('nextLegacyId keeps incrementing after a deletion', async (t) => {
  const v2 = await initializeV2Database();

  t.after(() => v2.destroy());

  const projects = createProjectRepository(v2.db);
  const project = await projects.createProject({
    key: 'legacy-delete',
    name: 'Legacy delete',
  });

  const first = await v2.db.transaction().execute(
    (trx) => nextLegacyId(trx, project.id),
  );
  const second = await v2.db.transaction().execute(
    (trx) => nextLegacyId(trx, project.id),
  );
  const third = await v2.db.transaction().execute(
    (trx) => nextLegacyId(trx, project.id),
  );

  assert.deepEqual([first, second, third], [1, 2, 3]);
});

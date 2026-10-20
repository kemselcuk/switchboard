import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEnvironment,
  createFlag,
  createProject,
  createV2App,
} from './helpers.js';

test('database rejects invalid flag config values', async (t) => {
  const { app, v2 } = await createV2App(t);
  await createProject(app, 'demo');
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production');

  await assert.rejects(() => v2.db
    .updateTable('flag_configs')
    .set({ enabled: 2 })
    .execute());

  await assert.rejects(() => v2.db
    .updateTable('flag_configs')
    .set({ rollout_basis_points: 100001 })
    .execute());

  await v2.db
    .updateTable('flag_configs')
    .set({ enabled: 1, rollout_basis_points: 100000 })
    .execute();
});

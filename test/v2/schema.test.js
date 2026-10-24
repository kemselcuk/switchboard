import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  AUTHORIZATION,
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

test('database enforces exactly one targeting source per rule', async (t) => {
  const { app, v2 } = await createV2App(t);

  await createProject(app, 'demo');
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production', { key: 'checkout' });

  const segment = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/demo/segments',
    headers: AUTHORIZATION,
    payload: {
      key: 'beta-users',
      name: 'Beta users',
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
    },
  });

  assert.equal(segment.statusCode, 201);

  const segmentRow = await v2.db
    .selectFrom('segments')
    .select('id')
    .where('key', '=', 'beta-users')
    .executeTakeFirstOrThrow();
  const flag = await v2.db
    .selectFrom('flags')
    .select('id')
    .where('key', '=', 'checkout')
    .executeTakeFirstOrThrow();
  const environment = await v2.db
    .selectFrom('environments')
    .select('id')
    .where('key', '=', 'production')
    .executeTakeFirstOrThrow();
  const now = new Date().toISOString();
  const base = {
    flag_id: flag.id,
    environment_id: environment.id,
    position: 0,
    action: 'on',
    created_at: now,
    updated_at: now,
  };

  await assert.rejects(() => v2.db
    .insertInto('flag_rules')
    .values({
      ...base,
      id: randomUUID(),
      segment_id: null,
      conditions: null,
    })
    .execute());

  await assert.rejects(() => v2.db
    .insertInto('flag_rules')
    .values({
      ...base,
      id: randomUUID(),
      segment_id: segmentRow.id,
      conditions: '[]',
    })
    .execute());

  await assert.rejects(() => v2.db
    .insertInto('flag_rules')
    .values({
      ...base,
      id: randomUUID(),
      segment_id: null,
      conditions: '[]',
      action: 'sideways',
    })
    .execute());

  await assert.rejects(() => v2.db
    .insertInto('flag_rules')
    .values({
      ...base,
      id: randomUUID(),
      position: -1,
      segment_id: null,
      conditions: '[]',
    })
    .execute());

  await v2.db
    .insertInto('flag_rules')
    .values({
      ...base,
      id: randomUUID(),
      segment_id: null,
      conditions: '[]',
    })
    .execute();

  await assert.rejects(() => v2.db
    .insertInto('flag_rules')
    .values({
      ...base,
      id: randomUUID(),
      segment_id: null,
      conditions: '[]',
    })
    .execute());
});

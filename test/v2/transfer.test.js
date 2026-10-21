import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../../src/app.js';
import { initializeV2Database } from '../../src/v2/db.js';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportConfiguration,
  importConfiguration,
} from '../../src/v2/repositories/transfer.js';
import {
  ADMIN_TOKEN,
  AUTHORIZATION,
  createApiKey,
  createEnvironment,
  createFlag,
  createProject,
  createV2App,
} from './helpers.js';

async function createTarget(t) {
  const v2 = await initializeV2Database();
  const app = buildApp({ v2, adminToken: ADMIN_TOKEN });

  t.after(() => app.close());

  return { app, v2 };
}

async function seedSource(t) {
  const { app, v2 } = await createV2App(t);

  await createProject(app, 'demo', 'Demo');
  await createEnvironment(app, 'demo', 'production', 'Production');
  await createEnvironment(app, 'demo', 'staging', 'Staging');
  await createFlag(app, 'demo', 'production', {
    key: 'new-checkout',
    description: 'New checkout',
    enabled: true,
    rolloutPercentage: 40,
  });
  await createFlag(app, 'demo', 'staging', {
    key: 'new-checkout',
    description: 'New checkout',
    enabled: false,
    rolloutPercentage: 5,
  });
  await createFlag(app, 'demo', 'production', {
    key: 'second-flag',
    description: 'Second flag',
    enabled: false,
    rolloutPercentage: 12.5,
  });
  const sourceKey = await createApiKey(app, 'demo', 'production', 'source key');

  return { app, v2, sourceKey };
}

function invalidExport(message) {
  return (error) => error?.statusCode === 400
    && error?.code === 'INVALID_EXPORT'
    && String(error.message).includes(message);
}

test('exports projects, environments, flags and configs without secrets', async (t) => {
  const { v2 } = await seedSource(t);
  const data = await exportConfiguration(v2.db);

  assert.equal(data.format, EXPORT_FORMAT);
  assert.equal(data.version, EXPORT_VERSION);
  assert.equal(typeof data.exportedAt, 'string');

  const demo = data.projects.find((project) => project.key === 'demo');
  assert.ok(demo);
  assert.deepEqual(
    demo.environments.map((environment) => environment.key).sort(),
    ['production', 'staging'],
  );

  const production = demo.environments.find((entry) => entry.key === 'production');
  assert.deepEqual(
    production.flags
      .map((flag) => [flag.key, flag.enabled, flag.rolloutPercentage])
      .sort(([left], [right]) => left.localeCompare(right)),
    [
      ['new-checkout', true, 40],
      ['second-flag', false, 12.5],
    ],
  );

  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes('api_keys'), false);
  assert.equal(serialized.includes('sb_srv_'), false);
  assert.equal(serialized.includes('prefix'), false);
  assert.equal(serialized.includes('hash'), false);
  assert.equal(serialized.includes('"id"'), false);
  assert.equal(serialized.includes('legacy_id'), false);
  assert.equal(serialized.includes('flag_id'), false);
  assert.equal(serialized.includes('project_id'), false);
  assert.equal(serialized.includes('environment_id'), false);
});

test('round-trips typed flags through export and import', async (t) => {
  const { app: sourceApp, v2: source } = await createV2App(t);

  await createProject(sourceApp, 'typed', 'Typed');
  await createEnvironment(sourceApp, 'typed');
  await createFlag(sourceApp, 'typed', 'production', {
    key: 'greeting',
    type: 'string',
    description: 'Greeting',
    onValue: 'hello',
    offValue: 'goodbye',
    enabled: true,
    rolloutPercentage: 100,
  });
  await createFlag(sourceApp, 'typed', 'production', {
    key: 'ratio',
    type: 'number',
    onValue: 1.25,
    offValue: 0.5,
    enabled: true,
    rolloutPercentage: 50,
  });
  await createFlag(sourceApp, 'typed', 'production', {
    key: 'theme',
    type: 'json',
    onValue: { name: 'dark', columns: 3 },
    offValue: { name: 'light', columns: 1 },
    enabled: false,
    rolloutPercentage: 0,
  });
  await createFlag(sourceApp, 'typed', 'production', {
    key: 'classic',
    enabled: true,
    rolloutPercentage: 25,
  });

  const data = await exportConfiguration(source.db);
  const typed = data.projects.find((project) => project.key === 'typed');
  const exported = Object.fromEntries(
    typed.environments[0].flags.map((flag) => [flag.key, flag]),
  );

  assert.equal(exported.greeting.type, 'string');
  assert.equal(exported.greeting.onValue, 'hello');
  assert.equal(exported.greeting.offValue, 'goodbye');
  assert.equal(exported.ratio.type, 'number');
  assert.equal(exported.ratio.onValue, 1.25);
  assert.deepEqual(exported.theme.onValue, { name: 'dark', columns: 3 });
  assert.deepEqual(exported.theme.offValue, { name: 'light', columns: 1 });
  assert.equal(exported.classic.type, 'boolean');
  assert.equal('onValue' in exported.classic, false);
  assert.equal('offValue' in exported.classic, false);

  const { app, v2 } = await createTarget(t);
  const summary = await importConfiguration(v2.db, data);

  assert.equal(summary.flagsCreated, 4);
  assert.equal(summary.configsCreated, 4);

  const expected = {
    greeting: ['string', 'hello', 'goodbye'],
    ratio: ['number', 1.25, 0.5],
  };

  for (const [key, [type, onValue, offValue]] of Object.entries(expected)) {
    const flag = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/typed/environments/production/flags/${key}`,
      headers: AUTHORIZATION,
    });

    assert.equal(flag.statusCode, 200);
    assert.equal(flag.json().type, type);
    assert.equal(flag.json().onValue, onValue);
    assert.equal(flag.json().offValue, offValue);
  }

  const theme = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/typed/environments/production/flags/theme',
    headers: AUTHORIZATION,
  });
  assert.equal(theme.statusCode, 200);
  assert.deepEqual(theme.json().onValue, { name: 'dark', columns: 3 });
  assert.deepEqual(theme.json().offValue, { name: 'light', columns: 1 });

  const classic = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/typed/environments/production/flags/classic',
    headers: AUTHORIZATION,
  });
  assert.equal(classic.statusCode, 200);
  assert.equal(classic.json().type, 'boolean');
  assert.equal(classic.json().enabled, true);
  assert.equal(classic.json().rolloutPercentage, 25);
  assert.equal('onValue' in classic.json(), false);

  const key = await createApiKey(app, 'typed', 'production');
  const evaluation = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/greeting',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(evaluation.statusCode, 200);
  assert.equal(evaluation.json().value, 'hello');

  const jsonEvaluation = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/theme',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(jsonEvaluation.statusCode, 200);
  assert.deepEqual(jsonEvaluation.json().value, { name: 'light', columns: 1 });
  assert.equal(jsonEvaluation.json().reason, 'DISABLED');
});

test('rejects invalid typed values and type changes during import', async (t) => {
  const { v2 } = await createTarget(t);

  function typedExport(flag) {
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      projects: [{
        key: 'typed',
        name: 'Typed',
        environments: [{
          key: 'production',
          name: 'Production',
          flags: [{
            key: 'typed-flag',
            type: 'string',
            description: '',
            enabled: true,
            rolloutPercentage: 100,
            onValue: 'on',
            offValue: 'off',
            ...flag,
          }],
        }],
      }],
    };
  }

  const invalidVariants = [
    [typedExport({ offValue: undefined }), 'onValue and offValue are required'],
    [typedExport({ type: 'number', onValue: '1' }), 'finite number'],
    [typedExport({ type: 'json', onValue: [] }), 'plain JSON object'],
    [typedExport({ type: 'json', onValue: { data: 'x'.repeat(8200) } }), '8192'],
    [typedExport({ onValue: 'a'.repeat(4097) }), '4096'],
    [typedExport({ type: 'date' }), 'type must be one of'],
    [
      typedExport({ type: 'boolean' }),
      'not allowed for boolean flags',
    ],
  ];

  for (const [data, message] of invalidVariants) {
    await assert.rejects(
      () => importConfiguration(v2.db, data),
      invalidExport(message),
    );
  }

  const { app: sourceApp, v2: source } = await createV2App(t);
  await createProject(sourceApp, 'typed', 'Typed');
  await createEnvironment(sourceApp, 'typed');
  await createFlag(sourceApp, 'typed', 'production', {
    key: 'typed-flag',
    enabled: true,
    rolloutPercentage: 100,
  });
  const booleanExport = await exportConfiguration(source.db);

  await importConfiguration(v2.db, booleanExport);

  const changed = structuredClone(booleanExport);
  const changedProject = changed.projects.find(
    (project) => project.key === 'typed',
  );
  const changedFlag = changedProject.environments[0].flags.find(
    (flag) => flag.key === 'typed-flag',
  );
  changedFlag.type = 'string';
  changedFlag.onValue = 'on';
  changedFlag.offValue = 'off';

  await assert.rejects(
    () => importConfiguration(v2.db, changed),
    invalidExport('does not match existing type boolean'),
  );

  const stored = await v2.db
    .selectFrom('flags')
    .select('type')
    .where('key', '=', 'typed-flag')
    .executeTakeFirst();

  assert.equal(stored.type, 'boolean');
});

test('round-trips into a fresh database with new IDs and matching values', async (t) => {
  const { app: sourceApp, v2: source, sourceKey } = await seedSource(t);
  const data = await exportConfiguration(source.db);
  const sourceFlag = await source.db
    .selectFrom('flags')
    .select('id')
    .where('key', '=', 'new-checkout')
    .executeTakeFirst();

  const { app, v2 } = await createTarget(t);
  const summary = await importConfiguration(v2.db, data);

  assert.equal(summary.projectsCreated, 1);
  assert.equal(summary.environmentsCreated, 2);
  assert.equal(summary.flagsCreated, 2);
  assert.equal(summary.configsCreated, 3);

  const production = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags/new-checkout',
    headers: AUTHORIZATION,
  });
  const staging = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/staging/flags/new-checkout',
    headers: AUTHORIZATION,
  });

  assert.equal(production.statusCode, 200);
  assert.equal(production.json().enabled, true);
  assert.equal(production.json().rolloutPercentage, 40);
  assert.equal(production.json().description, 'New checkout');
  assert.equal(staging.statusCode, 200);
  assert.equal(staging.json().enabled, false);
  assert.equal(staging.json().rolloutPercentage, 5);

  const projects = await app.inject({
    method: 'GET',
    url: '/api/v1/projects',
    headers: AUTHORIZATION,
  });
  const environments = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments',
    headers: AUTHORIZATION,
  });

  assert.equal(
    projects.json().projects.find((entry) => entry.key === 'demo').name,
    'Demo',
  );
  assert.deepEqual(
    environments.json().environments
      .map((entry) => [entry.key, entry.name])
      .sort(([left], [right]) => left.localeCompare(right)),
    [['production', 'Production'], ['staging', 'Staging']],
  );

  const targetKey = await createApiKey(app, 'demo', 'production', 'target key');

  for (const userId of ['user-1', 'user-2', 'user-3', 'user-4', 'user-5']) {
    const sourceEvaluation = await sourceApp.inject({
      method: 'POST',
      url: '/ofrep/v1/evaluate/flags/new-checkout',
      headers: { 'x-api-key': sourceKey.key },
      payload: { context: { targetingKey: userId } },
    });
    const targetEvaluation = await app.inject({
      method: 'POST',
      url: '/ofrep/v1/evaluate/flags/new-checkout',
      headers: { 'x-api-key': targetKey.key },
      payload: { context: { targetingKey: userId } },
    });

    assert.equal(targetEvaluation.statusCode, 200);
    assert.equal(targetEvaluation.json().value, sourceEvaluation.json().value);
    assert.equal(targetEvaluation.json().reason, sourceEvaluation.json().reason);
  }

  const targetFlag = await v2.db
    .selectFrom('flags')
    .select('id')
    .where('key', '=', 'new-checkout')
    .executeTakeFirst();

  assert.notEqual(targetFlag.id, sourceFlag.id);
});

test('is idempotent on a second import', async (t) => {
  const { v2: source } = await seedSource(t);
  const data = await exportConfiguration(source.db);
  const { v2 } = await createTarget(t);

  await importConfiguration(v2.db, data);
  const second = await importConfiguration(v2.db, data);

  assert.equal(second.projectsCreated, 0);
  assert.equal(second.environmentsCreated, 0);
  assert.equal(second.flagsCreated, 0);
  assert.equal(second.flagsUpdated, 0);
  assert.equal(second.configsCreated, 0);
  assert.equal(second.configsUpdated, 0);
  assert.equal(second.totalFlags, 3);
  assert.equal(second.totalConfigs, 3);
});

test('applies changed descriptions and configs from a new export', async (t) => {
  const { app, v2: source } = await seedSource(t);
  const initial = await exportConfiguration(source.db);

  await app.inject({
    method: 'PATCH',
    url: '/api/v1/projects/demo/environments/production/flags/new-checkout',
    headers: AUTHORIZATION,
    payload: {
      description: 'Changed description',
      enabled: false,
      rolloutPercentage: 12.5,
    },
  });
  const changed = await exportConfiguration(source.db);
  const { app: targetApp, v2 } = await createTarget(t);

  await importConfiguration(v2.db, initial);
  const summary = await importConfiguration(v2.db, changed);

  assert.equal(summary.configsUpdated, 1);
  assert.equal(summary.flagsUpdated, 1);

  const flag = await targetApp.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags/new-checkout',
    headers: AUTHORIZATION,
  });

  assert.equal(flag.json().enabled, false);
  assert.equal(flag.json().rolloutPercentage, 12.5);
  assert.equal(flag.json().description, 'Changed description');
});

test('is additive: keeps unrelated projects/flags and does not rename existing ones', async (t) => {
  const { v2: source } = await seedSource(t);
  const data = await exportConfiguration(source.db);
  const { app, v2 } = await createTarget(t);

  await createProject(app, 'demo', 'Target Demo');
  await createEnvironment(app, 'demo', 'production', 'Target Production');
  await createFlag(app, 'demo', 'production', {
    key: 'keep-me',
    description: 'Must stay',
    enabled: true,
    rolloutPercentage: 100,
  });
  await createProject(app, 'unrelated', 'Unrelated');
  await createEnvironment(app, 'unrelated', 'production', 'Production');
  await createFlag(app, 'unrelated', 'production', {
    key: 'unrelated-flag',
    enabled: false,
    rolloutPercentage: 0,
  });

  const summary = await importConfiguration(v2.db, data);
  assert.ok(summary.flagsCreated >= 2);

  const projects = await app.inject({
    method: 'GET',
    url: '/api/v1/projects',
    headers: AUTHORIZATION,
  });
  const demo = projects.json().projects.find((project) => project.key === 'demo');
  const unrelated = projects.json().projects.find(
    (project) => project.key === 'unrelated',
  );

  assert.equal(demo.name, 'Target Demo');
  assert.ok(unrelated);

  const environments = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments',
    headers: AUTHORIZATION,
  });
  const production = environments.json().environments.find(
    (environment) => environment.key === 'production',
  );

  assert.equal(production.name, 'Target Production');

  const keepMe = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags/keep-me',
    headers: AUTHORIZATION,
  });
  const unrelatedFlag = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/unrelated/environments/production/flags/unrelated-flag',
    headers: AUTHORIZATION,
  });

  assert.equal(keepMe.statusCode, 200);
  assert.equal(keepMe.json().enabled, true);
  assert.equal(keepMe.json().rolloutPercentage, 100);
  assert.equal(unrelatedFlag.statusCode, 200);
  assert.equal(unrelatedFlag.json().enabled, false);
  assert.equal(unrelatedFlag.json().rolloutPercentage, 0);

  const newCheckout = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags/new-checkout',
    headers: AUTHORIZATION,
  });
  assert.equal(newCheckout.statusCode, 200);
});

test('dry run reports changes without writing anything', async (t) => {
  const { v2: source } = await seedSource(t);
  const data = await exportConfiguration(source.db);
  const { v2 } = await createTarget(t);
  const summary = await importConfiguration(v2.db, data, { dryRun: true });

  assert.equal(summary.projectsCreated, 1);
  assert.equal(summary.configsCreated, 3);

  const projects = await v2.db
    .selectFrom('projects')
    .select('key')
    .execute();

  assert.deepEqual(projects.map((project) => project.key), ['default']);
});

test('rejects invalid exports without partial writes', async (t) => {
  const { v2: source } = await seedSource(t);
  const valid = await exportConfiguration(source.db);
  const { v2 } = await createTarget(t);

  const demo = valid.projects.find((project) => project.key === 'demo');
  const production = demo.environments.find(
    (environment) => environment.key === 'production',
  );
  const baseFlag = production.flags[0];
  const withDemo = (project) => ({ ...valid, projects: [project] });

  const variants = [
    [{ ...valid, format: 'other' }, 'Unsupported format'],
    [{ ...valid, version: 2 }, 'Unsupported version'],
    [withDemo({
      ...demo,
      environments: [{
        ...production,
        flags: [{ ...baseFlag, type: 'string' }],
      }],
    }), 'required'],
    [withDemo({ ...demo, key: 'INVALID KEY' }), 'project.key'],
    [withDemo({
      ...demo,
      environments: [{
        ...production,
        flags: [{ ...baseFlag, rolloutPercentage: 100.001 }],
      }],
    }), 'between 0 and 100'],
    [withDemo({
      ...demo,
      environments: [{
        ...production,
        flags: [{ ...baseFlag, rolloutPercentage: 12.3456 }],
      }],
    }), 'three decimal'],
  ];

  for (const [data, message] of variants) {
    await assert.rejects(
      () => importConfiguration(v2.db, data),
      invalidExport(message),
    );
  }

  const partial = {
    ...valid,
    projects: [{
      key: 'partial-demo',
      name: 'Partial',
      environments: [{
        key: 'production',
        name: 'Production',
        flags: [{
          key: 'INVALID KEY',
          type: 'boolean',
          description: '',
          enabled: true,
          rolloutPercentage: 0,
        }],
      }],
    }],
  };

  await assert.rejects(
    () => importConfiguration(v2.db, partial),
    invalidExport('flag.key'),
  );

  const projects = await v2.db.selectFrom('projects').select('key').execute();
  assert.deepEqual(projects.map((project) => project.key), ['default']);
});

test('never touches existing API keys', async (t) => {
  const { v2: source } = await seedSource(t);
  const data = await exportConfiguration(source.db);
  const { app, v2 } = await createTarget(t);

  await createProject(app, 'demo', 'Demo');
  await createEnvironment(app, 'demo', 'production', 'Production');
  const key = await createApiKey(app, 'demo', 'production', 'target key');
  const before = await v2.db
    .selectFrom('api_keys')
    .selectAll()
    .execute();

  await importConfiguration(v2.db, data);

  const after = await v2.db
    .selectFrom('api_keys')
    .selectAll()
    .execute();
  assert.deepEqual(after, before);

  const evaluation = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/new-checkout',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(evaluation.statusCode, 200);
});

test('assigns per-project numeric legacy ids to imported flags', async (t) => {
  const { v2: source } = await seedSource(t);
  const data = await exportConfiguration(source.db);
  const { v2 } = await createTarget(t);

  await importConfiguration(v2.db, data);

  const demo = await v2.db
    .selectFrom('projects')
    .select('id')
    .where('key', '=', 'demo')
    .executeTakeFirst();
  const flags = await v2.db
    .selectFrom('flags')
    .select(['key', 'legacy_id'])
    .where('project_id', '=', demo.id)
    .orderBy('legacy_id', 'asc')
    .execute();

  assert.deepEqual(
    flags.map((flag) => [flag.key, flag.legacy_id]),
    [['new-checkout', 1], ['second-flag', 2]],
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateFlag } from '../../src/v2/evaluator.js';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportConfiguration,
  importConfiguration,
} from '../../src/v2/repositories/transfer.js';
import {
  AUTHORIZATION,
  createApiKey,
  createEnvironment,
  createFlag,
  createProject,
  createV2App,
} from './helpers.js';

async function setup(t) {
  const { app, v2 } = await createV2App(t);

  await createProject(app, 'demo', 'Demo');
  await createEnvironment(app, 'demo', 'production', 'Production');
  const key = await createApiKey(app, 'demo', 'production');

  return { app, v2, key: key.key };
}

function createSegment(app, payload, project = 'demo') {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${project}/segments`,
    headers: AUTHORIZATION,
    payload,
  });
}

function getSegment(app, key, project = 'demo') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/projects/${project}/segments/${key}`,
    headers: AUTHORIZATION,
  });
}

function putRules(
  app,
  flagKey,
  rules,
  environment = 'production',
  project = 'demo',
) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/projects/${project}/environments/${environment}/flags/${flagKey}/rules`,
    headers: AUTHORIZATION,
    payload: { rules },
  });
}

function getRules(app, flagKey, environment = 'production', project = 'demo') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/projects/${project}/environments/${environment}/flags/${flagKey}/rules`,
    headers: AUTHORIZATION,
  });
}

function evaluate(app, key, flagKey, context) {
  return app.inject({
    method: 'POST',
    url: `/ofrep/v1/evaluate/flags/${flagKey}`,
    headers: { 'x-api-key': key },
    payload: { context },
  });
}

function evaluateBulk(app, key, context, etag) {
  return app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: {
      'x-api-key': key,
      ...(etag ? { 'if-none-match': etag } : {}),
    },
    payload: { context },
  });
}

const beta = {
  key: 'beta-users',
  name: 'Beta users',
  conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
};

test('creates, lists, reads, updates and deletes segments', async (t) => {
  const { app } = await setup(t);

  const created = await createSegment(app, beta);

  assert.equal(created.statusCode, 201);
  assert.equal(created.json().key, 'beta-users');
  assert.equal(created.json().name, 'Beta users');
  assert.deepEqual(created.json().conditions, beta.conditions);
  assert.equal(typeof created.json().createdAt, 'string');

  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/segments',
    headers: AUTHORIZATION,
  });

  assert.equal(list.statusCode, 200);
  assert.equal(list.json().segments.length, 1);

  const updated = await app.inject({
    method: 'PUT',
    url: '/api/v1/projects/demo/segments/beta-users',
    headers: AUTHORIZATION,
    payload: {
      name: 'Beta testers',
      conditions: [
        { attribute: 'plan', operator: 'eq', value: 'beta' },
        { attribute: 'country', operator: 'eq', value: 'NL' },
      ],
    },
  });

  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().key, 'beta-users');
  assert.equal(updated.json().name, 'Beta testers');
  assert.equal(updated.json().conditions.length, 2);

  const read = await getSegment(app, 'beta-users');
  assert.deepEqual(read.json().conditions, updated.json().conditions);

  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/segments/beta-users',
    headers: AUTHORIZATION,
  });

  assert.deepEqual(removed.json(), { key: 'beta-users', deleted: true });
  assert.equal((await getSegment(app, 'beta-users')).statusCode, 404);
});

test('rejects duplicate segment keys and keeps keys immutable', async (t) => {
  const { app } = await setup(t);

  assert.equal((await createSegment(app, beta)).statusCode, 201);

  const duplicate = await createSegment(app, beta);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'SEGMENT_EXISTS');

  const rename = await app.inject({
    method: 'PUT',
    url: '/api/v1/projects/demo/segments/beta-users',
    headers: AUTHORIZATION,
    payload: {
      key: 'renamed',
      name: 'Renamed',
      conditions: beta.conditions,
    },
  });

  assert.equal(rename.statusCode, 400);
  assert.equal(rename.json().error.code, 'VALIDATION_ERROR');
  assert.equal((await getSegment(app, 'renamed')).statusCode, 404);

  await createProject(app, 'other', 'Other');
  assert.equal((await createSegment(app, beta, 'other')).statusCode, 201);
});

test('validates segment conditions', async (t) => {
  const { app } = await setup(t);
  const invalidBodies = [
    [{ key: 'not-array', name: 'Not array', conditions: 'plan' }, 'array'],
    [{
      key: 'many',
      name: 'Many',
      conditions: Array.from({ length: 21 }, () => ({
        attribute: 'plan',
        operator: 'eq',
        value: 'beta',
      })),
    }, 'more than 20'],
    [{
      key: 'operator',
      name: 'Operator',
      conditions: [{ attribute: 'plan', operator: 'in', value: 'beta' }],
    }, 'operator'],
    [{
      key: 'null',
      name: 'Null',
      conditions: [{ attribute: 'plan', operator: 'eq', value: null }],
    }, 'value'],
    [{
      key: 'object',
      name: 'Object',
      conditions: [{ attribute: 'plan', operator: 'eq', value: { tier: 1 } }],
    }, 'value'],
    [{
      key: 'long-value',
      name: 'Long value',
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'x'.repeat(257) }],
    }, '256'],
    [{
      key: 'long-attribute',
      name: 'Long attribute',
      conditions: [{
        attribute: 'a'.repeat(65),
        operator: 'eq',
        value: true,
      }],
    }, '64'],
  ];

  for (const [payload, message] of invalidBodies) {
    const response = await createSegment(app, payload);

    assert.equal(response.statusCode, 400, payload.key);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
    assert.match(response.json().error.message, new RegExp(message));
  }

  const primitives = await createSegment(app, {
    key: 'primitives',
    name: 'Primitives',
    conditions: [
      { attribute: 'plan', operator: 'eq', value: 'beta' },
      { attribute: 'age', operator: 'eq', value: 30 },
      { attribute: 'staff', operator: 'eq', value: true },
    ],
  });

  assert.equal(primitives.statusCode, 201);
});

test('empty conditions match every context', async (t) => {
  const { app, key } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 100,
  });
  const segment = await createSegment(app, {
    key: 'everyone',
    name: 'Everyone',
    conditions: [],
  });

  assert.equal(segment.statusCode, 201);
  assert.deepEqual(segment.json().conditions, []);

  await putRules(app, 'checkout', [
    { segmentKey: 'everyone', action: 'off' },
  ]);

  const response = await evaluate(app, key, 'checkout', {
    targetingKey: 'user-1',
  });

  assert.equal(response.json().value, false);
  assert.equal(response.json().reason, 'TARGETING_MATCH');
  assert.equal(response.json().variant, 'off');

  const inline = await putRules(app, 'checkout', [
    { conditions: [], action: 'on' },
  ]);
  assert.equal(inline.statusCode, 200);

  const second = await evaluate(app, key, 'checkout', {
    targetingKey: 'user-1',
  });
  assert.equal(second.json().value, true);
  assert.equal(second.json().reason, 'TARGETING_MATCH');
});

test('blocks deleting a segment while rules reference it', async (t) => {
  const { app } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });
  await createSegment(app, beta);
  assert.equal((await putRules(app, 'checkout', [
    { segmentKey: 'beta-users', action: 'on' },
  ])).statusCode, 200);

  const blocked = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/segments/beta-users',
    headers: AUTHORIZATION,
  });

  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error.code, 'SEGMENT_IN_USE');

  assert.deepEqual((await putRules(app, 'checkout', [])).json(), { rules: [] });

  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/segments/beta-users',
    headers: AUTHORIZATION,
  });

  assert.equal(removed.statusCode, 200);
});

test('replaces ordered rules and clears them with an empty list', async (t) => {
  const { app } = await setup(t);
  const inlineRule = {
    conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
    action: 'off',
  };
  const segmentRule = { segmentKey: 'beta-users', action: 'on' };

  await createFlag(app, 'demo', 'production', { key: 'checkout' });
  await createSegment(app, beta);

  const first = await putRules(app, 'checkout', [segmentRule, inlineRule]);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json().rules, [segmentRule, inlineRule]);

  const updated = await putRules(app, 'checkout', [inlineRule, segmentRule]);
  assert.deepEqual(updated.json().rules, [inlineRule, segmentRule]);
  assert.deepEqual((await getRules(app, 'checkout')).json().rules, [
    inlineRule,
    segmentRule,
  ]);

  const cleared = await putRules(app, 'checkout', []);
  assert.deepEqual(cleared.json().rules, []);
  assert.deepEqual((await getRules(app, 'checkout')).json().rules, []);
});

test('validates rules and segment references', async (t) => {
  const { app } = await setup(t);

  await createFlag(app, 'demo', 'production', { key: 'checkout' });

  const invalidRules = [
    [[{
      segmentKey: 'beta-users',
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
      action: 'on',
    }], 'exactly one'],
    [[{ action: 'on' }], 'exactly one'],
    [[{ conditions: beta.conditions, action: 'sideways' }], 'action'],
    [Array.from({ length: 51 }, () => ({ conditions: beta.conditions, action: 'on' })), 'more than 50'],
    [[{ segmentKey: 'missing', action: 'on' }], 'not found'],
  ];

  for (const [rules, message] of invalidRules) {
    const response = await putRules(app, 'checkout', rules);

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
    assert.match(response.json().error.message, new RegExp(message));
  }

  await createProject(app, 'other', 'Other');
  await createSegment(app, beta, 'other');

  const foreign = await putRules(app, 'checkout', [
    { segmentKey: 'beta-users', action: 'on' },
  ]);

  assert.equal(foreign.statusCode, 400);
  assert.match(foreign.json().error.message, /not found in this project/);

  await createEnvironment(app, 'other', 'production', 'Production');
  await createFlag(app, 'other', 'production', { key: 'other-flag' });
  assert.equal((await putRules(
    app,
    'other-flag',
    [{ segmentKey: 'beta-users', action: 'on' }],
    'production',
    'other',
  )).statusCode, 200);
});

test('deleting a flag cascades its rules', async (t) => {
  const { app, v2 } = await setup(t);

  await createFlag(app, 'demo', 'production', { key: 'checkout' });
  await createSegment(app, beta);
  await putRules(app, 'checkout', [{ segmentKey: 'beta-users', action: 'on' }]);

  const deleted = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/flags/checkout',
    headers: AUTHORIZATION,
  });

  assert.equal(deleted.statusCode, 200);
  assert.equal((await getRules(app, 'checkout')).statusCode, 404);

  const rules = await v2.db.selectFrom('flag_rules').selectAll().execute();
  assert.deepEqual(rules, []);

  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/segments/beta-users',
    headers: AUTHORIZATION,
  });

  assert.equal(removed.statusCode, 200);
});

test('evaluates the first matching rule with ANDed conditions', async (t) => {
  const { app, key } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });
  await createSegment(app, {
    key: 'beta-nl',
    name: 'Beta NL',
    conditions: [
      { attribute: 'plan', operator: 'eq', value: 'beta' },
      { attribute: 'country', operator: 'eq', value: 'NL' },
    ],
  });
  await putRules(app, 'checkout', [
    { segmentKey: 'beta-nl', action: 'off' },
    {
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
      action: 'on',
    },
  ]);

  const first = await evaluate(app, key, 'checkout', {
    targetingKey: 'user-1',
    plan: 'beta',
    country: 'NL',
  });
  assert.equal(first.json().value, false);
  assert.equal(first.json().reason, 'TARGETING_MATCH');
  assert.equal(first.json().variant, 'off');

  const second = await evaluate(app, key, 'checkout', {
    targetingKey: 'user-1',
    plan: 'beta',
    country: 'US',
  });
  assert.equal(second.json().value, true);
  assert.equal(second.json().reason, 'TARGETING_MATCH');
  assert.equal(second.json().variant, 'on');

  const fallback = await evaluate(app, key, 'checkout', {
    targetingKey: 'user-1',
    plan: 'free',
    country: 'NL',
  });
  assert.equal(fallback.json().value, false);
  assert.equal(fallback.json().reason, 'SPLIT');
});

test('uses strict typed equality and ignores missing attributes', async (t) => {
  const { app, key } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });
  await putRules(app, 'checkout', [
    {
      conditions: [
        { attribute: 'age', operator: 'eq', value: 30 },
        { attribute: 'staff', operator: 'eq', value: true },
      ],
      action: 'on',
    },
  ]);

  const exact = await evaluate(app, key, 'checkout', {
    targetingKey: 'user-1',
    age: 30,
    staff: true,
  });
  assert.equal(exact.json().reason, 'TARGETING_MATCH');
  assert.equal(exact.json().value, true);

  for (const context of [
    { targetingKey: 'user-1', age: '30', staff: true },
    { targetingKey: 'user-1', age: 30, staff: 'true' },
    { targetingKey: 'user-1', staff: true },
    { targetingKey: 'user-1', age: 30 },
  ]) {
    const response = await evaluate(app, key, 'checkout', context);

    assert.equal(response.json().reason, 'SPLIT', JSON.stringify(context));
    assert.equal(response.json().value, false);
  }
});

test('treats targetingKey as a normal string attribute', async (t) => {
  const { app, key } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });
  await putRules(app, 'checkout', [
    {
      conditions: [
        { attribute: 'targetingKey', operator: 'eq', value: 'user-42' },
      ],
      action: 'on',
    },
  ]);

  const matched = await evaluate(app, key, 'checkout', {
    targetingKey: 'user-42',
  });
  assert.equal(matched.json().value, true);
  assert.equal(matched.json().reason, 'TARGETING_MATCH');

  const other = await evaluate(app, key, 'checkout', {
    targetingKey: 'user-43',
  });
  assert.equal(other.json().value, false);
  assert.equal(other.json().reason, 'SPLIT');

  const numeric = await evaluate(app, key, 'checkout', 42);
  assert.equal(numeric.statusCode, 400);
});

test('disabled takes precedence over a matching rule', async (t) => {
  const { app, key } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: false,
    rolloutPercentage: 100,
  });
  await putRules(app, 'checkout', [
    {
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
      action: 'on',
    },
  ]);

  const response = await evaluate(app, key, 'checkout', {
    targetingKey: 'user-1',
    plan: 'beta',
  });

  assert.deepEqual(response.json(), {
    key: 'checkout',
    value: false,
    reason: 'DISABLED',
    variant: 'disabled',
  });
});

test('applies rule on/off to typed flag values', async (t) => {
  const { app, key } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'theme',
    type: 'string',
    onValue: 'dark',
    offValue: 'light',
    enabled: true,
    rolloutPercentage: 100,
  });
  await putRules(app, 'theme', [
    {
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
      action: 'on',
    },
    {
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'free' }],
      action: 'off',
    },
  ]);

  const on = await evaluate(app, key, 'theme', {
    targetingKey: 'user-1',
    plan: 'beta',
  });
  assert.equal(on.json().value, 'dark');
  assert.equal(on.json().reason, 'TARGETING_MATCH');
  assert.equal(on.json().variant, 'on');

  const off = await evaluate(app, key, 'theme', {
    targetingKey: 'user-1',
    plan: 'free',
  });
  assert.equal(off.json().value, 'light');
  assert.equal(off.json().reason, 'TARGETING_MATCH');
  assert.equal(off.json().variant, 'off');

  const fallback = await evaluate(app, key, 'theme', {
    targetingKey: 'user-1',
    plan: 'enterprise',
  });
  assert.equal(fallback.json().value, 'dark');
  assert.equal(fallback.json().reason, 'SPLIT');
});

test('bulk ETag changes on rule and segment edits', async (t) => {
  const { app, key } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });
  await createSegment(app, beta);
  await putRules(app, 'checkout', [
    {
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'free' }],
      action: 'on',
    },
  ]);

  const first = await evaluateBulk(app, key, { targetingKey: 'user-1' });
  assert.equal(first.statusCode, 200);

  const notModified = await evaluateBulk(
    app,
    key,
    { targetingKey: 'user-1' },
    first.headers.etag,
  );
  assert.equal(notModified.statusCode, 304);

  const clearedRules = await putRules(app, 'checkout', [
    { segmentKey: 'beta-users', action: 'on' },
  ]);
  assert.equal(clearedRules.statusCode, 200);

  const afterRuleEdit = await evaluateBulk(app, key, { targetingKey: 'user-1' });
  assert.notEqual(afterRuleEdit.headers.etag, first.headers.etag);

  await app.inject({
    method: 'PUT',
    url: '/api/v1/projects/demo/segments/beta-users',
    headers: AUTHORIZATION,
    payload: {
      name: 'Beta users v2',
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
    },
  });

  const afterSegmentEdit = await evaluateBulk(
    app,
    key,
    { targetingKey: 'user-1' },
  );
  assert.notEqual(afterSegmentEdit.headers.etag, afterRuleEdit.headers.etag);

  await putRules(app, 'checkout', []);
  const afterRuleClear = await evaluateBulk(
    app,
    key,
    { targetingKey: 'user-1' },
  );
  assert.notEqual(afterRuleClear.headers.etag, afterSegmentEdit.headers.etag);

  await app.inject({
    method: 'DELETE',
    url: '/api/v1/projects/demo/segments/beta-users',
    headers: AUTHORIZATION,
  });
  const afterSegmentDelete = await evaluateBulk(
    app,
    key,
    { targetingKey: 'user-1' },
  );
  assert.notEqual(afterSegmentDelete.headers.etag, afterRuleClear.headers.etag);
});

test('bulk evaluation applies rules to each flag', async (t) => {
  const { app, key } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });
  await createFlag(app, 'demo', 'production', {
    key: 'search',
    enabled: true,
    rolloutPercentage: 100,
  });
  await putRules(app, 'checkout', [
    {
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
      action: 'on',
    },
  ]);

  const response = await evaluateBulk(app, key, {
    targetingKey: 'user-1',
    plan: 'beta',
  });
  const byKey = Object.fromEntries(
    response.json().flags.map((flag) => [flag.key, flag]),
  );

  assert.equal(byKey.checkout.value, true);
  assert.equal(byKey.checkout.reason, 'TARGETING_MATCH');
  assert.equal(byKey.search.reason, 'SPLIT');
});

test('exports and imports segments and rules', async (t) => {
  const { app: sourceApp, v2: source } = await createV2App(t);

  await createProject(sourceApp, 'demo', 'Demo');
  await createEnvironment(sourceApp, 'demo');
  await createFlag(sourceApp, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });
  await createSegment(sourceApp, beta);
  await putRules(sourceApp, 'checkout', [
    { segmentKey: 'beta-users', action: 'on' },
    {
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'free' }],
      action: 'off',
    },
  ]);

  const data = await exportConfiguration(source.db);
  const demo = data.projects.find((project) => project.key === 'demo');
  const exportedFlag = demo.environments[0].flags[0];

  assert.deepEqual(demo.segments, [{
    key: 'beta-users',
    name: 'Beta users',
    conditions: beta.conditions,
  }]);
  assert.deepEqual(exportedFlag.rules, [
    { segmentKey: 'beta-users', action: 'on' },
    {
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'free' }],
      action: 'off',
    },
  ]);

  const { app, v2 } = await createV2App(t);
  const summary = await importConfiguration(v2.db, data);

  assert.equal(summary.segmentsCreated, 1);
  assert.equal(summary.rulesCreated, 2);

  const segments = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/segments',
    headers: AUTHORIZATION,
  });
  assert.deepEqual(segments.json().segments[0].conditions, beta.conditions);

  const rules = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags/checkout/rules',
    headers: AUTHORIZATION,
  });
  assert.deepEqual(rules.json().rules, exportedFlag.rules);

  const key = await createApiKey(app, 'demo', 'production');
  const evaluation = await evaluate(app, key.key, 'checkout', {
    targetingKey: 'user-1',
    plan: 'beta',
  });
  assert.equal(evaluation.json().value, true);
  assert.equal(evaluation.json().reason, 'TARGETING_MATCH');

  const second = await importConfiguration(v2.db, data);
  assert.equal(second.segmentsCreated, 0);
  assert.equal(second.segmentsUpdated, 0);
  assert.equal(second.rulesCreated, 0);
  assert.equal(second.rulesReplaced, 0);
});

test('accepts exports without segments or rules', async (t) => {
  const { app, v2 } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });
  await createSegment(app, beta);
  await putRules(app, 'checkout', [
    { segmentKey: 'beta-users', action: 'on' },
  ]);

  const data = await exportConfiguration(v2.db);
  const legacy = structuredClone(data);

  for (const project of legacy.projects) {
    delete project.segments;

    for (const environment of project.environments) {
      for (const flag of environment.flags) {
        delete flag.rules;
      }
    }
  }

  assert.equal(legacy.version, EXPORT_VERSION);
  assert.equal(legacy.format, EXPORT_FORMAT);

  const target = await createV2App(t);
  const summary = await importConfiguration(target.v2.db, legacy);

  assert.equal(summary.flagsCreated, 1);
  assert.equal(summary.segmentsCreated, 0);
  assert.equal(summary.rulesCreated, 0);

  const segments = await target.v2.db
    .selectFrom('segments')
    .selectAll()
    .execute();
  const rules = await target.v2.db
    .selectFrom('flag_rules')
    .selectAll()
    .execute();

  assert.deepEqual(segments, []);
  assert.deepEqual(rules, []);
});

test('rejects invalid segments and rules during import', async (t) => {
  const { v2 } = await setup(t);
  const base = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    projects: [{
      key: 'demo',
      name: 'Demo',
      environments: [{
        key: 'production',
        name: 'Production',
        flags: [{
          key: 'checkout',
          type: 'boolean',
          description: '',
          enabled: true,
          rolloutPercentage: 0,
        }],
      }],
      segments: [],
    }],
  };
  const variants = [
    [{
      ...base,
      projects: [{
        ...base.projects[0],
        segments: [beta, beta],
      }],
    }, 'duplicate segment key'],
    [{
      ...base,
      projects: [{
        ...base.projects[0],
        segments: [{
          ...beta,
          conditions: [{ attribute: 'plan', operator: 'gt', value: 1 }],
        }],
      }],
    }, 'operator'],
    [{
      ...base,
      projects: [{
        ...base.projects[0],
        environments: [{
          ...base.projects[0].environments[0],
          flags: [{
            ...base.projects[0].environments[0].flags[0],
            rules: [{
              segmentKey: 'missing',
              action: 'on',
            }],
          }],
        }],
      }],
    }, 'segment missing not found'],
  ];

  for (const [data, message] of variants) {
    await assert.rejects(
      () => importConfiguration(v2.db, data),
      (error) => error?.code === 'INVALID_EXPORT'
        && String(error.message).includes(message),
    );
  }

  const segments = await v2.db.selectFrom('segments').selectAll().execute();
  assert.deepEqual(segments, []);
});

test('legacy evaluation ignores targeting rules', async (t) => {
  const { app } = await setup(t);

  const created = await app.inject({
    method: 'POST',
    url: '/api/flags',
    headers: AUTHORIZATION,
    payload: {
      key: 'legacy-target',
      enabled: true,
      rolloutPercentage: 100,
    },
  });

  assert.equal(created.statusCode, 201);

  const rules = await app.inject({
    method: 'PUT',
    url: '/api/v1/projects/default/environments/production/flags/legacy-target/rules',
    headers: AUTHORIZATION,
    payload: {
      rules: [{
        conditions: [{
          attribute: 'targetingKey',
          operator: 'eq',
          value: 'user-1',
        }],
        action: 'off',
      }],
    },
  });

  assert.equal(rules.statusCode, 200);

  const evaluation = await app.inject({
    method: 'POST',
    url: '/api/evaluate',
    payload: { flagKey: 'legacy-target', userId: 'user-1' },
  });

  assert.equal(evaluation.statusCode, 200);
  assert.equal(evaluation.json().enabled, true);
  assert.equal(evaluation.json().rolloutPercentage, 100);
});

test('keeps targeting isolated per project and environment', async (t) => {
  const { app, key } = await setup(t);

  await createFlag(app, 'demo', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });
  await putRules(app, 'checkout', [
    {
      conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
      action: 'on',
    },
  ]);

  await createProject(app, 'other', 'Other');
  await createEnvironment(app, 'other', 'production', 'Production');
  await createFlag(app, 'other', 'production', {
    key: 'checkout',
    enabled: true,
    rolloutPercentage: 0,
  });

  const otherRules = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/other/environments/production/flags/checkout/rules',
    headers: AUTHORIZATION,
  });
  assert.deepEqual(otherRules.json().rules, []);

  const otherKey = await createApiKey(app, 'other', 'production');
  const evaluation = await evaluate(app, otherKey.key, 'checkout', {
    targetingKey: 'user-1',
    plan: 'beta',
  });
  assert.equal(evaluation.json().reason, 'SPLIT');
  assert.equal(evaluation.json().value, false);

  const missing = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/other/environments/staging/flags/checkout/rules',
    headers: AUTHORIZATION,
  });
  assert.equal(missing.statusCode, 404);
});

test('the evaluator resolves raw segment references and first match', () => {
  const flag = {
    key: 'checkout',
    enabled: true,
    rolloutBasisPoints: 0,
    rules: [
      { segmentKey: 'beta-users', action: 'off' },
      {
        conditions: [{ attribute: 'plan', operator: 'eq', value: 'beta' }],
        action: 'on',
      },
    ],
  };
  const segments = [{ key: 'beta-users', conditions: beta.conditions }];

  const matched = evaluateFlag({
    projectKey: 'demo',
    flag,
    context: { targetingKey: 'user-1', plan: 'beta' },
    segments,
  });

  assert.deepEqual(matched, {
    value: false,
    reason: 'TARGETING_MATCH',
    variant: 'off',
    bucket: null,
  });

  const missingSegment = evaluateFlag({
    projectKey: 'demo',
    flag: {
      ...flag,
      rules: [{ segmentKey: 'unknown', action: 'on' }],
    },
    context: { targetingKey: 'user-1', plan: 'beta' },
    segments,
  });

  assert.equal(missingSegment.reason, 'SPLIT');
  assert.equal(missingSegment.value, false);
});

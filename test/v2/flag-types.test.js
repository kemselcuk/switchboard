import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHORIZATION,
  createApiKey,
  createEnvironment,
  createFlag,
  createProject,
  createV2App,
} from './helpers.js';

async function setup(t) {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');

  return { app };
}

function createTypedFlag(app, payload, environment = 'production') {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/demo/environments/${environment}/flags`,
    headers: AUTHORIZATION,
    payload,
  });
}

function patchFlag(app, key, payload, environment = 'production') {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/projects/demo/environments/${environment}/flags/${key}`,
    headers: AUTHORIZATION,
    payload,
  });
}

function getFlag(app, key, environment = 'production') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/projects/demo/environments/${environment}/flags/${key}`,
    headers: AUTHORIZATION,
  });
}

function evaluate(app, apiKey, flagKey, userId = 'user-1') {
  return app.inject({
    method: 'POST',
    url: `/ofrep/v1/evaluate/flags/${flagKey}`,
    headers: { 'x-api-key': apiKey },
    payload: { context: { targetingKey: userId } },
  });
}

function evaluateBulk(app, apiKey, userId = 'user-1') {
  return app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: { 'x-api-key': apiKey },
    payload: { context: { targetingKey: userId } },
  });
}

test('creates, reads and lists string, number and json flags', async (t) => {
  const { app } = await setup(t);

  const stringFlag = await createTypedFlag(app, {
    key: 'greeting',
    type: 'string',
    description: 'Greeting text',
    onValue: 'hello',
    offValue: 'goodbye',
    enabled: true,
    rolloutPercentage: 100,
  });

  assert.equal(stringFlag.statusCode, 201);
  assert.equal(stringFlag.json().type, 'string');
  assert.equal(stringFlag.json().onValue, 'hello');
  assert.equal(stringFlag.json().offValue, 'goodbye');

  const numberFlag = await createTypedFlag(app, {
    key: 'max-items',
    type: 'number',
    onValue: 42.5,
    offValue: 10,
    enabled: true,
    rolloutPercentage: 50,
  });

  assert.equal(numberFlag.statusCode, 201);
  assert.equal(numberFlag.json().type, 'number');
  assert.equal(numberFlag.json().onValue, 42.5);
  assert.equal(numberFlag.json().offValue, 10);

  const jsonFlag = await createTypedFlag(app, {
    key: 'theme',
    type: 'json',
    onValue: { name: 'dark', palette: { background: '#000', accent: '#fff' } },
    offValue: { name: 'light', palette: { background: '#fff', accent: '#000' } },
    enabled: true,
    rolloutPercentage: 100,
  });

  assert.equal(jsonFlag.statusCode, 201);
  assert.deepEqual(jsonFlag.json().onValue, {
    name: 'dark',
    palette: { background: '#000', accent: '#fff' },
  });
  assert.deepEqual(jsonFlag.json().offValue, {
    name: 'light',
    palette: { background: '#fff', accent: '#000' },
  });

  const booleanFlag = await createFlag(app, 'demo', 'production', {
    key: 'classic',
    enabled: true,
    rolloutPercentage: 100,
  });

  assert.equal(booleanFlag.type, 'boolean');
  assert.equal('onValue' in booleanFlag, false);
  assert.equal('offValue' in booleanFlag, false);

  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/demo/environments/production/flags',
    headers: AUTHORIZATION,
  });

  assert.equal(list.statusCode, 200);

  const flags = Object.fromEntries(
    list.json().flags.map((flag) => [flag.key, flag]),
  );

  assert.equal(flags.greeting.type, 'string');
  assert.equal(flags.greeting.onValue, 'hello');
  assert.equal(flags['max-items'].onValue, 42.5);
  assert.deepEqual(flags.theme.offValue, {
    name: 'light',
    palette: { background: '#fff', accent: '#000' },
  });
  assert.equal(flags.classic.type, 'boolean');
  assert.equal('onValue' in flags.classic, false);

  const read = await getFlag(app, 'theme');
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().type, 'json');
  assert.deepEqual(read.json().onValue, jsonFlag.json().onValue);
});

test('updates typed values individually without changing the type', async (t) => {
  const { app } = await setup(t);

  const created = await createTypedFlag(app, {
    key: 'greeting',
    type: 'string',
    onValue: 'hello',
    offValue: 'goodbye',
    enabled: true,
    rolloutPercentage: 100,
  });
  assert.equal(created.statusCode, 201);

  const onValuePatch = await patchFlag(app, 'greeting', { onValue: 'hi' });
  assert.equal(onValuePatch.statusCode, 200);
  assert.equal(onValuePatch.json().type, 'string');
  assert.equal(onValuePatch.json().onValue, 'hi');
  assert.equal(onValuePatch.json().offValue, 'goodbye');

  const offValuePatch = await patchFlag(app, 'greeting', { offValue: 'later' });
  assert.equal(offValuePatch.statusCode, 200);
  assert.equal(offValuePatch.json().onValue, 'hi');
  assert.equal(offValuePatch.json().offValue, 'later');

  const rolloutPatch = await patchFlag(app, 'greeting', {
    enabled: false,
    rolloutPercentage: 25.5,
  });
  assert.equal(rolloutPatch.statusCode, 200);
  assert.equal(rolloutPatch.json().enabled, false);
  assert.equal(rolloutPatch.json().rolloutPercentage, 25.5);
  assert.equal(rolloutPatch.json().onValue, 'hi');

  const typePatch = await patchFlag(app, 'greeting', { type: 'number' });
  assert.equal(typePatch.statusCode, 400);
  assert.equal(typePatch.json().error.code, 'VALIDATION_ERROR');

  const unchanged = await getFlag(app, 'greeting');
  assert.equal(unchanged.json().type, 'string');
  assert.equal(unchanged.json().onValue, 'hi');
  assert.equal(unchanged.json().offValue, 'later');
});

test('validates flag types and values', async (t) => {
  const { app } = await setup(t);

  const invalidCreates = [
    [
      { key: 'bad-string-1', type: 'string', onValue: 'hello' },
      'onValue and offValue are required',
    ],
    [
      { key: 'bad-string-2', type: 'string', onValue: 'hello', offValue: 42 },
      'offValue must be a string',
    ],
    [
      { key: 'bad-string-3', type: 'string', onValue: 'a'.repeat(4097), offValue: 'b' },
      'onValue must be at most 4096 characters',
    ],
    [
      { key: 'bad-number', type: 'number', onValue: '1', offValue: 2 },
      'onValue must be a finite number',
    ],
    [
      { key: 'bad-json-array', type: 'json', onValue: [], offValue: {} },
      'onValue must be a plain JSON object',
    ],
    [
      { key: 'bad-json-null', type: 'json', onValue: null, offValue: {} },
      'onValue must be a plain JSON object',
    ],
    [
      {
        key: 'bad-json-large',
        type: 'json',
        onValue: { data: 'x'.repeat(8200) },
        offValue: {},
      },
      'onValue must serialize to at most 8192 bytes',
    ],
    [
      { key: 'bad-boolean-on', onValue: 'hello' },
      'onValue and offValue are not allowed for boolean flags',
    ],
    [
      { key: 'bad-boolean-off', type: 'boolean', offValue: false },
      'onValue and offValue are not allowed for boolean flags',
    ],
    [
      { key: 'bad-type', type: 'date', onValue: 'x', offValue: 'y' },
      'must be equal to one of the allowed values',
    ],
  ];

  for (const [payload, message] of invalidCreates) {
    const response = await createTypedFlag(app, payload);

    assert.equal(response.statusCode, 400, payload.key);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR', payload.key);
    assert.match(response.json().error.message, new RegExp(message));
  }

  const valid = await createTypedFlag(app, {
    key: 'updatable',
    type: 'string',
    onValue: 'hello',
    offValue: 'goodbye',
  });
  assert.equal(valid.statusCode, 201);

  const invalidUpdates = [
    [{ onValue: 42 }, 'onValue must be a string'],
    [{ onValue: null }, 'onValue must be a string'],
    [{ onValue: 'a'.repeat(4097) }, 'onValue must be at most 4096 characters'],
  ];

  for (const [payload, message] of invalidUpdates) {
    const response = await patchFlag(app, 'updatable', payload);

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
    assert.match(response.json().error.message, new RegExp(message));
  }

  const booleanFlag = await createFlag(app, 'demo', 'production', {
    key: 'boolean-flag',
  });
  assert.equal(booleanFlag.type, 'boolean');

  const booleanPatch = await patchFlag(app, 'boolean-flag', { onValue: true });
  assert.equal(booleanPatch.statusCode, 400);
  assert.equal(booleanPatch.json().error.code, 'VALIDATION_ERROR');
  assert.match(booleanPatch.json().error.message, /not allowed/);
});

test('rejects a different type for an existing flag key', async (t) => {
  const { app } = await setup(t);
  await createEnvironment(app, 'demo', 'staging', 'Staging');

  const created = await createTypedFlag(app, {
    key: 'typed',
    type: 'string',
    onValue: 'on',
    offValue: 'off',
  });
  assert.equal(created.statusCode, 201);

  const sameEnvironment = await createTypedFlag(app, {
    key: 'typed',
    type: 'number',
    onValue: 1,
    offValue: 0,
  });
  assert.equal(sameEnvironment.statusCode, 409);
  assert.equal(sameEnvironment.json().error.code, 'FLAG_TYPE_MISMATCH');

  const otherEnvironment = await createTypedFlag(app, {
    key: 'typed',
    type: 'number',
    onValue: 1,
    offValue: 0,
  }, 'staging');
  assert.equal(otherEnvironment.statusCode, 409);
  assert.equal(otherEnvironment.json().error.code, 'FLAG_TYPE_MISMATCH');

  const duplicate = await createTypedFlag(app, {
    key: 'typed',
    type: 'string',
    onValue: 'on',
    offValue: 'off',
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'FLAG_EXISTS');
});

test('evaluates typed flags with deterministic rollout and reasons', async (t) => {
  const { app } = await setup(t);

  await createTypedFlag(app, {
    key: 'split-string',
    type: 'string',
    onValue: 'on',
    offValue: 'off',
    enabled: true,
    rolloutPercentage: 100,
  });
  await createTypedFlag(app, {
    key: 'split-number',
    type: 'number',
    onValue: 1.5,
    offValue: 0.5,
    enabled: true,
    rolloutPercentage: 0,
  });
  await createTypedFlag(app, {
    key: 'split-json',
    type: 'json',
    onValue: { state: 'on' },
    offValue: { state: 'off' },
    enabled: true,
    rolloutPercentage: 100,
  });
  await createTypedFlag(app, {
    key: 'split-string-disabled',
    type: 'string',
    onValue: 'on',
    offValue: 'off',
    enabled: false,
    rolloutPercentage: 100,
  });
  await createTypedFlag(app, {
    key: 'split-string-partial',
    type: 'string',
    onValue: 'on',
    offValue: 'off',
    enabled: true,
    rolloutPercentage: 50,
  });
  await createFlag(app, 'demo', 'production', {
    key: 'split-boolean',
    enabled: true,
    rolloutPercentage: 100,
  });
  await createFlag(app, 'demo', 'production', {
    key: 'split-boolean-zero',
    enabled: true,
    rolloutPercentage: 0,
  });
  await createFlag(app, 'demo', 'production', {
    key: 'split-boolean-disabled',
    enabled: false,
    rolloutPercentage: 100,
  });

  const apiKey = await createApiKey(app, 'demo', 'production');

  const included = await evaluate(app, apiKey.key, 'split-string');
  assert.equal(included.statusCode, 200);
  assert.deepEqual(included.json(), {
    key: 'split-string',
    value: 'on',
    reason: 'SPLIT',
    variant: 'on',
  });

  const excluded = await evaluate(app, apiKey.key, 'split-number');
  assert.equal(excluded.statusCode, 200);
  assert.deepEqual(excluded.json(), {
    key: 'split-number',
    value: 0.5,
    reason: 'SPLIT',
    variant: 'off',
  });

  const jsonIncluded = await evaluate(app, apiKey.key, 'split-json');
  assert.equal(jsonIncluded.statusCode, 200);
  assert.deepEqual(jsonIncluded.json(), {
    key: 'split-json',
    value: { state: 'on' },
    reason: 'SPLIT',
    variant: 'on',
  });

  const disabled = await evaluate(app, apiKey.key, 'split-string-disabled');
  assert.equal(disabled.statusCode, 200);
  assert.deepEqual(disabled.json(), {
    key: 'split-string-disabled',
    value: 'off',
    reason: 'DISABLED',
    variant: 'disabled',
  });

  assert.equal(
    (await evaluate(app, apiKey.key, 'split-boolean')).json().value,
    true,
  );
  assert.equal(
    (await evaluate(app, apiKey.key, 'split-boolean')).json().variant,
    'enabled',
  );

  const booleanExcluded = await evaluate(app, apiKey.key, 'split-boolean-zero');
  assert.equal(booleanExcluded.json().value, false);
  assert.equal(booleanExcluded.json().reason, 'SPLIT');
  assert.equal(booleanExcluded.json().variant, 'disabled');

  const booleanDisabled = await evaluate(
    app,
    apiKey.key,
    'split-boolean-disabled',
  );
  assert.equal(booleanDisabled.json().value, false);
  assert.equal(booleanDisabled.json().reason, 'DISABLED');
  assert.equal(booleanDisabled.json().variant, 'disabled');

  const first = await evaluate(app, apiKey.key, 'split-string-partial');
  const second = await evaluate(app, apiKey.key, 'split-string-partial');
  const third = await evaluate(app, apiKey.key, 'split-string-partial');

  assert.deepEqual(first.json(), second.json());
  assert.deepEqual(second.json(), third.json());
  assert.equal(['on', 'off'].includes(first.json().value), true);
});

test('OFREP bulk returns typed values and changes the ETag with onValue', async (t) => {
  const { app } = await setup(t);

  await createTypedFlag(app, {
    key: 'bulk-string',
    type: 'string',
    onValue: 'blue',
    offValue: 'red',
    enabled: true,
    rolloutPercentage: 100,
  });
  await createTypedFlag(app, {
    key: 'bulk-number',
    type: 'number',
    onValue: 12.5,
    offValue: 1,
    enabled: true,
    rolloutPercentage: 100,
  });
  await createTypedFlag(app, {
    key: 'bulk-json',
    type: 'json',
    onValue: { theme: 'dark' },
    offValue: { theme: 'light' },
    enabled: true,
    rolloutPercentage: 100,
  });

  const apiKey = await createApiKey(app, 'demo', 'production');

  const first = await evaluateBulk(app, apiKey.key);
  assert.equal(first.statusCode, 200);

  const byKey = Object.fromEntries(
    first.json().flags.map((flag) => [flag.key, flag]),
  );

  assert.equal(byKey['bulk-string'].value, 'blue');
  assert.equal(byKey['bulk-string'].variant, 'on');
  assert.equal(byKey['bulk-number'].value, 12.5);
  assert.deepEqual(byKey['bulk-json'].value, { theme: 'dark' });

  const cached = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: {
      'x-api-key': apiKey.key,
      'if-none-match': first.headers.etag,
    },
    payload: { context: { targetingKey: 'user-1' } },
  });
  assert.equal(cached.statusCode, 304);

  const patch = await patchFlag(app, 'bulk-string', { onValue: 'green' });
  assert.equal(patch.statusCode, 200);

  const changed = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: {
      'x-api-key': apiKey.key,
      'if-none-match': first.headers.etag,
    },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(changed.statusCode, 200);
  assert.notEqual(changed.headers.etag, first.headers.etag);
  assert.equal(
    changed.json().flags.find((flag) => flag.key === 'bulk-string').value,
    'green',
  );
});

test('legacy API ignores non-boolean flags', async (t) => {
  const { app } = await createV2App(t);

  const typed = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/default/environments/production/flags',
    headers: AUTHORIZATION,
    payload: {
      key: 'typed-legacy',
      type: 'string',
      onValue: 'on',
      offValue: 'off',
      enabled: true,
      rolloutPercentage: 100,
    },
  });
  assert.equal(typed.statusCode, 201);

  const boolean = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/default/environments/production/flags',
    headers: AUTHORIZATION,
    payload: {
      key: 'boolean-legacy',
      enabled: true,
      rolloutPercentage: 100,
    },
  });
  assert.equal(boolean.statusCode, 201);

  const list = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: AUTHORIZATION,
  });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(
    list.json().flags.map((flag) => flag.key),
    ['boolean-legacy'],
  );

  const get = await app.inject({
    method: 'GET',
    url: '/api/flags/typed-legacy',
    headers: AUTHORIZATION,
  });
  assert.equal(get.statusCode, 404);
  assert.equal(get.json().error.code, 'FLAG_NOT_FOUND');

  const patch = await app.inject({
    method: 'PATCH',
    url: '/api/flags/typed-legacy',
    headers: AUTHORIZATION,
    payload: { enabled: false },
  });
  assert.equal(patch.statusCode, 404);
  assert.equal(patch.json().error.code, 'FLAG_NOT_FOUND');

  const create = await app.inject({
    method: 'POST',
    url: '/api/flags',
    headers: AUTHORIZATION,
    payload: { key: 'typed-legacy', enabled: true, rolloutPercentage: 100 },
  });
  assert.equal(create.statusCode, 409);
  assert.equal(create.json().error.code, 'FLAG_EXISTS');

  const evaluation = await app.inject({
    method: 'POST',
    url: '/api/evaluate',
    payload: { flagKey: 'typed-legacy', userId: 'user-1' },
  });
  assert.equal(evaluation.statusCode, 200);
  assert.equal(evaluation.json().enabled, false);
  assert.equal(evaluation.json().reason, 'FLAG_NOT_FOUND');
});


test('accepts two maximum-size JSON values within the request body limit', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');

  const value = { data: 'x'.repeat(8180) };
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/demo/environments/production/flags',
    headers: AUTHORIZATION,
    payload: {
      key: 'large-json',
      type: 'json',
      enabled: true,
      rolloutPercentage: 50,
      onValue: value,
      offValue: value,
    },
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().onValue.data.length, 8180);
});

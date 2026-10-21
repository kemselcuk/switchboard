import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import Fastify from 'fastify';
import { parse } from 'yaml';

import { AppError } from '../../src/errors.js';
import { ofrepErrorHandler } from '../../src/v2/routes/ofrep.js';
import {
  createApiKey,
  createEnvironment,
  createFlag,
  createProject,
  createV2App,
} from '../v2/helpers.js';

const SPEC_PATH = fileURLToPath(
  new URL('../../docs/contracts/ofrep-openapi.yaml', import.meta.url),
);
const spec = parse(readFileSync(SPEC_PATH, 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });

ajv.addSchema(spec, 'ofrep');

function validator(name) {
  return ajv.getSchema(`ofrep#/components/schemas/${name}`);
}

function assertBooleanEvaluation(evaluation) {
  assert.equal(typeof evaluation.key, 'string');
  assert.equal(typeof evaluation.value, 'boolean');
  assert.equal(
    ['STATIC', 'TARGETING_MATCH', 'SPLIT', 'DISABLED', 'UNKNOWN']
      .includes(evaluation.reason),
    true,
  );
  assert.equal(typeof evaluation.variant, 'string');
}

test('vendored OFREP contract exposes the required core paths', () => {
  assert.equal(spec.info.version, '0.4.0');
  assert.ok(spec.paths['/ofrep/v1/evaluate/flags/{key}']);
  assert.ok(spec.paths['/ofrep/v1/evaluate/flags']);
});

test('single OFREP response matches the official schema', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production', {
    enabled: true,
    rolloutPercentage: 100,
  });
  const key = await createApiKey(app, 'demo', 'production');

  const response = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/new-checkout',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(response.statusCode, 200);
  assertBooleanEvaluation(response.json());
});

test('bulk OFREP response matches the official schema', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production');
  const key = await createApiKey(app, 'demo', 'production');

  const response = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(Array.isArray(response.json().flags), true);
  assertBooleanEvaluation(response.json().flags[0]);
  assert.equal(typeof response.json().metadata.version, 'string');
});

test('typed OFREP responses match the official value schemas', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production', {
    key: 'string-flag',
    type: 'string',
    onValue: 'blue',
    offValue: 'red',
    enabled: true,
    rolloutPercentage: 100,
  });
  await createFlag(app, 'demo', 'production', {
    key: 'number-flag',
    type: 'number',
    onValue: 42.5,
    offValue: 0.5,
    enabled: true,
    rolloutPercentage: 100,
  });
  await createFlag(app, 'demo', 'production', {
    key: 'object-flag',
    type: 'json',
    onValue: { theme: 'dark' },
    offValue: { theme: 'light' },
    enabled: true,
    rolloutPercentage: 100,
  });
  const key = await createApiKey(app, 'demo', 'production');

  async function single(flagKey) {
    return app.inject({
      method: 'POST',
      url: `/ofrep/v1/evaluate/flags/${flagKey}`,
      headers: { 'x-api-key': key.key },
      payload: { context: { targetingKey: 'user-1' } },
    });
  }

  const stringResponse = await single('string-flag');
  assert.equal(stringResponse.statusCode, 200);
  assert.equal(stringResponse.json().value, 'blue');
  assert.equal(validator('stringFlag')(stringResponse.json()), true);

  const numberResponse = await single('number-flag');
  assert.equal(numberResponse.statusCode, 200);
  assert.equal(numberResponse.json().value, 42.5);
  assert.equal(validator('floatFlag')(numberResponse.json()), true);

  const objectResponse = await single('object-flag');
  assert.equal(objectResponse.statusCode, 200);
  assert.deepEqual(objectResponse.json().value, { theme: 'dark' });
  assert.equal(validator('objectFlag')(objectResponse.json()), true);

  const bulk = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(bulk.statusCode, 200);

  const byKey = Object.fromEntries(
    bulk.json().flags.map((flag) => [flag.key, flag]),
  );

  assert.equal(validator('stringFlag')(byKey['string-flag']), true);
  assert.equal(validator('floatFlag')(byKey['number-flag']), true);
  assert.equal(validator('objectFlag')(byKey['object-flag']), true);
});

test('OFREP not-found response matches the official schema', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  const key = await createApiKey(app, 'demo', 'production');

  const response = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/missing',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(validator('flagNotFound')(response.json()), true);
});

test('quoted bulk ETag round-trips and is resent on 304', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production');
  const key = await createApiKey(app, 'demo', 'production');

  const first = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(first.statusCode, 200);
  assert.match(first.headers.etag, /^"[0-9a-f]{16}"$/);

  const second = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: {
      'x-api-key': key.key,
      'if-none-match': first.headers.etag,
    },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(second.statusCode, 304);
  assert.equal(second.headers.etag, first.headers.etag);
  assert.equal(second.body, '');
});

test('bulk ETag is scoped to the project key', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app, 'demo');
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production', { key: 'same-flag' });
  const demoKey = await createApiKey(app, 'demo', 'production');

  await createProject(app, 'other', 'Other');
  await createEnvironment(app, 'other');
  await createFlag(app, 'other', 'production', { key: 'same-flag' });
  const otherKey = await createApiKey(app, 'other', 'production');

  async function bulk(apiKey) {
    return app.inject({
      method: 'POST',
      url: '/ofrep/v1/evaluate/flags',
      headers: { 'x-api-key': apiKey },
      payload: { context: { targetingKey: 'user-1' } },
    });
  }

  const demo = await bulk(demoKey.key);
  const other = await bulk(otherKey.key);

  assert.equal(demo.statusCode, 200);
  assert.equal(other.statusCode, 200);
  assert.notEqual(demo.headers.etag, other.headers.etag);
});

test('single OFREP 400 matches the evaluationFailure schema', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  const key = await createApiKey(app, 'demo', 'production');

  const response = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/new-checkout',
    headers: { 'x-api-key': key.key },
    payload: { context: 'not-an-object' },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().key, 'new-checkout');
  assert.equal(validator('evaluationFailure')(response.json()), true);
});

test('bulk OFREP 400 matches the bulkEvaluationFailure schema', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  const key = await createApiKey(app, 'demo', 'production');

  const response = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags',
    headers: { 'x-api-key': key.key },
    payload: {},
  });

  assert.equal(response.statusCode, 400);
  assert.equal(validator('bulkEvaluationFailure')(response.json()), true);
});

test('OFREP storage failures use a general error body', async (t) => {
  const { app, v2 } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production');
  const key = await createApiKey(app, 'demo', 'production');

  const original = v2.db.selectFrom.bind(v2.db);
  v2.db.selectFrom = () => {
    throw new Error('database unavailable');
  };

  t.after(() => {
    v2.db.selectFrom = original;
  });

  const response = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/new-checkout',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    errorDetails: 'Flag storage is unavailable',
  });
  assert.equal(validator('generalErrorResponse')(response.json()), true);
});

test('OFREP 500 uses the generalErrorResponse schema', async (t) => {
  const app = Fastify();

  app.setErrorHandler(ofrepErrorHandler);
  app.post('/ofrep/v1/evaluate/flags/:key', async () => {
    throw new Error('unexpected');
  });

  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/new-checkout',
    payload: { context: { targetingKey: 'user-1' } },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(validator('generalErrorResponse')(response.json()), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import { parse } from 'yaml';

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

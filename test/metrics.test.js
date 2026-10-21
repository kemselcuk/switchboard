import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/app.js';
import {
  ADMIN_TOKEN,
  AUTHORIZATION,
  createApiKey,
  createEnvironment,
  createFlag,
  createProject,
  createV2App,
} from './v2/helpers.js';

async function scrape(app) {
  const response = await app.inject({ method: 'GET', url: '/metrics' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^text\/plain/);
  assert.equal(response.headers['cache-control'], 'no-store');

  return response.body;
}

test('exposes Prometheus text with help, type, counters and histogram', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: '/healthz' });
  const body = await scrape(app);

  assert.match(body, /# HELP switchboard_http_requests_total /);
  assert.match(body, /# TYPE switchboard_http_requests_total counter/);
  assert.match(
    body,
    /switchboard_http_requests_total\{method="GET",route="\/healthz",status="200"\} 1/,
  );
  assert.match(
    body,
    /switchboard_http_request_duration_seconds_bucket\{method="GET",route="\/healthz",status="200",le="0.005"\}/,
  );
  assert.match(body, /switchboard_http_request_duration_seconds_sum/);
  assert.match(body, /switchboard_http_request_duration_seconds_count/);
  assert.match(body, /switchboard_http_request_duration_seconds_bucket\{[^}]*le="\+Inf"\}/);
});

test('records OFREP and legacy evaluation results', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production', {
    key: 'metrics-flag',
    enabled: true,
    rolloutPercentage: 100,
  });
  const key = await createApiKey(app, 'demo', 'production');

  await app.inject({
    method: 'POST',
    url: '/ofrep/v1/evaluate/flags/metrics-flag',
    headers: { 'x-api-key': key.key },
    payload: { context: { targetingKey: 'user-1' } },
  });

  const ofrep = await scrape(app);
  assert.match(
    ofrep,
    /switchboard_flag_evaluations_total\{result="SPLIT"\} 1/,
  );

  const legacyApp = buildApp({ adminToken: ADMIN_TOKEN });
  t.after(() => legacyApp.close());

  await legacyApp.inject({
    method: 'POST',
    url: '/api/flags',
    headers: AUTHORIZATION,
    payload: { key: 'legacy-metrics', enabled: true, rolloutPercentage: 100 },
  });
  await legacyApp.inject({
    method: 'POST',
    url: '/api/evaluate',
    payload: { flagKey: 'legacy-metrics', userId: 'user-1' },
  });

  const legacy = await scrape(legacyApp);
  assert.match(
    legacy,
    /switchboard_flag_evaluations_total\{result="BUCKET_INCLUDED"\} 1/,
  );
});

test('counts storage failures mapped to 503', async (t) => {
  const { app, v2 } = await createV2App(t);
  const original = v2.db.selectFrom.bind(v2.db);

  v2.db.selectFrom = () => {
    const error = new Error('terminating connection');

    error.code = '57P01';
    throw error;
  };
  t.after(() => {
    v2.db.selectFrom = original;
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/flags',
    headers: AUTHORIZATION,
  });

  assert.equal(response.statusCode, 503);

  const body = await scrape(app);
  assert.match(body, /switchboard_db_failures_total 1/);
});

test('uses route templates and exposes no tenant data', async (t) => {
  const app = buildApp({ adminToken: ADMIN_TOKEN });
  t.after(() => app.close());

  await app.inject({
    method: 'GET',
    url: '/api/flags/secret-flag',
    headers: AUTHORIZATION,
  });

  const body = await scrape(app);

  assert.match(
    body,
    /switchboard_http_requests_total\{method="GET",route="\/api\/flags\/:key",status="404"\} 1/,
  );
  assert.equal(body.includes('secret-flag'), false);
  assert.equal(body.includes(ADMIN_TOKEN), false);
});

test('keeps metrics isolated per app instance', async (t) => {
  const first = buildApp();
  const second = buildApp();

  t.after(() => first.close());
  t.after(() => second.close());

  await first.inject({ method: 'GET', url: '/healthz' });

  const firstBody = await scrape(first);
  const secondBody = await scrape(second);

  assert.match(firstBody, /route="\/healthz"/);
  assert.equal(secondBody.includes('route="/healthz"'), false);
});

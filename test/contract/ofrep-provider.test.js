import test from 'node:test';
import assert from 'node:assert/strict';

import { OFREPProvider } from '@openfeature/ofrep-provider';
import { ErrorCode, OpenFeature } from '@openfeature/server-sdk';

import {
  createApiKey,
  createEnvironment,
  createFlag,
  createProject,
  createV2App,
} from '../v2/helpers.js';

test('official OFREP provider evaluates against the service', async (t) => {
  const { app } = await createV2App(t);
  await createProject(app);
  await createEnvironment(app, 'demo');
  await createFlag(app, 'demo', 'production', {
    key: 'new-checkout',
    enabled: true,
    rolloutPercentage: 100,
  });
  await createFlag(app, 'demo', 'production', {
    key: 'off-flag',
    enabled: false,
    rolloutPercentage: 100,
  });
  await createFlag(app, 'demo', 'production', {
    key: 'checkout-theme',
    type: 'string',
    enabled: true,
    rolloutPercentage: 100,
    onValue: 'dark',
    offValue: 'light',
  });
  await createFlag(app, 'demo', 'production', {
    key: 'max-seats',
    type: 'number',
    enabled: true,
    rolloutPercentage: 0,
    onValue: 25,
    offValue: 5,
  });
  const key = await createApiKey(app, 'demo', 'production');

  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();

  t.after(async () => {
    await OpenFeature.clearProviders();
  });

  await OpenFeature.setProviderAndWait(new OFREPProvider({
    baseUrl: `http://127.0.0.1:${port}`,
    headers: [
      ['X-API-Key', key.key],
    ],
  }));

  const client = OpenFeature.getClient();

  const enabled = await client.getBooleanDetails(
    'new-checkout',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(enabled.value, true);
  assert.equal(enabled.reason, 'SPLIT');

  const disabled = await client.getBooleanDetails(
    'off-flag',
    true,
    { targetingKey: 'user-1' },
  );

  assert.equal(disabled.value, false);
  assert.equal(disabled.reason, 'DISABLED');

  const missing = await client.getBooleanDetails(
    'missing-flag',
    false,
    { targetingKey: 'user-1' },
  );

  assert.equal(missing.value, false);
  assert.equal(missing.errorCode, ErrorCode.FLAG_NOT_FOUND);

  const theme = await client.getStringDetails(
    'checkout-theme',
    'system',
    { targetingKey: 'user-1' },
  );

  assert.equal(theme.value, 'dark');
  assert.equal(theme.reason, 'SPLIT');
  assert.equal(theme.variant, 'on');

  const seats = await client.getNumberDetails(
    'max-seats',
    1,
    { targetingKey: 'user-1' },
  );

  assert.equal(seats.value, 5);
  assert.equal(seats.reason, 'SPLIT');
  assert.equal(seats.variant, 'off');
});

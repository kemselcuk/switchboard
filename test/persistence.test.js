import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildApp } from '../src/app.js';

const ADMIN_TOKEN = 'test-admin-token';
const AUTHORIZATION = { authorization: `Bearer ${ADMIN_TOKEN}` };

test('flag settings and evaluation survive close and reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'switchboard-eval-'));
  const dbPath = join(directory, 'switchboard.db');
  let app;

  try {
    app = buildApp({ dbPath, adminToken: ADMIN_TOKEN });

    const created = await app.inject({
      method: 'POST',
      url: '/api/flags',
      headers: AUTHORIZATION,
      payload: {
        key: 'persisted-flag',
        description: 'survives restart',
        enabled: true,
        rolloutPercentage: 40,
      },
    });
    assert.equal(created.statusCode, 201);

    const before = await app.inject({
      method: 'POST',
      url: '/api/evaluate',
      payload: { flagKey: 'persisted-flag', userId: 'user-123' },
    });
    assert.equal(before.statusCode, 200);
    assert.deepEqual(before.json(), {
      flagKey: 'persisted-flag',
      userId: 'user-123',
      enabled: true,
      reason: 'BUCKET_INCLUDED',
      bucket: 14,
      rolloutPercentage: 40,
    });

    await app.close();
    app = buildApp({ dbPath, adminToken: ADMIN_TOKEN });

    const stored = await app.inject({
      method: 'GET',
      url: '/api/flags/persisted-flag',
      headers: AUTHORIZATION,
    });
    assert.equal(stored.statusCode, 200);
    assert.deepEqual(stored.json(), created.json());

    const after = await app.inject({
      method: 'POST',
      url: '/api/evaluate',
      payload: { flagKey: 'persisted-flag', userId: 'user-123' },
    });
    assert.equal(after.statusCode, 200);
    assert.deepEqual(after.json(), before.json());
  } finally {
    if (app) {
      await app.close();
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

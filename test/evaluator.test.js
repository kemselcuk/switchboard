import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUCKET_ALGORITHM_VERSION,
  bucketFor,
  evaluateFlag,
} from '../src/flags/evaluator.js';

// Vectors computed independently with node:crypto:
// SHA-256(flagKey + ":" + userId), first 4 bytes big-endian, mapped to 0-99.
const GOLDEN_VECTORS = [
  { flagKey: 'new-checkout', userId: 'user-123', bucket: 65 },
  { flagKey: 'new-checkout', userId: 'user-0000', bucket: 3 },
  { flagKey: 'beta-search', userId: 'user-123', bucket: 52 },
  { flagKey: 'checkout', userId: 'alice', bucket: 6 },
  { flagKey: 'dark-mode', userId: 'User-123', bucket: 65 },
  { flagKey: 'pricing-v2', userId: 'user-9999', bucket: 75 },
];

function userIds(count) {
  return Array.from(
    { length: count },
    (_, index) => `user-${String(index).padStart(4, '0')}`,
  );
}

function flag(overrides = {}) {
  return {
    key: 'new-checkout',
    enabled: true,
    rolloutPercentage: 40,
    ...overrides,
  };
}

test('bucketFor matches the golden vectors', () => {
  assert.equal(BUCKET_ALGORITHM_VERSION, 1);

  for (const vector of GOLDEN_VECTORS) {
    assert.equal(
      bucketFor(vector.flagKey, vector.userId),
      vector.bucket,
      `${vector.flagKey}/${vector.userId}`,
    );
  }
});

test('the same input returns the same bucket and decision 100 times', () => {
  const expected = evaluateFlag(flag(), 'user-123');

  for (let run = 0; run < 100; run += 1) {
    assert.deepEqual(evaluateFlag(flag(), 'user-123'), expected);
  }

  assert.deepEqual(expected, {
    bucket: 65,
    enabled: false,
    reason: 'BUCKET_EXCLUDED',
  });
});

test('buckets always stay within 0-99', () => {
  for (const userId of userIds(10000)) {
    const bucket = bucketFor('range-check', userId);

    assert.equal(Number.isInteger(bucket), true);
    assert.ok(bucket >= 0 && bucket <= 99, `bucket out of range: ${bucket}`);
  }
});

test('rollout 0 excludes everyone and rollout 100 includes everyone', () => {
  const users = ['user-0000', 'user-0005', 'user-123', 'alice'];

  for (const userId of users) {
    assert.equal(
      evaluateFlag(flag({ rolloutPercentage: 0 }), userId).reason,
      'BUCKET_EXCLUDED',
    );
    assert.equal(
      evaluateFlag(flag({ rolloutPercentage: 0 }), userId).enabled,
      false,
    );
    assert.equal(
      evaluateFlag(flag({ rolloutPercentage: 100 }), userId).reason,
      'BUCKET_INCLUDED',
    );
    assert.equal(
      evaluateFlag(flag({ rolloutPercentage: 100 }), userId).enabled,
      true,
    );
  }
});

test('a disabled flag is FLAG_DISABLED regardless of rollout', () => {
  for (const rolloutPercentage of [0, 40, 100]) {
    const result = evaluateFlag(
      flag({ enabled: false, rolloutPercentage }),
      'user-123',
    );

    assert.deepEqual(result, {
      bucket: 65,
      enabled: false,
      reason: 'FLAG_DISABLED',
    });
  }
});

test('different flag keys can place the same user in different buckets', () => {
  const userId = 'user-123';

  assert.equal(bucketFor('new-checkout', userId), 65);
  assert.equal(bucketFor('beta-search', userId), 52);
  assert.notEqual(
    bucketFor('new-checkout', userId),
    bucketFor('beta-search', userId),
  );

  assert.deepEqual(
    evaluateFlag(flag({ key: 'new-checkout', rolloutPercentage: 60 }), userId),
    { bucket: 65, enabled: false, reason: 'BUCKET_EXCLUDED' },
  );
  assert.deepEqual(
    evaluateFlag(flag({ key: 'beta-search', rolloutPercentage: 60 }), userId),
    { bucket: 52, enabled: true, reason: 'BUCKET_INCLUDED' },
  );
});

test('the 20 percent set is a subset of the 40 percent set for 1000 IDs', () => {
  const includedAt20 = [];
  const includedAt40 = [];

  for (const userId of userIds(1000)) {
    const bucket = bucketFor('monotonic-flag', userId);

    if (bucket < 20) {
      includedAt20.push(userId);
    }
    if (bucket < 40) {
      includedAt40.push(userId);
    }
  }

  const includedAt40Set = new Set(includedAt40);

  assert.ok(includedAt20.length > 0);
  assert.ok(includedAt20.length < includedAt40.length);
  for (const userId of includedAt20) {
    assert.equal(includedAt40Set.has(userId), true, userId);
  }
});

test('rollout ratios stay within 2 points for 10000 fixed IDs', () => {
  let includedAt20 = 0;
  let includedAt40 = 0;
  const users = userIds(10000);

  for (const userId of users) {
    const bucket = bucketFor('distribution-flag', userId);

    if (bucket < 20) {
      includedAt20 += 1;
    }
    if (bucket < 40) {
      includedAt40 += 1;
    }
  }

  assert.ok(
    Math.abs(includedAt20 / users.length - 0.2) <= 0.02,
    `20% ratio was ${includedAt20 / users.length}`,
  );
  assert.ok(
    Math.abs(includedAt40 / users.length - 0.4) <= 0.02,
    `40% ratio was ${includedAt40 / users.length}`,
  );
});

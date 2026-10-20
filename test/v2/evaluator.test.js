import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketForV2,
  evaluateBooleanFlag,
} from '../../src/v2/evaluator.js';

function ids(count) {
  return Array.from(
    { length: count },
    (_, index) => `user-${String(index).padStart(4, '0')}`,
  );
}

test('v2 buckets stay in 0-99999 and are deterministic', () => {
  for (const userId of ids(1000)) {
    const bucket = bucketForV2('demo', 'new-checkout', userId);
    assert.equal(Number.isInteger(bucket), true);
    assert.ok(bucket >= 0 && bucket < 100000);
    assert.equal(bucket, bucketForV2('demo', 'new-checkout', userId));
  }
});

test('v2 20 percent set is a subset of the 40 percent set', () => {
  const at20 = [];
  const at40 = [];

  for (const userId of ids(2000)) {
    const bucket = bucketForV2('demo', 'new-checkout', userId);
    if (bucket < 20000) at20.push(userId);
    if (bucket < 40000) at40.push(userId);
  }

  const at40Set = new Set(at40);
  assert.ok(at20.length > 0);
  for (const userId of at20) {
    assert.equal(at40Set.has(userId), true, userId);
  }
});

test('v2 rollout distribution stays within 2 points for 10000 IDs', () => {
  let at20 = 0;
  let at40 = 0;

  for (const userId of ids(10000)) {
    const bucket = bucketForV2('demo', 'new-checkout', userId);
    if (bucket < 20000) at20 += 1;
    if (bucket < 40000) at40 += 1;
  }

  assert.ok(Math.abs(at20 / 10000 - 0.2) <= 0.02);
  assert.ok(Math.abs(at40 / 10000 - 0.4) <= 0.02);
});

test('evaluateBooleanFlag handles disabled and included flags', () => {
  const disabled = evaluateBooleanFlag({
    projectKey: 'demo',
    flag: {
      key: 'new-checkout',
      enabled: false,
      rolloutBasisPoints: 100000,
    },
    context: { targetingKey: 'user-1' },
  });

  assert.deepEqual(disabled, {
    value: false,
    reason: 'DISABLED',
    variant: 'disabled',
    bucket: null,
  });

  const included = evaluateBooleanFlag({
    projectKey: 'demo',
    flag: {
      key: 'new-checkout',
      enabled: true,
      rolloutBasisPoints: 100000,
    },
    context: { targetingKey: 'user-1' },
  });

  assert.equal(included.value, true);
  assert.equal(included.reason, 'SPLIT');
  assert.equal(included.variant, 'enabled');
});

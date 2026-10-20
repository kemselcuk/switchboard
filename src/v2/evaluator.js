import { createHash } from 'node:crypto';

import { V2_ROLLOUT_BUCKETS } from './constants.js';

export function bucketForV2(projectKey, flagKey, targetingKey) {
  const digest = createHash('sha256')
    .update(`${projectKey}:${flagKey}:${targetingKey}`, 'utf8')
    .digest();
  const value = digest.readUInt32BE(0);

  return Math.floor((value / 2 ** 32) * V2_ROLLOUT_BUCKETS);
}

export function evaluateBooleanFlag({ projectKey, flag, context }) {
  const targetingKey = context?.targetingKey || 'anonymous';

  if (!flag.enabled) {
    return {
      value: false,
      reason: 'DISABLED',
      variant: 'disabled',
      bucket: null,
    };
  }

  const bucket = bucketForV2(projectKey, flag.key, targetingKey);
  const included = bucket < flag.rolloutBasisPoints;

  return {
    value: included,
    reason: 'SPLIT',
    variant: included ? 'enabled' : 'disabled',
    bucket,
  };
}

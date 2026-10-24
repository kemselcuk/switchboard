import { createHash } from 'node:crypto';

import { V2_ROLLOUT_BUCKETS } from './constants.js';
import { firstMatchingRule } from './targeting.js';

export function bucketForV2(projectKey, flagKey, targetingKey) {
  const digest = createHash('sha256')
    .update(`${projectKey}:${flagKey}:${targetingKey}`, 'utf8')
    .digest();
  const value = digest.readUInt32BE(0);

  return Math.floor((value / 2 ** 32) * V2_ROLLOUT_BUCKETS);
}

export function evaluateFlag({
  projectKey,
  flag,
  context,
  segments = [],
}) {
  const targetingKey = context?.targetingKey || 'anonymous';
  const type = flag.type ?? 'boolean';
  const isBoolean = type === 'boolean';
  const onValue = isBoolean ? true : flag.onValue;
  const offValue = isBoolean ? false : flag.offValue;

  if (!flag.enabled) {
    return {
      value: offValue,
      reason: 'DISABLED',
      variant: 'disabled',
      bucket: null,
    };
  }

  const rule = firstMatchingRule(flag.rules ?? [], segments, context);

  if (rule) {
    const included = rule.action === 'on';

    return {
      value: included ? onValue : offValue,
      reason: 'TARGETING_MATCH',
      variant: included ? 'on' : 'off',
      bucket: null,
    };
  }

  const bucket = bucketForV2(projectKey, flag.key, targetingKey);
  const included = bucket < flag.rolloutBasisPoints;

  return {
    value: included ? onValue : offValue,
    reason: 'SPLIT',
    variant: isBoolean
      ? (included ? 'enabled' : 'disabled')
      : (included ? 'on' : 'off'),
    bucket,
  };
}

// Kept for callers that still use the pre-typed name.
export const evaluateBooleanFlag = evaluateFlag;

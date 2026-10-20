import { createHash } from 'node:crypto';

export const BUCKET_ALGORITHM_VERSION = 1;

const BUCKET_COUNT = 100;

export function bucketFor(flagKey, userId) {
  const digest = createHash('sha256')
    .update(`${flagKey}:${userId}`, 'utf8')
    .digest();
  const value = digest.readUInt32BE(0);

  return Math.floor((value / 2 ** 32) * BUCKET_COUNT);
}

export function evaluateFlag(flag, userId) {
  const bucket = bucketFor(flag.key, userId);

  if (!flag.enabled) {
    return {
      bucket,
      enabled: false,
      reason: 'FLAG_DISABLED',
    };
  }

  if (bucket < flag.rolloutPercentage) {
    return {
      bucket,
      enabled: true,
      reason: 'BUCKET_INCLUDED',
    };
  }

  return {
    bucket,
    enabled: false,
    reason: 'BUCKET_EXCLUDED',
  };
}

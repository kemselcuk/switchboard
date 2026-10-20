import { evaluateFlag } from './evaluator.js';
import { evaluateBody } from './schemas.js';

export async function evaluateRoutes(app) {
  app.post(
    '/api/evaluate',
    { schema: { body: evaluateBody } },
    async (request) => {
      const { flagKey, userId } = request.body;
      const flag = app.repository.getFlag(flagKey);

      if (!flag) {
        return {
          flagKey,
          userId,
          enabled: false,
          reason: 'FLAG_NOT_FOUND',
          bucket: null,
          rolloutPercentage: null,
        };
      }

      const { bucket, enabled, reason } = evaluateFlag(flag, userId);

      return {
        flagKey,
        userId,
        enabled,
        reason,
        bucket,
        rolloutPercentage: flag.rolloutPercentage,
      };
    },
  );
}

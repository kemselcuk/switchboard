import { AppError, ERROR_CODES } from '../errors.js';
import { evaluateFlag } from './evaluator.js';
import { evaluateBody } from './schemas.js';

export async function evaluateRoutes(app) {
  app.post(
    '/api/evaluate',
    { schema: { body: evaluateBody } },
    async (request) => {
      const { flagKey, userId } = request.body;
      let flag;

      try {
        flag = app.repository.getFlag(flagKey);
      } catch (error) {
        const unavailable = new AppError(
          503,
          ERROR_CODES.EVALUATION_UNAVAILABLE,
          'Flag storage is unavailable',
        );

        unavailable.cause = error;
        throw unavailable;
      }

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

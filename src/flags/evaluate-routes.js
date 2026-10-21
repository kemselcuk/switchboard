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
        flag = await app.repository.getFlag(flagKey);
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
        app.metrics.recordEvaluation('FLAG_NOT_FOUND');

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

      app.metrics.recordEvaluation(reason);

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

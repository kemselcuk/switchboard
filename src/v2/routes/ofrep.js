import { createHash } from 'node:crypto';

import { createApiKeyAuthHook } from '../api-key-auth.js';
import { evaluateBooleanFlag } from '../evaluator.js';
import { createFlagRepository } from '../repositories/flags.js';
import {
  ofrepEvaluationBody,
  ofrepFlagParams,
} from '../schemas.js';

function evaluationKey(flag, context) {
  return `${flag.key}:${context?.targetingKey ?? 'anonymous'}:${flag.rolloutBasisPoints}:${flag.enabled}`;
}

function etagFor(flags, context) {
  const value = flags
    .map((flag) => evaluationKey(flag, context))
    .join('|');

  return createHash('sha256')
    .update(value, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

function evaluationResponse(flag, result) {
  return {
    key: flag.key,
    value: result.value,
    reason: result.reason,
    variant: result.variant,
  };
}

export async function ofrepRoutes(app, { db }) {
  const flags = createFlagRepository(db);

  app.addHook('onRequest', createApiKeyAuthHook(db));

  app.post(
    '/ofrep/v1/evaluate/flags/:key',
    { schema: { params: ofrepFlagParams, body: ofrepEvaluationBody } },
    async (request, reply) => {
      const { projectId, projectKey, environmentId } = request.apiKeyContext;
      const context = request.body.context;
      const flag = await flags.findFlag(
        projectId,
        environmentId,
        request.params.key,
      );

      if (!flag) {
        return reply.code(404).send({
          key: request.params.key,
          errorCode: 'FLAG_NOT_FOUND',
          errorDetails: `Flag '${request.params.key}' was not found`,
        });
      }

      const result = evaluateBooleanFlag({
        projectKey,
        flag,
        context,
      });

      return evaluationResponse(flag, result);
    },
  );

  app.post(
    '/ofrep/v1/evaluate/flags',
    { schema: { body: ofrepEvaluationBody } },
    async (request, reply) => {
      const { projectId, projectKey, environmentId } = request.apiKeyContext;
      const context = request.body.context;
      const list = await flags.listFlags(projectId, environmentId);
      const etag = etagFor(list, context);
      const ifNoneMatch = request.headers['if-none-match'];

      if (ifNoneMatch === etag) {
        return reply.code(304).send();
      }

      const evaluations = list.map((flag) => {
        const result = evaluateBooleanFlag({
          projectKey,
          flag,
          context,
        });

        return evaluationResponse(flag, result);
      });

      reply.header('ETag', etag);

      return {
        flags: evaluations,
        metadata: { version: etag },
      };
    },
  );
}

import { createHash } from 'node:crypto';

import { normalizeError, sendError } from '../../errors.js';
import { createApiKeyAuthHook } from '../api-key-auth.js';
import { evaluateFlag } from '../evaluator.js';
import { createFlagRepository } from '../repositories/flags.js';
import { createTargetingRepository } from '../repositories/targeting.js';
import {
  ofrepEvaluationBody,
  ofrepFlagParams,
} from '../schemas.js';
import { contextFingerprint } from '../targeting.js';

function ruleSignature(rule) {
  return {
    segmentKey: rule.segmentKey ?? null,
    conditions: rule.conditions ?? null,
    action: rule.action,
  };
}

function evaluationKey(flag) {
  return [
    flag.key,
    flag.rolloutBasisPoints,
    flag.enabled,
    flag.type,
    JSON.stringify(flag.onValue),
    JSON.stringify(flag.offValue),
    JSON.stringify((flag.rules ?? []).map(ruleSignature)),
  ].join(':');
}

function etagFor(projectKey, flags, context, segments) {
  const segmentKey = JSON.stringify(segments.map((segment) => ({
    key: segment.key,
    name: segment.name,
    conditions: segment.conditions,
  })));
  const value = [
    projectKey,
    contextFingerprint(context),
    segmentKey,
    flags.map(evaluationKey).join('|'),
  ].join('|');

  const hash = createHash('sha256')
    .update(value, 'utf8')
    .digest('hex')
    .slice(0, 16);

  return `"${hash}"`;
}

function normalizeEtag(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const unquoted = trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;

  if (unquoted.startsWith('"') && unquoted.endsWith('"')) {
    return unquoted.slice(1, -1);
  }

  return unquoted;
}

function matchesEtag(ifNoneMatch, etag) {
  if (typeof ifNoneMatch !== 'string') {
    return false;
  }

  const current = normalizeEtag(etag);

  return ifNoneMatch
    .split(',')
    .map((value) => normalizeEtag(value))
    .some((value) => value === current);
}

export function ofrepErrorHandler(error, request, reply) {
  const { statusCode, code, message } = normalizeError(error);
  const isBulk = request.params?.key === undefined;

  if (statusCode >= 500) {
    request.log.error(error);

    if (statusCode === 503) {
      request.server.metrics?.recordDbFailure();
    }

    return reply.code(statusCode).send({
      errorDetails: statusCode === 503
        ? 'Flag storage is unavailable'
        : 'An internal server error occurred while processing the request',
    });
  }

  if (statusCode === 400) {
    if (isBulk) {
      return reply.code(400).send({
        errorCode: 'INVALID_CONTEXT',
        errorDetails: message,
      });
    }

    return reply.code(400).send({
      key: request.params.key,
      errorCode: 'INVALID_CONTEXT',
      errorDetails: message,
    });
  }

  return sendError(reply, statusCode, code, message);
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
  const targeting = createTargetingRepository(db);

  app.setErrorHandler(ofrepErrorHandler);
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
        app.metrics.recordEvaluation('FLAG_NOT_FOUND');

        return reply.code(404).send({
          key: request.params.key,
          errorCode: 'FLAG_NOT_FOUND',
          errorDetails: `Flag '${request.params.key}' was not found`,
        });
      }

      const [rules, segments] = await Promise.all([
        targeting.listRules(projectId, environmentId, flag.id),
        targeting.listSegments(projectId),
      ]);
      const result = evaluateFlag({
        projectKey,
        flag: { ...flag, rules },
        context,
        segments,
      });

      app.metrics.recordEvaluation(result.reason);

      return evaluationResponse(flag, result);
    },
  );

  app.post(
    '/ofrep/v1/evaluate/flags',
    { schema: { body: ofrepEvaluationBody } },
    async (request, reply) => {
      const { projectId, projectKey, environmentId } = request.apiKeyContext;
      const context = request.body.context;
      const [list, segments, rulesByFlag] = await Promise.all([
        flags.listFlags(projectId, environmentId),
        targeting.listSegments(projectId),
        targeting.listRulesForEnvironment(projectId, environmentId),
      ]);
      const evaluationFlags = list.map((flag) => ({
        ...flag,
        rules: rulesByFlag.get(flag.id) ?? [],
      }));
      const etag = etagFor(projectKey, evaluationFlags, context, segments);
      const ifNoneMatch = request.headers['if-none-match'];

      if (matchesEtag(ifNoneMatch, etag)) {
        return reply.code(304).header('ETag', etag).send();
      }

      const evaluations = evaluationFlags.map((flag) => {
        const result = evaluateFlag({
          projectKey,
          flag,
          context,
          segments,
        });

        app.metrics.recordEvaluation(result.reason);

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

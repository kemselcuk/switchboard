import { AppError, ERROR_CODES, sendError } from '../errors.js';
import {
  apiKeysMatch,
  createApiKeyRepository,
} from './repositories/api-keys.js';

function extractApiKey(headers) {
  const direct = headers['x-api-key'];

  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  const authorization = headers.authorization;

  if (typeof authorization !== 'string') {
    return null;
  }

  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization.trim());

  return match ? match[1].trim() : null;
}

function keyPrefix(key) {
  return key.split('_').slice(0, 3).join('_');
}

export function createApiKeyAuthHook(db) {
  const apiKeys = createApiKeyRepository(db);

  return async function authenticateApiKey(request, reply) {
    const key = extractApiKey(request.headers);

    if (!key) {
      return sendError(
        reply,
        401,
        ERROR_CODES.UNAUTHORIZED,
        'Missing API key',
      );
    }

    let record;

    try {
      record = await apiKeys.findApiKeyByPrefix(keyPrefix(key));
    } catch (error) {
      throw new AppError(
        503,
        ERROR_CODES.EVALUATION_UNAVAILABLE,
        'Flag storage is unavailable',
      );
    }

    if (
      !record
      || record.revoked_at
      || !apiKeysMatch(key, record.hash)
    ) {
      return sendError(
        reply,
        401,
        ERROR_CODES.UNAUTHORIZED,
        'Invalid or revoked API key',
      );
    }

    request.apiKeyContext = {
      apiKeyId: record.key_id,
      projectId: record.project_id,
      projectKey: record.project_key,
      environmentId: record.environment_id,
      environmentKey: record.environment_key,
    };

    try {
      await apiKeys.touchApiKey(record.key_id);
    } catch {
      // A usage timestamp must never fail an evaluation.
    }
  };
}

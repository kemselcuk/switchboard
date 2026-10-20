import { createHash, timingSafeEqual } from 'node:crypto';

import { ERROR_CODES, sendError } from './errors.js';

const BEARER_PATTERN = /^Bearer[ \t]+(.+)$/i;

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function tokensMatch(provided, expected) {
  if (
    typeof provided !== 'string'
    || typeof expected !== 'string'
    || expected.length === 0
  ) {
    return false;
  }

  return timingSafeEqual(sha256(provided), sha256(expected));
}

export function extractBearerToken(header) {
  if (typeof header !== 'string') {
    return null;
  }

  const match = BEARER_PATTERN.exec(header.trim());

  return match ? match[1].trim() : null;
}

export function createAuthHook(adminToken) {
  return async function authenticate(request, reply) {
    const token = extractBearerToken(request.headers.authorization);

    if (!tokensMatch(token, adminToken)) {
      reply.header('WWW-Authenticate', 'Bearer');
      return sendError(
        reply,
        401,
        ERROR_CODES.UNAUTHORIZED,
        'Missing or invalid bearer token',
      );
    }
  };
}

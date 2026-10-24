export const ERROR_CODES = Object.freeze({
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_EXPORT: 'INVALID_EXPORT',
  FLAG_EXISTS: 'FLAG_EXISTS',
  FLAG_NOT_FOUND: 'FLAG_NOT_FOUND',
  SEGMENT_EXISTS: 'SEGMENT_EXISTS',
  SEGMENT_NOT_FOUND: 'SEGMENT_NOT_FOUND',
  SEGMENT_IN_USE: 'SEGMENT_IN_USE',
  RULE_CONFLICT: 'RULE_CONFLICT',
  EVALUATION_UNAVAILABLE: 'EVALUATION_UNAVAILABLE',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

const STORAGE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

function isStorageError(error) {
  if (typeof error?.code !== 'string') {
    return false;
  }

  if (error.code.startsWith('SQLITE_')) {
    return true;
  }

  if (STORAGE_NETWORK_CODES.has(error.code)) {
    return true;
  }

  // Postgres SQLSTATE codes; integrity errors (23xxx) are handled by callers.
  return /^[0-9A-Z]{5}$/.test(error.code) && !error.code.startsWith('23');
}

export class AppError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function errorEnvelope(code, message) {
  return { error: { code, message } };
}

export function sendError(reply, statusCode, code, message) {
  return reply.code(statusCode).send(errorEnvelope(code, message));
}

export function normalizeError(error) {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (error?.code === ERROR_CODES.FLAG_EXISTS) {
    return {
      statusCode: 409,
      code: ERROR_CODES.FLAG_EXISTS,
      message: 'Flag already exists',
    };
  }

  if (error?.code === ERROR_CODES.FLAG_NOT_FOUND) {
    return {
      statusCode: 404,
      code: ERROR_CODES.FLAG_NOT_FOUND,
      message: 'Flag not found',
    };
  }

  if (isStorageError(error)) {
    return {
      statusCode: 503,
      code: ERROR_CODES.EVALUATION_UNAVAILABLE,
      message: 'Flag storage is unavailable',
    };
  }

  if (error?.validation) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: error.message ?? 'Invalid request',
    };
  }

  const statusCode = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : 500;

  if (statusCode >= 400 && statusCode < 500) {
    const code = statusCode === 401
      ? ERROR_CODES.UNAUTHORIZED
      : statusCode === 404
        ? ERROR_CODES.NOT_FOUND
        : ERROR_CODES.VALIDATION_ERROR;

    return {
      statusCode,
      code,
      message: error.message ?? 'Invalid request',
    };
  }

  return {
    statusCode: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: 'Internal server error',
  };
}

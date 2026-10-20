import Fastify from 'fastify';
import { openDatabase } from './db.js';
import { ERROR_CODES, normalizeError, sendError } from './errors.js';
import { createRepository } from './flags/repository.js';
import { evaluateRoutes } from './flags/evaluate-routes.js';
import { flagRoutes } from './flags/routes.js';

const REDACT_PATHS = ['req.headers.authorization'];

function buildLoggerOptions(logger) {
  if (!logger) {
    return false;
  }

  if (logger === true) {
    return { redact: REDACT_PATHS };
  }

  const redact = logger.redact === undefined
    ? []
    : Array.isArray(logger.redact)
      ? logger.redact
      : [logger.redact];

  return {
    ...logger,
    redact: [...new Set([...redact, ...REDACT_PATHS])],
  };
}

export function buildApp({
  dbPath = ':memory:',
  logger = false,
  repository,
  adminToken,
} = {}) {
  const app = Fastify({
    logger: buildLoggerOptions(logger),
    bodyLimit: 16 * 1024,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
      },
    },
  });

  let db = null;
  let flagRepository = repository;

  if (!flagRepository) {
    db = openDatabase({ dbPath });

    try {
      flagRepository = createRepository(db);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  if (db) {
    app.decorate('db', db);
  }
  app.decorate('repository', flagRepository);

  if (db) {
    app.addHook('onClose', async () => {
      if (db.open) {
        db.close();
      }
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const { statusCode, code, message } = normalizeError(error);

    if (statusCode >= 500) {
      request.log.error(error);
    }

    return sendError(reply, statusCode, code, message);
  });

  app.setNotFoundHandler((request, reply) => sendError(
    reply,
    404,
    ERROR_CODES.NOT_FOUND,
    'Route not found',
  ));

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.register(flagRoutes, { adminToken });
  app.register(evaluateRoutes);

  return app;
}

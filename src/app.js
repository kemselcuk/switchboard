import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { openDatabase } from './db.js';
import { ERROR_CODES, normalizeError, sendError } from './errors.js';
import { createRepository } from './flags/repository.js';
import { evaluateRoutes } from './flags/evaluate-routes.js';
import { flagRoutes } from './flags/routes.js';
import { createLegacyRepository } from './v2/legacy-repository.js';
import { registerV2Routes } from './v2/routes/index.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
];
const PUBLIC_ROOT = fileURLToPath(new URL('../public', import.meta.url));

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
  v2,
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

  if (v2) {
    flagRepository = v2.legacyRepository ?? createLegacyRepository(v2.db, {
      projectId: v2.defaultProjectId,
      environmentId: v2.defaultEnvironmentId,
    });
    app.decorate('v2', v2);
    app.addHook('onClose', async () => {
      await v2.destroy?.();
    });
  } else if (!flagRepository) {
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

  if (v2) {
    app.register(registerV2Routes, {
      db: v2.db,
      adminToken,
    });
  }

  app.register(fastifyStatic, {
    root: PUBLIC_ROOT,
    prefix: '/',
  });

  return app;
}

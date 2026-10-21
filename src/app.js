import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { openDatabase } from './db.js';
import { createMetrics, METRICS_CONTENT_TYPE } from './metrics.js';
import {
  ERROR_CODES,
  normalizeError,
  sendError,
} from './errors.js';
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
const DEFAULT_READINESS_TIMEOUT_MS = 2000;

async function probeWithTimeout(probe, timeoutMs) {
  let timer;

  try {
    await Promise.race([
      Promise.resolve().then(probe),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Readiness probe timed out');
          error.code = ERROR_CODES.EVALUATION_UNAVAILABLE;
          reject(error);
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  readinessTimeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
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

  const metrics = createMetrics();

  app.decorate('metrics', metrics);

  app.addHook('onRequest', async (request) => {
    request.metricsStartedAt = process.hrtime.bigint();
  });
  app.addHook('onResponse', async (request, reply) => {
    const started = request.metricsStartedAt;
    const durationSeconds = typeof started === 'bigint'
      ? Number(process.hrtime.bigint() - started) / 1e9
      : 0;
    const route = request.routeOptions?.url ?? 'unknown';

    metrics.recordHttpRequest({
      method: request.method,
      route,
      status: reply.statusCode,
      durationSeconds,
    });
  });

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

    if (statusCode === 503) {
      metrics.recordDbFailure();
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

  app.get('/metrics', async (_request, reply) => reply
    .header('cache-control', 'no-store')
    .type(METRICS_CONTENT_TYPE)
    .send(metrics.render()));

  app.get('/readyz', async (request, reply) => {
    const probe = v2
      ? () => sql`select 1`.execute(v2.db)
      : db
        ? () => db.prepare('SELECT 1').get()
        : null;

    // An injected repository owns no storage here, so there is nothing to
    // probe and the app reports ready without a storage check.
    if (!probe) {
      return { status: 'ready' };
    }

    try {
      await probeWithTimeout(probe, readinessTimeoutMs);
    } catch (error) {
      request.log.warn({
        code: typeof error?.code === 'string'
          ? error.code
          : ERROR_CODES.EVALUATION_UNAVAILABLE,
      });

      return sendError(
        reply,
        503,
        ERROR_CODES.EVALUATION_UNAVAILABLE,
        'Flag storage is unavailable',
      );
    }

    return { status: 'ready' };
  });

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

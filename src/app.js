import Fastify from 'fastify';
import { openDatabase } from './db.js';
import { createRepository } from './flags/repository.js';

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
} = {}) {
  const app = Fastify({
    logger: buildLoggerOptions(logger),
    bodyLimit: 16 * 1024,
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

  app.get('/healthz', async () => ({ status: 'ok' }));

  return app;
}

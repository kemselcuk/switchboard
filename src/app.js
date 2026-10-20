import Fastify from 'fastify';

export function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16 * 1024,
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  return app;
}

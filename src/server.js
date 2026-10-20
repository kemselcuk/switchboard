import { buildApp } from './app.js';

if (!process.env.ADMIN_TOKEN) {
  console.error(
    'ADMIN_TOKEN is required. Copy .env.example to .env and set a token.',
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const dbPath = process.env.DB_PATH ?? './data/switchboard.db';
const logLevel = process.env.LOG_LEVEL ?? 'info';

const app = buildApp({ dbPath, logger: { level: logLevel } });

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error(error);
      process.exit(1);
    }
  });
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

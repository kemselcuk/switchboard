import { initializeV2Database } from '../src/v2/db.js';
import { migrateLegacyFlags } from '../src/v2/migrate-legacy.js';

const databaseUrl = process.env.DATABASE_URL;
const legacyDbPath = process.env.SQLITE_PATH ?? './data/switchboard.db';

if (!databaseUrl) {
  console.error('DATABASE_URL is required for the Postgres migration.');
  process.exit(1);
}

const v2 = await initializeV2Database({ databaseUrl });

try {
  const result = await migrateLegacyFlags({
    legacyDbPath,
    db: v2.db,
    projectId: v2.defaultProjectId,
    environmentId: v2.defaultEnvironmentId,
  });

  console.log(
    `Legacy migration complete: ${result.migrated} migrated, ${result.skipped} skipped, ${result.total} total.`,
  );
} finally {
  await v2.destroy();
}

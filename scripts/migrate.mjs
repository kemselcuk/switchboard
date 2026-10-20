import { initializeV2Database } from '../src/v2/db.js';

const databaseUrl = process.env.DATABASE_URL;
const dbPath = process.env.V2_DB_PATH ?? './data/switchboard-v2.db';

const handle = await initializeV2Database({ databaseUrl, dbPath });

console.log(
  `Migrated Switchboard v2 (${handle.dialect}); default project=${handle.defaultProjectId}, environment=${handle.defaultEnvironmentId}`,
);

await handle.destroy();

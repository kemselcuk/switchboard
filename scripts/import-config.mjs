import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { initializeV2Database } from '../src/v2/db.js';
import { importConfiguration } from '../src/v2/repositories/transfer.js';

function readOption(name) {
  const prefixed = process.argv.find((argument) => argument.startsWith(`${name}=`));

  if (prefixed) {
    const value = prefixed.slice(name.length + 1);

    if (!value) {
      throw new Error(`${name} requires a value`);
    }

    return value;
  }

  const index = process.argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];

  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

const databaseUrl = process.env.DATABASE_URL;
const dbPath = process.env.V2_DB_PATH ?? './data/switchboard-v2.db';

let handle;

try {
  const file = readOption('--file');
  const dryRun = process.argv.includes('--dry-run');

  if (!file) {
    console.error('Usage: npm run import:config -- --file backup.json [--dry-run]');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(resolve(file), 'utf8'));

  handle = await initializeV2Database({ databaseUrl, dbPath });
  const summary = await importConfiguration(handle.db, data, { dryRun });

  console.log(JSON.stringify(summary, null, 2));
  console.log(
    dryRun
      ? 'Dry run only; no changes were written.'
      : 'Import complete.',
  );
} catch (error) {
  console.error(`Import failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await handle?.destroy();
}

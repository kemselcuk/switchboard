import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { initializeV2Database } from '../src/v2/db.js';
import { exportConfiguration } from '../src/v2/repositories/transfer.js';

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

  handle = await initializeV2Database({ databaseUrl, dbPath });
  const data = await exportConfiguration(handle.db);
  const json = `${JSON.stringify(data, null, 2)}\n`;

  if (file) {
    writeFileSync(resolve(file), json);
    console.error(
      `Exported ${data.projects.length} project(s) to ${resolve(file)}`,
    );
  } else {
    process.stdout.write(json);
  }
} catch (error) {
  console.error(`Export failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await handle?.destroy();
}

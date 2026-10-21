import { mkdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import {
  Kysely,
  PostgresDialect,
  SqliteDialect,
} from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import pg from 'pg';

import {
  DEFAULT_ENVIRONMENT_KEY,
  DEFAULT_PROJECT_KEY,
} from './constants.js';

const MIGRATION_FOLDER = fileURLToPath(
  new URL('../../db/migrations', import.meta.url),
);

const MAX_POOL_MAX = 1000;

export function parsePoolMax(value) {
  let parsed;

  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) {
    parsed = Number(value);
  } else {
    return undefined;
  }

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_POOL_MAX) {
    return undefined;
  }

  return parsed;
}

export function createDatabase({
  databaseUrl,
  dbPath = ':memory:',
} = {}) {
  if (databaseUrl) {
    const { Pool } = pg;
    const poolOptions = { connectionString: databaseUrl };
    const poolMax = parsePoolMax(process.env.DATABASE_POOL_MAX);

    if (poolMax !== undefined) {
      poolOptions.max = poolMax;
    }

    const pool = new Pool(poolOptions);
    const db = new Kysely({
      dialect: new PostgresDialect({ pool }),
    });

    return {
      db,
      dialect: 'postgres',
      pool,
      destroy: () => db.destroy(),
    };
  }

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  }

  const sqlite = new Database(dbPath);

  sqlite.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('busy_timeout = 5000');

  const db = new Kysely({
    dialect: new SqliteDialect({ database: sqlite }),
  });

  return {
    db,
    dialect: 'sqlite',
    destroy: () => db.destroy(),
  };
}

export async function migrateToLatest(db) {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: MIGRATION_FOLDER,
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  if (error) {
    throw error;
  }

  return results ?? [];
}

export async function seedDefaultProject(db) {
  const now = new Date().toISOString();

  await db
    .insertInto('projects')
    .values({
      id: randomUUID(),
      key: DEFAULT_PROJECT_KEY,
      name: 'Default project',
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) => conflict.column('key').doNothing())
    .execute();

  const project = await db
    .selectFrom('projects')
    .selectAll()
    .where('key', '=', DEFAULT_PROJECT_KEY)
    .executeTakeFirstOrThrow();

  await db
    .insertInto('environments')
    .values({
      id: randomUUID(),
      project_id: project.id,
      key: DEFAULT_ENVIRONMENT_KEY,
      name: 'Production',
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) => conflict
      .columns(['project_id', 'key'])
      .doNothing())
    .execute();

  const environment = await db
    .selectFrom('environments')
    .selectAll()
    .where('project_id', '=', project.id)
    .where('key', '=', DEFAULT_ENVIRONMENT_KEY)
    .executeTakeFirstOrThrow();

  return {
    defaultProjectId: project.id,
    defaultEnvironmentId: environment.id,
  };
}

export async function initializeV2Database({
  databaseUrl,
  dbPath = ':memory:',
} = {}) {
  const handle = createDatabase({ databaseUrl, dbPath });

  try {
    await migrateToLatest(handle.db);
    const defaults = await seedDefaultProject(handle.db);

    return {
      ...handle,
      ...defaults,
    };
  } catch (error) {
    await handle.destroy();
    throw error;
  }
}

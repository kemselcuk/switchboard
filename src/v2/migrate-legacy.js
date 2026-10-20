import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';

export function readLegacyFlags(legacyDbPath) {
  const source = new Database(legacyDbPath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const table = source
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'flags'")
      .get();

    if (!table) {
      throw new Error(`No legacy flags table found in ${legacyDbPath}`);
    }

    return source.prepare(`
      SELECT
        key,
        description,
        enabled,
        rollout_percentage,
        created_at,
        updated_at
      FROM flags
      ORDER BY id ASC
    `).all();
  } finally {
    source.close();
  }
}

export async function migrateLegacyFlags({
  legacyDbPath,
  db,
  projectId,
  environmentId,
}) {
  const flags = readLegacyFlags(legacyDbPath);
  const now = new Date().toISOString();
  let migrated = 0;
  let skipped = 0;

  await db.transaction().execute(async (trx) => {
    for (const flag of flags) {
      const existingFlag = await trx
        .selectFrom('flags')
        .select('id')
        .where('project_id', '=', projectId)
        .where('key', '=', flag.key)
        .executeTakeFirst();

      if (existingFlag) {
        const existingConfig = await trx
          .selectFrom('flag_configs')
          .select('id')
          .where('flag_id', '=', existingFlag.id)
          .where('environment_id', '=', environmentId)
          .executeTakeFirst();

        if (existingConfig) {
          skipped += 1;
          continue;
        }

        await trx
          .insertInto('flag_configs')
          .values({
            id: randomUUID(),
            flag_id: existingFlag.id,
            environment_id: environmentId,
            enabled: flag.enabled ? 1 : 0,
            rollout_basis_points: flag.rollout_percentage * 1000,
            created_at: flag.created_at ?? now,
            updated_at: flag.updated_at ?? now,
          })
          .execute();

        migrated += 1;
        continue;
      }

      const flagId = randomUUID();

      await trx
        .insertInto('flags')
        .values({
          id: flagId,
          project_id: projectId,
          key: flag.key,
          type: 'boolean',
          description: flag.description ?? '',
          created_at: flag.created_at ?? now,
          updated_at: flag.updated_at ?? now,
        })
        .execute();

      await trx
        .insertInto('flag_configs')
        .values({
          id: randomUUID(),
          flag_id: flagId,
          environment_id: environmentId,
          enabled: flag.enabled ? 1 : 0,
          rollout_basis_points: flag.rollout_percentage * 1000,
          created_at: flag.created_at ?? now,
          updated_at: flag.updated_at ?? now,
        })
        .execute();

      migrated += 1;
    }
  });

  return {
    total: flags.length,
    migrated,
    skipped,
  };
}

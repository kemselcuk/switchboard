import { randomUUID } from 'node:crypto';

import {
  conflict,
  isUniqueViolation,
  mapFlag,
  notFound,
} from './common.js';
import { nextLegacyId } from './legacy-ids.js';

const FLAG_SELECT = [
  'flags.id as flag_id',
  'flags.legacy_id',
  'flags.key',
  'flags.type',
  'flags.description',
  'flags.created_at as flag_created_at',
  'flags.updated_at as flag_updated_at',
  'flag_configs.enabled',
  'flag_configs.rollout_basis_points',
  'flag_configs.on_value',
  'flag_configs.off_value',
  'flag_configs.updated_at as config_updated_at',
];

function serializeFlagValue(type, value) {
  if (type === 'boolean' || value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

function isLegacyIdConflict(error) {
  return error?.constraint === 'flags_project_legacy_id_unique'
    || /legacy_id/.test(error?.message ?? '');
}

function flagQuery(db, projectId, environmentId) {
  return db
    .selectFrom('flags')
    .innerJoin('flag_configs', 'flag_configs.flag_id', 'flags.id')
    .select(FLAG_SELECT)
    .where('flags.project_id', '=', projectId)
    .where('flag_configs.environment_id', '=', environmentId);
}

export function createFlagRepository(db) {
  async function createFlagInEnvironment({
    projectId,
    environmentId,
    key,
    type = 'boolean',
    description = '',
    enabled = false,
    rolloutBasisPoints = 0,
    onValue,
    offValue,
  }) {
    const now = new Date().toISOString();

    for (let attempt = 0; ; attempt += 1) {
      try {
        await db.transaction().execute(async (trx) => {
          let flag = await trx
            .selectFrom('flags')
            .selectAll()
            .where('project_id', '=', projectId)
            .where('key', '=', key)
            .executeTakeFirst();

          if (!flag) {
            flag = {
              id: randomUUID(),
              legacy_id: await nextLegacyId(trx, projectId),
              project_id: projectId,
              key,
              type,
              description,
              created_at: now,
              updated_at: now,
            };

            await trx.insertInto('flags').values(flag).execute();
          } else if (flag.type !== type) {
            throw conflict(
              'FLAG_TYPE_MISMATCH',
              `Flag '${key}' already exists with type ${flag.type}`,
            );
          } else if (flag.legacy_id === null || flag.legacy_id === undefined) {
            flag.legacy_id = await nextLegacyId(trx, projectId);

            await trx
              .updateTable('flags')
              .set({ legacy_id: flag.legacy_id })
              .where('id', '=', flag.id)
              .execute();
          }

          const existingConfig = await trx
            .selectFrom('flag_configs')
            .select('id')
            .where('flag_id', '=', flag.id)
            .where('environment_id', '=', environmentId)
            .executeTakeFirst();

          if (existingConfig) {
            throw conflict('FLAG_EXISTS', 'Flag already exists in this environment');
          }

          await trx
            .insertInto('flag_configs')
            .values({
              id: randomUUID(),
              flag_id: flag.id,
              environment_id: environmentId,
              enabled: enabled ? 1 : 0,
              rollout_basis_points: rolloutBasisPoints,
              on_value: serializeFlagValue(type, onValue),
              off_value: serializeFlagValue(type, offValue),
              created_at: now,
              updated_at: now,
            })
            .execute();
        });
        break;
      } catch (error) {
        if (isLegacyIdConflict(error) && attempt < 4) {
          continue;
        }
        if (error?.code === 'FLAG_EXISTS') {
          throw error;
        }
        if (isUniqueViolation(error)) {
          throw conflict('FLAG_EXISTS', 'Flag already exists');
        }
        throw error;
      }
    }

    return getFlag(projectId, environmentId, key);
  }

  async function listFlags(projectId, environmentId) {
    const rows = await flagQuery(db, projectId, environmentId)
      .orderBy('flags.created_at', 'asc')
      .execute();

    return rows.map(mapFlag);
  }

  async function findFlag(projectId, environmentId, key) {
    const row = await flagQuery(db, projectId, environmentId)
      .where('flags.key', '=', key)
      .executeTakeFirst();

    return row ? mapFlag(row) : null;
  }

  async function getFlag(projectId, environmentId, key) {
    const flag = await findFlag(projectId, environmentId, key);

    if (!flag) {
      throw notFound('FLAG_NOT_FOUND', 'Flag not found');
    }

    return flag;
  }

  async function updateFlag(
    projectId,
    environmentId,
    key,
    {
      description,
      enabled,
      rolloutBasisPoints,
      onValue,
      offValue,
    },
  ) {
    const now = new Date().toISOString();

    try {
      await db.transaction().execute(async (trx) => {
        const flag = await trx
          .selectFrom('flags')
          .select(['id', 'type'])
          .where('project_id', '=', projectId)
          .where('key', '=', key)
          .executeTakeFirst();

        if (!flag) {
          throw notFound('FLAG_NOT_FOUND', 'Flag not found');
        }

        const config = await trx
          .selectFrom('flag_configs')
          .select('id')
          .where('flag_id', '=', flag.id)
          .where('environment_id', '=', environmentId)
          .executeTakeFirst();

        if (!config) {
          throw notFound('FLAG_NOT_FOUND', 'Flag not found in this environment');
        }

        if (description !== undefined) {
          await trx
            .updateTable('flags')
            .set({ description, updated_at: now })
            .where('id', '=', flag.id)
            .execute();
        }

        const hasConfigPatch = enabled !== undefined
          || rolloutBasisPoints !== undefined
          || onValue !== undefined
          || offValue !== undefined;

        if (hasConfigPatch) {
          const patch = { updated_at: now };

          if (enabled !== undefined) {
            patch.enabled = enabled ? 1 : 0;
          }
          if (rolloutBasisPoints !== undefined) {
            patch.rollout_basis_points = rolloutBasisPoints;
          }
          if (onValue !== undefined) {
            patch.on_value = serializeFlagValue(flag.type, onValue);
          }
          if (offValue !== undefined) {
            patch.off_value = serializeFlagValue(flag.type, offValue);
          }

          const result = await trx
            .updateTable('flag_configs')
            .set(patch)
            .where('flag_id', '=', flag.id)
            .where('environment_id', '=', environmentId)
            .executeTakeFirst();

          if (Number(result.numUpdatedRows ?? 0) === 0) {
            throw notFound('FLAG_NOT_FOUND', 'Flag not found in this environment');
          }
        }
      });
    } catch (error) {
      if (error?.code === 'FLAG_NOT_FOUND') {
        throw error;
      }
      throw error;
    }

    return getFlag(projectId, environmentId, key);
  }

  async function deleteFlag(projectId, key) {
    const result = await db
      .deleteFrom('flags')
      .where('project_id', '=', projectId)
      .where('key', '=', key)
      .executeTakeFirst();

    if (Number(result.numDeletedRows ?? 0) === 0) {
      throw notFound('FLAG_NOT_FOUND', 'Flag not found');
    }

    return { key, deleted: true };
  }

  return {
    createFlagInEnvironment,
    listFlags,
    findFlag,
    getFlag,
    updateFlag,
    deleteFlag,
  };
}

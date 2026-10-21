import { randomUUID } from 'node:crypto';

import { AppError } from '../../errors.js';
import { V2_KEY_PATTERN } from '../schemas.js';

export const EXPORT_FORMAT = 'switchboard-v2-export';
export const EXPORT_VERSION = 1;

const KEY_PATTERN = new RegExp(V2_KEY_PATTERN);

class DryRunRollback extends Error {
  constructor(summary) {
    super('dry run');
    this.summary = summary;
  }
}

function invalid(message) {
  return new AppError(400, 'INVALID_EXPORT', message);
}

function assertKey(value, label) {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw invalid(`${label} must match ${V2_KEY_PATTERN}`);
  }
}

function assertName(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80) {
    throw invalid(`${label} must be a string of 1..80 characters`);
  }
}

function assertDescription(value, label) {
  if (typeof value !== 'string' || value.length > 280) {
    throw invalid(`${label} must be a string of at most 280 characters`);
  }
}

function assertRollout(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${label} must be a number`);
  }

  if (value < 0 || value > 100) {
    throw invalid(`${label} must be between 0 and 100`);
  }

  if (Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6) {
    throw invalid(`${label} supports at most three decimal places`);
  }
}

function validateExport(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw invalid('Export must be an object');
  }

  if (data.format !== EXPORT_FORMAT) {
    throw invalid(`Unsupported format; expected ${EXPORT_FORMAT}`);
  }

  if (data.version !== EXPORT_VERSION) {
    throw invalid(`Unsupported version; expected ${EXPORT_VERSION}`);
  }

  if (!Array.isArray(data.projects)) {
    throw invalid('projects must be an array');
  }

  const projectKeys = new Set();

  for (const project of data.projects) {
    if (project === null || typeof project !== 'object') {
      throw invalid('Each project must be an object');
    }

    assertKey(project.key, 'project.key');
    assertName(project.name, 'project.name');

    if (projectKeys.has(project.key)) {
      throw invalid(`Duplicate project key: ${project.key}`);
    }
    projectKeys.add(project.key);

    if (!Array.isArray(project.environments)) {
      throw invalid(`project ${project.key}: environments must be an array`);
    }

    const environmentKeys = new Set();

    for (const environment of project.environments) {
      if (environment === null || typeof environment !== 'object') {
        throw invalid('Each environment must be an object');
      }

      assertKey(environment.key, 'environment.key');
      assertName(environment.name, 'environment.name');

      if (environmentKeys.has(environment.key)) {
        throw invalid(
          `project ${project.key}: duplicate environment key ${environment.key}`,
        );
      }
      environmentKeys.add(environment.key);

      if (!Array.isArray(environment.flags)) {
        throw invalid(
          `environment ${project.key}/${environment.key}: flags must be an array`,
        );
      }

      const flagKeys = new Set();

      for (const flag of environment.flags) {
        if (flag === null || typeof flag !== 'object') {
          throw invalid('Each flag must be an object');
        }

        assertKey(flag.key, 'flag.key');
        assertDescription(flag.description ?? '', 'flag.description');

        if (flag.type !== 'boolean') {
          throw invalid(`flag ${flag.key}: only boolean flags are supported`);
        }

        if (typeof flag.enabled !== 'boolean') {
          throw invalid(`flag ${flag.key}: enabled must be a boolean`);
        }

        assertRollout(flag.rolloutPercentage, `flag ${flag.key}: rolloutPercentage`);

        if (flagKeys.has(flag.key)) {
          throw invalid(
            `environment ${project.key}/${environment.key}: duplicate flag key ${flag.key}`,
          );
        }
        flagKeys.add(flag.key);
      }
    }
  }
}

async function nextLegacyId(trx, projectId) {
  const row = await trx
    .selectFrom('flags')
    .select((builder) => builder.fn.max('legacy_id').as('max_legacy_id'))
    .where('project_id', '=', projectId)
    .executeTakeFirst();

  return Number(row?.max_legacy_id ?? 0) + 1;
}

function toPercent(basisPoints) {
  return Number((basisPoints / 1000).toFixed(3));
}

export async function exportConfiguration(db) {
  const projects = await db
    .selectFrom('projects')
    .selectAll()
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute();

  const exported = [];

  for (const project of projects) {
    const environments = await db
      .selectFrom('environments')
      .selectAll()
      .where('project_id', '=', project.id)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const exportedEnvironments = [];

    for (const environment of environments) {
      const flags = await db
        .selectFrom('flags')
        .innerJoin('flag_configs', 'flag_configs.flag_id', 'flags.id')
        .select([
          'flags.key',
          'flags.type',
          'flags.description',
          'flags.created_at as flag_created_at',
          'flags.updated_at as flag_updated_at',
          'flag_configs.enabled',
          'flag_configs.rollout_basis_points',
          'flag_configs.created_at as config_created_at',
          'flag_configs.updated_at as config_updated_at',
        ])
        .where('flags.project_id', '=', project.id)
        .where('flag_configs.environment_id', '=', environment.id)
        .orderBy('flags.created_at', 'asc')
        .orderBy('flags.id', 'asc')
        .execute();

      exportedEnvironments.push({
        key: environment.key,
        name: environment.name,
        flags: flags.map((flag) => ({
          key: flag.key,
          type: flag.type,
          description: flag.description,
          enabled: flag.enabled === 1,
          rolloutPercentage: toPercent(flag.rollout_basis_points),
          createdAt: flag.config_created_at > flag.flag_created_at
            ? flag.config_created_at
            : flag.flag_created_at,
          updatedAt: flag.config_updated_at > flag.flag_updated_at
            ? flag.config_updated_at
            : flag.flag_updated_at,
        })),
      });
    }

    exported.push({
      key: project.key,
      name: project.name,
      environments: exportedEnvironments,
    });
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    projects: exported,
  };
}

async function applyImport(trx, data, summary) {
  for (const project of data.projects) {
    const now = new Date().toISOString();

    await trx
      .insertInto('projects')
      .values({
        id: randomUUID(),
        key: project.key,
        name: project.name,
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) => conflict.column('key').doNothing())
      .execute();

    const projectRow = await trx
      .selectFrom('projects')
      .selectAll()
      .where('key', '=', project.key)
      .executeTakeFirstOrThrow();

    for (const environment of project.environments) {
      await trx
        .insertInto('environments')
        .values({
          id: randomUUID(),
          project_id: projectRow.id,
          key: environment.key,
          name: environment.name,
          created_at: now,
          updated_at: now,
        })
        .onConflict((conflict) => conflict
          .columns(['project_id', 'key'])
          .doNothing())
        .execute();

      const environmentRow = await trx
        .selectFrom('environments')
        .selectAll()
        .where('project_id', '=', projectRow.id)
        .where('key', '=', environment.key)
        .executeTakeFirstOrThrow();

      for (const flag of environment.flags) {
        summary.totalFlags += 1;

        let flagRow = await trx
          .selectFrom('flags')
          .selectAll()
          .where('project_id', '=', projectRow.id)
          .where('key', '=', flag.key)
          .executeTakeFirst();

        if (!flagRow) {
          flagRow = {
            id: randomUUID(),
            legacy_id: await nextLegacyId(trx, projectRow.id),
            project_id: projectRow.id,
            key: flag.key,
            type: 'boolean',
            description: flag.description ?? '',
            created_at: now,
            updated_at: now,
          };

          await trx.insertInto('flags').values(flagRow).execute();
          summary.flagsCreated += 1;
        } else if (flagRow.description !== (flag.description ?? '')) {
          await trx
            .updateTable('flags')
            .set({
              description: flag.description ?? '',
              updated_at: now,
            })
            .where('id', '=', flagRow.id)
            .execute();
          summary.flagsUpdated += 1;
        }

        const enabled = flag.enabled ? 1 : 0;
        const rolloutBasisPoints = Math.round(flag.rolloutPercentage * 1000);
        const existingConfig = await trx
          .selectFrom('flag_configs')
          .selectAll()
          .where('flag_id', '=', flagRow.id)
          .where('environment_id', '=', environmentRow.id)
          .executeTakeFirst();

        summary.totalConfigs += 1;

        if (!existingConfig) {
          await trx
            .insertInto('flag_configs')
            .values({
              id: randomUUID(),
              flag_id: flagRow.id,
              environment_id: environmentRow.id,
              enabled,
              rollout_basis_points: rolloutBasisPoints,
              created_at: now,
              updated_at: now,
            })
            .execute();
          summary.configsCreated += 1;
        } else if (
          existingConfig.enabled !== enabled
          || existingConfig.rollout_basis_points !== rolloutBasisPoints
        ) {
          await trx
            .updateTable('flag_configs')
            .set({
              enabled,
              rollout_basis_points: rolloutBasisPoints,
              updated_at: now,
            })
            .where('id', '=', existingConfig.id)
            .execute();
          summary.configsUpdated += 1;
        }
      }
    }

    summary.totalProjects += 1;
    summary.totalEnvironments += project.environments.length;
  }
}

export async function importConfiguration(db, data, { dryRun = false } = {}) {
  validateExport(data);

  const summary = {
    projectsCreated: 0,
    environmentsCreated: 0,
    flagsCreated: 0,
    flagsUpdated: 0,
    configsCreated: 0,
    configsUpdated: 0,
    totalProjects: 0,
    totalEnvironments: 0,
    totalFlags: 0,
    totalConfigs: 0,
  };

  try {
    await db.transaction().execute(async (trx) => {
      const beforeProjects = await trx
        .selectFrom('projects')
        .select('id')
        .execute();
      const beforeEnvironments = await trx
        .selectFrom('environments')
        .select('id')
        .execute();

      const beforeProjectIds = new Set(beforeProjects.map((row) => row.id));
      const beforeEnvironmentIds = new Set(
        beforeEnvironments.map((row) => row.id),
      );

      await applyImport(trx, data, summary);

      const afterProjects = await trx
        .selectFrom('projects')
        .select('id')
        .execute();
      const afterEnvironments = await trx
        .selectFrom('environments')
        .select('id')
        .execute();

      summary.projectsCreated = afterProjects
        .filter((row) => !beforeProjectIds.has(row.id))
        .length;
      summary.environmentsCreated = afterEnvironments
        .filter((row) => !beforeEnvironmentIds.has(row.id))
        .length;

      if (dryRun) {
        throw new DryRunRollback(summary);
      }
    });
  } catch (error) {
    if (error instanceof DryRunRollback) {
      return error.summary;
    }
    throw error;
  }

  return summary;
}

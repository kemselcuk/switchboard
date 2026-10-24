import { randomUUID } from 'node:crypto';

import { AppError, ERROR_CODES } from '../../errors.js';
import {
  FLAG_TYPES,
  flagValuesError,
  V2_KEY_PATTERN,
} from '../schemas.js';
import { conditionsError, rulesError } from '../targeting.js';
import { nextLegacyId } from './legacy-ids.js';

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
  return new AppError(400, ERROR_CODES.INVALID_EXPORT, message);
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

function assertFlagValues(type, flag) {
  const message = flagValuesError(type, flag.onValue, flag.offValue);

  if (message) {
    throw invalid(`flag ${flag.key}: ${message}`);
  }
}

function assertConditions(conditions, label) {
  const message = conditionsError(conditions, label);

  if (message) {
    throw invalid(message);
  }
}

function storedValue(type, value) {
  return type === 'boolean' ? null : JSON.stringify(value);
}

function parseStoredValue(value) {
  return typeof value === 'string' ? JSON.parse(value) : null;
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

    if (project.segments !== undefined) {
      if (!Array.isArray(project.segments)) {
        throw invalid(`project ${project.key}: segments must be an array`);
      }

      const segmentKeys = new Set();

      for (const segment of project.segments) {
        if (segment === null || typeof segment !== 'object') {
          throw invalid('Each segment must be an object');
        }

        assertKey(segment.key, 'segment.key');
        assertName(segment.name, 'segment.name');
        assertConditions(
          segment.conditions,
          `project ${project.key}: segment ${segment.key}: conditions`,
        );

        if (segmentKeys.has(segment.key)) {
          throw invalid(
            `project ${project.key}: duplicate segment key ${segment.key}`,
          );
        }
        segmentKeys.add(segment.key);
      }
    }

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

        const type = flag.type ?? 'boolean';

        if (!FLAG_TYPES.includes(type)) {
          throw invalid(
            `flag ${flag.key}: type must be one of ${FLAG_TYPES.join(', ')}`,
          );
        }

        assertFlagValues(type, flag);

        if (typeof flag.enabled !== 'boolean') {
          throw invalid(`flag ${flag.key}: enabled must be a boolean`);
        }

        assertRollout(flag.rolloutPercentage, `flag ${flag.key}: rolloutPercentage`);

        if (flag.rules !== undefined) {
          const message = rulesError(flag.rules, `flag ${flag.key}: rules`);

          if (message) {
            throw invalid(message);
          }
        }

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

function toPercent(basisPoints) {
  return Number((basisPoints / 1000).toFixed(3));
}

function toExportedRule(rule) {
  if (typeof rule.segment_key === 'string') {
    return { segmentKey: rule.segment_key, action: rule.action };
  }

  return {
    conditions: JSON.parse(rule.inline_conditions),
    action: rule.action,
  };
}

function toExportedFlag(flag, rules) {
  const type = flag.type ?? 'boolean';
  const exported = {
    key: flag.key,
    type,
    description: flag.description,
    enabled: flag.enabled === 1,
    rolloutPercentage: toPercent(flag.rollout_basis_points),
    createdAt: flag.config_created_at > flag.flag_created_at
      ? flag.config_created_at
      : flag.flag_created_at,
    updatedAt: flag.config_updated_at > flag.flag_updated_at
      ? flag.config_updated_at
      : flag.flag_updated_at,
    rules: rules.map(toExportedRule),
  };

  if (type !== 'boolean') {
    exported.onValue = parseStoredValue(flag.on_value);
    exported.offValue = parseStoredValue(flag.off_value);
  }

  return exported;
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
    const segments = await db
      .selectFrom('segments')
      .selectAll()
      .where('project_id', '=', project.id)
      .orderBy('created_at', 'asc')
      .orderBy('key', 'asc')
      .execute();
    const exportedEnvironments = [];

    for (const environment of environments) {
      const flags = await db
        .selectFrom('flags')
        .innerJoin('flag_configs', 'flag_configs.flag_id', 'flags.id')
        .select([
          'flags.id as flag_id',
          'flags.key',
          'flags.type',
          'flags.description',
          'flags.created_at as flag_created_at',
          'flags.updated_at as flag_updated_at',
          'flag_configs.enabled',
          'flag_configs.rollout_basis_points',
          'flag_configs.on_value',
          'flag_configs.off_value',
          'flag_configs.created_at as config_created_at',
          'flag_configs.updated_at as config_updated_at',
        ])
        .where('flags.project_id', '=', project.id)
        .where('flag_configs.environment_id', '=', environment.id)
        .orderBy('flags.created_at', 'asc')
        .orderBy('flags.id', 'asc')
        .execute();
      const ruleRows = await db
        .selectFrom('flag_rules')
        .innerJoin('flags', 'flags.id', 'flag_rules.flag_id')
        .leftJoin('segments', 'segments.id', 'flag_rules.segment_id')
        .select([
          'flag_rules.flag_id',
          'flag_rules.action',
          'flag_rules.conditions as inline_conditions',
          'segments.key as segment_key',
        ])
        .where('flag_rules.environment_id', '=', environment.id)
        .where('flags.project_id', '=', project.id)
        .orderBy('flag_rules.position', 'asc')
        .execute();
      const rulesByFlag = new Map();

      for (const rule of ruleRows) {
        const rules = rulesByFlag.get(rule.flag_id) ?? [];

        rules.push(rule);
        rulesByFlag.set(rule.flag_id, rules);
      }

      exportedEnvironments.push({
        key: environment.key,
        name: environment.name,
        flags: flags.map((flag) => toExportedFlag(
          flag,
          rulesByFlag.get(flag.flag_id) ?? [],
        )),
      });
    }

    exported.push({
      key: project.key,
      name: project.name,
      environments: exportedEnvironments,
      segments: segments.map((segment) => ({
        key: segment.key,
        name: segment.name,
        conditions: JSON.parse(segment.conditions),
      })),
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

    for (const segment of project.segments ?? []) {
      summary.totalSegments += 1;

      const conditions = JSON.stringify(segment.conditions);
      const existing = await trx
        .selectFrom('segments')
        .selectAll()
        .where('project_id', '=', projectRow.id)
        .where('key', '=', segment.key)
        .executeTakeFirst();

      if (!existing) {
        await trx
          .insertInto('segments')
          .values({
            id: randomUUID(),
            project_id: projectRow.id,
            key: segment.key,
            name: segment.name,
            conditions,
            created_at: now,
            updated_at: now,
          })
          .execute();
        summary.segmentsCreated += 1;
      } else if (
        existing.name !== segment.name
        || existing.conditions !== conditions
      ) {
        await trx
          .updateTable('segments')
          .set({ name: segment.name, conditions, updated_at: now })
          .where('id', '=', existing.id)
          .execute();
        summary.segmentsUpdated += 1;
      }
    }

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

        const type = flag.type ?? 'boolean';
        const onValue = storedValue(type, flag.onValue);
        const offValue = storedValue(type, flag.offValue);
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
            type,
            description: flag.description ?? '',
            created_at: now,
            updated_at: now,
          };

          await trx.insertInto('flags').values(flagRow).execute();
          summary.flagsCreated += 1;
        } else {
          if (flagRow.type !== type) {
            throw invalid(
              `flag ${flag.key}: type ${type} does not match existing type ${flagRow.type}`,
            );
          }

          if (flagRow.description !== (flag.description ?? '')) {
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
              on_value: onValue,
              off_value: offValue,
              created_at: now,
              updated_at: now,
            })
            .execute();
          summary.configsCreated += 1;
        } else if (
          existingConfig.enabled !== enabled
          || existingConfig.rollout_basis_points !== rolloutBasisPoints
          || existingConfig.on_value !== onValue
          || existingConfig.off_value !== offValue
        ) {
          await trx
            .updateTable('flag_configs')
            .set({
              enabled,
              rollout_basis_points: rolloutBasisPoints,
              on_value: onValue,
              off_value: offValue,
              updated_at: now,
            })
            .where('id', '=', existingConfig.id)
            .execute();
          summary.configsUpdated += 1;
        }

        if (flag.rules !== undefined) {
          summary.totalRules += flag.rules.length;

          const desired = [];

          for (const rule of flag.rules) {
            if (rule.segmentKey !== undefined) {
              const segment = await trx
                .selectFrom('segments')
                .select('id')
                .where('project_id', '=', projectRow.id)
                .where('key', '=', rule.segmentKey)
                .executeTakeFirst();

              if (!segment) {
                throw invalid(
                  `flag ${flag.key}: segment ${rule.segmentKey} not found in project ${project.key}`,
                );
              }

              desired.push({
                segmentId: segment.id,
                conditions: null,
                action: rule.action,
              });
            } else {
              desired.push({
                segmentId: null,
                conditions: JSON.stringify(rule.conditions),
                action: rule.action,
              });
            }
          }

          const existingRules = await trx
            .selectFrom('flag_rules')
            .select(['segment_id', 'conditions', 'action'])
            .where('flag_id', '=', flagRow.id)
            .where('environment_id', '=', environmentRow.id)
            .orderBy('position', 'asc')
            .execute();
          const desiredSignature = JSON.stringify(desired);
          const existingSignature = JSON.stringify(existingRules.map((rule) => ({
            segmentId: rule.segment_id ?? null,
            conditions: rule.conditions ?? null,
            action: rule.action,
          })));

          if (desiredSignature !== existingSignature) {
            await trx
              .deleteFrom('flag_rules')
              .where('flag_id', '=', flagRow.id)
              .where('environment_id', '=', environmentRow.id)
              .execute();

            if (desired.length > 0) {
              await trx
                .insertInto('flag_rules')
                .values(desired.map((rule, position) => ({
                  id: randomUUID(),
                  flag_id: flagRow.id,
                  environment_id: environmentRow.id,
                  position,
                  segment_id: rule.segmentId,
                  conditions: rule.conditions,
                  action: rule.action,
                  created_at: now,
                  updated_at: now,
                })))
                .execute();
            }

            summary.rulesReplaced += 1;
            summary.rulesCreated += desired.length;
          }
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
    segmentsCreated: 0,
    segmentsUpdated: 0,
    rulesCreated: 0,
    rulesReplaced: 0,
    totalProjects: 0,
    totalEnvironments: 0,
    totalFlags: 0,
    totalConfigs: 0,
    totalSegments: 0,
    totalRules: 0,
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

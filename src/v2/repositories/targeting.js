import { randomUUID } from 'node:crypto';

import { AppError } from '../../errors.js';
import {
  conflict,
  isForeignKeyViolation,
  isUniqueViolation,
  notFound,
} from './common.js';

function parseConditions(value) {
  return JSON.parse(value);
}

function mapSegment(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    conditions: parseConditions(row.conditions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRule(row) {
  if (typeof row.segment_key === 'string') {
    return {
      position: row.position,
      action: row.action,
      segmentKey: row.segment_key,
    };
  }

  return {
    position: row.position,
    action: row.action,
    conditions: parseConditions(row.inline_conditions),
  };
}

function ruleQuery(db, projectId, environmentId) {
  return db
    .selectFrom('flag_rules')
    .innerJoin('flags', 'flags.id', 'flag_rules.flag_id')
    .leftJoin('segments', 'segments.id', 'flag_rules.segment_id')
    .select([
      'flag_rules.flag_id',
      'flag_rules.position',
      'flag_rules.action',
      'flag_rules.conditions as inline_conditions',
      'segments.key as segment_key',
    ])
    .where('flag_rules.environment_id', '=', environmentId)
    .where('flags.project_id', '=', projectId);
}

export function createTargetingRepository(db) {
  async function createSegment(projectId, { key, name, conditions }) {
    const now = new Date().toISOString();

    try {
      await db
        .insertInto('segments')
        .values({
          id: randomUUID(),
          project_id: projectId,
          key,
          name,
          conditions: JSON.stringify(conditions),
          created_at: now,
          updated_at: now,
        })
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('SEGMENT_EXISTS', 'Segment already exists');
      }
      throw error;
    }

    return getSegment(projectId, key);
  }

  async function listSegments(projectId) {
    const rows = await db
      .selectFrom('segments')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'asc')
      .orderBy('key', 'asc')
      .execute();

    return rows.map(mapSegment);
  }

  async function findSegment(projectId, key) {
    const row = await db
      .selectFrom('segments')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('key', '=', key)
      .executeTakeFirst();

    return row ? mapSegment(row) : null;
  }

  async function getSegment(projectId, key) {
    const segment = await findSegment(projectId, key);

    if (!segment) {
      throw notFound('SEGMENT_NOT_FOUND', 'Segment not found');
    }

    return segment;
  }

  async function updateSegment(projectId, key, { name, conditions }) {
    const result = await db
      .updateTable('segments')
      .set({
        name,
        conditions: JSON.stringify(conditions),
        updated_at: new Date().toISOString(),
      })
      .where('project_id', '=', projectId)
      .where('key', '=', key)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows ?? 0) === 0) {
      throw notFound('SEGMENT_NOT_FOUND', 'Segment not found');
    }

    return getSegment(projectId, key);
  }

  async function deleteSegment(projectId, key) {
    try {
      await db.transaction().execute(async (trx) => {
        const segment = await trx
          .selectFrom('segments')
          .select('id')
          .where('project_id', '=', projectId)
          .where('key', '=', key)
          .executeTakeFirst();

        if (!segment) {
          throw notFound('SEGMENT_NOT_FOUND', 'Segment not found');
        }

        const usage = await trx
          .selectFrom('flag_rules')
          .select('id')
          .where('segment_id', '=', segment.id)
          .execute();

        if (usage.length > 0) {
          throw conflict(
            'SEGMENT_IN_USE',
            `Segment '${key}' is referenced by ${usage.length} rule(s)`,
          );
        }

        await trx
          .deleteFrom('segments')
          .where('id', '=', segment.id)
          .execute();
      });
    } catch (error) {
      if (error?.code === 'SEGMENT_NOT_FOUND' || error?.code === 'SEGMENT_IN_USE') {
        throw error;
      }
      if (isForeignKeyViolation(error)) {
        throw conflict(
          'SEGMENT_IN_USE',
          `Segment '${key}' is referenced by one or more rules`,
        );
      }
      throw error;
    }

    return { key, deleted: true };
  }

  async function listRules(projectId, environmentId, flagId) {
    const rows = await ruleQuery(db, projectId, environmentId)
      .where('flag_rules.flag_id', '=', flagId)
      .orderBy('flag_rules.position', 'asc')
      .execute();

    return rows.map(mapRule);
  }

  async function listRulesForEnvironment(projectId, environmentId) {
    const rows = await ruleQuery(db, projectId, environmentId)
      .orderBy('flag_rules.position', 'asc')
      .execute();
    const byFlag = new Map();

    for (const row of rows) {
      const rules = byFlag.get(row.flag_id) ?? [];

      rules.push(mapRule(row));
      byFlag.set(row.flag_id, rules);
    }

    return byFlag;
  }

  async function replaceRules(projectId, environmentId, flagId, rules) {
    const segmentKeys = [
      ...new Set(
        rules
          .filter((rule) => typeof rule.segmentKey === 'string')
          .map((rule) => rule.segmentKey),
      ),
    ];
    const now = new Date().toISOString();

    try {
      await db.transaction().execute(async (trx) => {
        const segments = segmentKeys.length === 0
          ? []
          : await trx
            .selectFrom('segments')
            .select(['id', 'key'])
            .where('project_id', '=', projectId)
            .where('key', 'in', segmentKeys)
            .execute();
        const byKey = new Map(segments.map((segment) => [segment.key, segment.id]));
        const missing = segmentKeys.find((key) => !byKey.has(key));

        if (missing) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            `Segment '${missing}' not found in this project`,
          );
        }

        await trx
          .deleteFrom('flag_rules')
          .where('flag_id', '=', flagId)
          .where('environment_id', '=', environmentId)
          .execute();

        if (rules.length === 0) {
          return;
        }

        await trx
          .insertInto('flag_rules')
          .values(rules.map((rule, position) => ({
            id: randomUUID(),
            flag_id: flagId,
            environment_id: environmentId,
            position,
            segment_id: rule.segmentKey === undefined
              ? null
              : byKey.get(rule.segmentKey),
            conditions: rule.segmentKey === undefined
              ? JSON.stringify(rule.conditions)
              : null,
            action: rule.action,
            created_at: now,
            updated_at: now,
          })))
          .execute();
      });
    } catch (error) {
      if (isUniqueViolation(error) || isForeignKeyViolation(error)) {
        throw conflict(
          'RULE_CONFLICT',
          'Rules or segments changed concurrently; retry the request',
        );
      }
      throw error;
    }

    return listRules(projectId, environmentId, flagId);
  }

  return {
    createSegment,
    listSegments,
    findSegment,
    getSegment,
    updateSegment,
    deleteSegment,
    listRules,
    listRulesForEnvironment,
    replaceRules,
  };
}

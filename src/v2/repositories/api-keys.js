import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { isUniqueViolation, notFound } from './common.js';

export function hashApiKey(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateApiKey(type = 'server') {
  const prefixPart = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const prefix = `sb_${type === 'client' ? 'cli' : 'srv'}_${prefixPart}`;
  const key = `${prefix}_${secret}`;

  return { key, prefix, hash: hashApiKey(key) };
}

export function apiKeysMatch(provided, storedHash) {
  const providedHash = Buffer.from(hashApiKey(provided), 'hex');
  const expectedHash = Buffer.from(storedHash, 'hex');

  return providedHash.length === expectedHash.length
    && timingSafeEqual(providedHash, expectedHash);
}

export function createApiKeyRepository(db) {
  async function createApiKey({
    environmentId,
    name,
    type = 'server',
  }) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const generated = generateApiKey(type);
      const now = new Date().toISOString();
      const row = {
        id: randomUUID(),
        environment_id: environmentId,
        type,
        name,
        prefix: generated.prefix,
        hash: generated.hash,
        created_at: now,
        last_used_at: null,
        revoked_at: null,
      };

      try {
        await db.insertInto('api_keys').values(row).execute();

        return {
          id: row.id,
          name: row.name,
          type: row.type,
          prefix: row.prefix,
          key: generated.key,
          createdAt: row.created_at,
        };
      } catch (error) {
        if (isUniqueViolation(error) && attempt < 4) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Could not generate a unique API key prefix');
  }

  async function listApiKeys(environmentId) {
    const rows = await db
      .selectFrom('api_keys')
      .select([
        'id',
        'name',
        'type',
        'prefix',
        'created_at',
        'last_used_at',
        'revoked_at',
      ])
      .where('environment_id', '=', environmentId)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      prefix: row.prefix,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at,
    }));
  }

  async function revokeApiKey(environmentId, id) {
    const result = await db
      .updateTable('api_keys')
      .set({ revoked_at: new Date().toISOString() })
      .where('environment_id', '=', environmentId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows ?? 0) === 0) {
      throw notFound('API_KEY_NOT_FOUND', 'API key not found');
    }

    return { id, revoked: true };
  }

  async function findApiKeyByPrefix(prefix) {
    const row = await db
      .selectFrom('api_keys')
      .innerJoin('environments', 'environments.id', 'api_keys.environment_id')
      .innerJoin('projects', 'projects.id', 'environments.project_id')
      .select([
        'api_keys.id as key_id',
        'api_keys.hash',
        'api_keys.type',
        'api_keys.revoked_at',
        'api_keys.last_used_at',
        'environments.id as environment_id',
        'environments.key as environment_key',
        'environments.name as environment_name',
        'projects.id as project_id',
        'projects.key as project_key',
        'projects.name as project_name',
      ])
      .where('api_keys.prefix', '=', prefix)
      .executeTakeFirst();

    return row ?? null;
  }

  async function touchApiKey(id, lastUsedAt) {
    if (lastUsedAt) {
      const age = Date.now() - new Date(lastUsedAt).getTime();

      if (Number.isFinite(age) && age >= 0 && age < 60_000) {
        return;
      }
    }

    await db
      .updateTable('api_keys')
      .set({ last_used_at: new Date().toISOString() })
      .where('id', '=', id)
      .execute();
  }

  return {
    createApiKey,
    listApiKeys,
    revokeApiKey,
    findApiKeyByPrefix,
    touchApiKey,
  };
}

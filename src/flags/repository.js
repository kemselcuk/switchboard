const SELECT_COLUMNS = `
  id,
  key,
  description,
  enabled,
  rollout_percentage,
  created_at,
  updated_at
`;

function toFlag(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    key: row.key,
    description: row.description,
    enabled: row.enabled === 1,
    rolloutPercentage: row.rollout_percentage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class FlagExistsError extends Error {
  constructor(key, options) {
    super(`Flag already exists: ${key}`, options);
    this.name = 'FlagExistsError';
    this.code = 'FLAG_EXISTS';
    this.flagKey = key;
  }
}

export class FlagNotFoundError extends Error {
  constructor(key) {
    super(`Flag not found: ${key}`);
    this.name = 'FlagNotFoundError';
    this.code = 'FLAG_NOT_FOUND';
    this.flagKey = key;
  }
}

export function createRepository(db) {
  const insertFlag = db.prepare(`
    INSERT INTO flags (key, description, enabled, rollout_percentage, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectByKey = db.prepare(`SELECT ${SELECT_COLUMNS} FROM flags WHERE key = ?`);
  const selectAll = db.prepare(`SELECT ${SELECT_COLUMNS} FROM flags ORDER BY id ASC`);

  function getFlag(key) {
    return toFlag(selectByKey.get(key));
  }

  function listFlags() {
    return selectAll.all().map(toFlag);
  }

  function createFlag({
    key,
    description = '',
    enabled = false,
    rolloutPercentage = 0,
  } = {}) {
    const now = new Date().toISOString();

    try {
      insertFlag.run(key, description, enabled ? 1 : 0, rolloutPercentage, now, now);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new FlagExistsError(key, { cause: error });
      }
      throw error;
    }

    return getFlag(key);
  }

  function updateFlag(key, patch = {}) {
    const assignments = [];
    const values = [];

    if (patch.description !== undefined) {
      assignments.push('description = ?');
      values.push(patch.description);
    }
    if (patch.enabled !== undefined) {
      assignments.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (patch.rolloutPercentage !== undefined) {
      assignments.push('rollout_percentage = ?');
      values.push(patch.rolloutPercentage);
    }

    if (assignments.length === 0) {
      const existing = getFlag(key);
      if (!existing) {
        throw new FlagNotFoundError(key);
      }
      return existing;
    }

    assignments.push('updated_at = ?');
    values.push(new Date().toISOString(), key);

    const result = db
      .prepare(`UPDATE flags SET ${assignments.join(', ')} WHERE key = ?`)
      .run(...values);

    if (result.changes === 0) {
      throw new FlagNotFoundError(key);
    }

    return getFlag(key);
  }

  return {
    createFlag,
    listFlags,
    getFlag,
    updateFlag,
  };
}

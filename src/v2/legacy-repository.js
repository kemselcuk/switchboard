import {
  FlagExistsError,
  FlagNotFoundError,
} from '../flags/repository.js';
import { createFlagRepository } from './repositories/flags.js';

function toLegacyFlag(flag) {
  return {
    id: flag.legacyId,
    key: flag.key,
    description: flag.description,
    enabled: flag.enabled,
    rolloutPercentage: Math.round(flag.rolloutBasisPoints / 1000),
    createdAt: flag.createdAt,
    updatedAt: flag.updatedAt,
  };
}

export function createLegacyRepository(db, { projectId, environmentId }) {
  const flags = createFlagRepository(db);

  async function createFlag({
    key,
    description = '',
    enabled = false,
    rolloutPercentage = 0,
  } = {}) {
    const existing = await flags.findFlag(projectId, environmentId, key);

    if (existing) {
      throw new FlagExistsError(key);
    }

    try {
      const flag = await flags.createFlagInEnvironment({
        projectId,
        environmentId,
        key,
        type: 'boolean',
        description,
        enabled,
        rolloutBasisPoints: rolloutPercentage * 1000,
      });

      return toLegacyFlag(flag);
    } catch (error) {
      if (error?.code === 'FLAG_EXISTS') {
        throw new FlagExistsError(key, { cause: error });
      }
      throw error;
    }
  }

  async function listFlags() {
    const rows = await flags.listFlags(projectId, environmentId);

    return rows
      .filter((flag) => flag.type === 'boolean')
      .map(toLegacyFlag);
  }

  async function getFlag(key) {
    const flag = await flags.findFlag(projectId, environmentId, key);

    return flag && flag.type === 'boolean' ? toLegacyFlag(flag) : null;
  }

  async function updateFlag(key, patch = {}) {
    const existing = await flags.findFlag(projectId, environmentId, key);

    if (!existing || existing.type !== 'boolean') {
      throw new FlagNotFoundError(key);
    }

    const hasPatch = patch.description !== undefined
      || patch.enabled !== undefined
      || patch.rolloutPercentage !== undefined;

    if (!hasPatch) {
      return toLegacyFlag(existing);
    }

    try {
      const updated = await flags.updateFlag(projectId, environmentId, key, {
        description: patch.description,
        enabled: patch.enabled,
        rolloutBasisPoints: patch.rolloutPercentage === undefined
          ? undefined
          : patch.rolloutPercentage * 1000,
      });

      return toLegacyFlag(updated);
    } catch (error) {
      if (error?.code === 'FLAG_NOT_FOUND') {
        throw new FlagNotFoundError(key);
      }
      throw error;
    }
  }

  return {
    createFlag,
    listFlags,
    getFlag,
    updateFlag,
  };
}

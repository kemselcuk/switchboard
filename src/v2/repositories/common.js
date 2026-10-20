import { AppError } from '../../errors.js';

export function isUniqueViolation(error) {
  return error?.code === '23505'
    || /unique constraint failed/i.test(error?.message ?? '');
}

export function conflict(code, message) {
  return new AppError(409, code, message);
}

export function notFound(code, message) {
  return new AppError(404, code, message);
}

export function mapProject(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEnvironment(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFlag(row) {
  const updatedAt = row.config_updated_at > row.flag_updated_at
    ? row.config_updated_at
    : row.flag_updated_at;

  return {
    id: row.flag_id,
    legacyId: row.legacy_id,
    key: row.key,
    type: row.type,
    description: row.description,
    enabled: row.enabled === 1,
    rolloutBasisPoints: row.rollout_basis_points,
    createdAt: row.flag_created_at,
    updatedAt,
  };
}

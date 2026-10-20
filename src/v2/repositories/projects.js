import { randomUUID } from 'node:crypto';

import {
  conflict,
  isUniqueViolation,
  mapEnvironment,
  mapProject,
  notFound,
} from './common.js';

export function createProjectRepository(db) {
  async function createProject({ key, name }) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      key,
      name,
      created_at: now,
      updated_at: now,
    };

    try {
      await db.insertInto('projects').values(row).execute();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('PROJECT_EXISTS', 'Project already exists');
      }
      throw error;
    }

    return mapProject(row);
  }

  async function listProjects() {
    const rows = await db
      .selectFrom('projects')
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(mapProject);
  }

  async function findProjectByKey(key) {
    const row = await db
      .selectFrom('projects')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst();

    return row ? mapProject(row) : null;
  }

  async function getProjectByKey(key) {
    const project = await findProjectByKey(key);

    if (!project) {
      throw notFound('PROJECT_NOT_FOUND', 'Project not found');
    }

    return project;
  }

  async function createEnvironment(projectId, { key, name }) {
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      project_id: projectId,
      key,
      name,
      created_at: now,
      updated_at: now,
    };

    try {
      await db.insertInto('environments').values(row).execute();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('ENVIRONMENT_EXISTS', 'Environment already exists');
      }
      throw error;
    }

    return mapEnvironment(row);
  }

  async function listEnvironments(projectId) {
    const rows = await db
      .selectFrom('environments')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(mapEnvironment);
  }

  async function findEnvironment(projectId, key) {
    const row = await db
      .selectFrom('environments')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('key', '=', key)
      .executeTakeFirst();

    return row ? mapEnvironment(row) : null;
  }

  async function getEnvironment(projectId, key) {
    const environment = await findEnvironment(projectId, key);

    if (!environment) {
      throw notFound('ENVIRONMENT_NOT_FOUND', 'Environment not found');
    }

    return environment;
  }

  return {
    createProject,
    listProjects,
    findProjectByKey,
    getProjectByKey,
    createEnvironment,
    listEnvironments,
    findEnvironment,
    getEnvironment,
  };
}

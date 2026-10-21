import { createAuthHook } from '../../auth.js';
import { AppError } from '../../errors.js';
import { createApiKeyRepository } from '../repositories/api-keys.js';
import { createFlagRepository } from '../repositories/flags.js';
import { createProjectRepository } from '../repositories/projects.js';
import {
  apiKeyParams,
  createApiKeyBody,
  createFlagBody,
  environmentBody,
  environmentParams,
  flagParams,
  flagValuesError,
  projectBody,
  projectFlagParams,
  projectParams,
  updateFlagBody,
} from '../schemas.js';

function validationError(message) {
  return new AppError(400, 'VALIDATION_ERROR', message);
}

function assertFlagValues(type, onValue, offValue) {
  const message = flagValuesError(type, onValue, offValue);

  if (message) {
    throw validationError(message);
  }
}

function rolloutToBasisPoints(value) {
  if (value === undefined) {
    return undefined;
  }

  const basisPoints = Math.round(value * 1000);

  if (Math.abs(basisPoints - value * 1000) > 1e-6) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'rolloutPercentage supports at most three decimal places',
    );
  }

  return basisPoints;
}

function toFlagResponse(flag) {
  const response = {
    id: flag.id,
    key: flag.key,
    type: flag.type,
    description: flag.description,
    enabled: flag.enabled,
    rolloutPercentage: Number((flag.rolloutBasisPoints / 1000).toFixed(3)),
    createdAt: flag.createdAt,
    updatedAt: flag.updatedAt,
  };

  if ((flag.type ?? 'boolean') !== 'boolean') {
    response.onValue = flag.onValue;
    response.offValue = flag.offValue;
  }

  return response;
}

export async function managementRoutes(app, { db, adminToken }) {
  const projects = createProjectRepository(db);
  const flags = createFlagRepository(db);
  const apiKeys = createApiKeyRepository(db);

  app.addHook('onRequest', createAuthHook(adminToken));

  async function resolveEnvironment(request) {
    const project = await projects.getProjectByKey(request.params.project);
    const environment = await projects.getEnvironment(
      project.id,
      request.params.env,
    );

    return { project, environment };
  }

  app.post(
    '/api/v1/projects',
    { schema: { body: projectBody } },
    async (request, reply) => {
      const project = await projects.createProject(request.body);

      return reply.code(201).send(project);
    },
  );

  app.get('/api/v1/projects', async () => ({
    projects: await projects.listProjects(),
  }));

  app.post(
    '/api/v1/projects/:project/environments',
    { schema: { params: projectParams, body: environmentBody } },
    async (request, reply) => {
      const project = await projects.getProjectByKey(request.params.project);
      const environment = await projects.createEnvironment(
        project.id,
        request.body,
      );

      return reply.code(201).send(environment);
    },
  );

  app.get(
    '/api/v1/projects/:project/environments',
    { schema: { params: projectParams } },
    async (request) => {
      const project = await projects.getProjectByKey(request.params.project);

      return {
        environments: await projects.listEnvironments(project.id),
      };
    },
  );

  app.post(
    '/api/v1/projects/:project/environments/:env/flags',
    { schema: { params: environmentParams, body: createFlagBody } },
    async (request, reply) => {
      const { project, environment } = await resolveEnvironment(request);
      const body = request.body;
      const type = body.type ?? 'boolean';

      assertFlagValues(type, body.onValue, body.offValue);

      const flag = await flags.createFlagInEnvironment({
        projectId: project.id,
        environmentId: environment.id,
        key: body.key,
        type,
        description: body.description ?? '',
        enabled: body.enabled ?? false,
        rolloutBasisPoints: rolloutToBasisPoints(body.rolloutPercentage) ?? 0,
        onValue: body.onValue,
        offValue: body.offValue,
      });

      return reply.code(201).send(toFlagResponse(flag));
    },
  );

  app.get(
    '/api/v1/projects/:project/environments/:env/flags',
    { schema: { params: environmentParams } },
    async (request) => {
      const { project, environment } = await resolveEnvironment(request);
      const list = await flags.listFlags(project.id, environment.id);

      return { flags: list.map(toFlagResponse) };
    },
  );

  app.delete(
    '/api/v1/projects/:project/flags/:key',
    { schema: { params: projectFlagParams } },
    async (request) => {
      const project = await projects.getProjectByKey(request.params.project);

      return flags.deleteFlag(project.id, request.params.key);
    },
  );

  app.get(
    '/api/v1/projects/:project/environments/:env/flags/:key',
    { schema: { params: flagParams } },
    async (request) => {
      const { project, environment } = await resolveEnvironment(request);
      const flag = await flags.getFlag(
        project.id,
        environment.id,
        request.params.key,
      );

      return toFlagResponse(flag);
    },
  );

  app.patch(
    '/api/v1/projects/:project/environments/:env/flags/:key',
    { schema: { params: flagParams, body: updateFlagBody } },
    async (request) => {
      const { project, environment } = await resolveEnvironment(request);
      const body = request.body;
      const existing = await flags.getFlag(
        project.id,
        environment.id,
        request.params.key,
      );
      const type = existing.type ?? 'boolean';

      if (type === 'boolean') {
        assertFlagValues(type, body.onValue, body.offValue);
      } else {
        assertFlagValues(
          type,
          body.onValue === undefined ? existing.onValue : body.onValue,
          body.offValue === undefined ? existing.offValue : body.offValue,
        );
      }

      const flag = await flags.updateFlag(
        project.id,
        environment.id,
        request.params.key,
        {
          description: body.description,
          enabled: body.enabled,
          rolloutBasisPoints: rolloutToBasisPoints(body.rolloutPercentage),
          onValue: type === 'boolean' ? undefined : body.onValue,
          offValue: type === 'boolean' ? undefined : body.offValue,
        },
      );

      return toFlagResponse(flag);
    },
  );

  app.post(
    '/api/v1/projects/:project/environments/:env/api-keys',
    { schema: { params: environmentParams, body: createApiKeyBody } },
    async (request, reply) => {
      const { environment } = await resolveEnvironment(request);
      const key = await apiKeys.createApiKey({
        environmentId: environment.id,
        name: request.body.name,
        type: request.body.type ?? 'server',
      });

      return reply.code(201).send(key);
    },
  );

  app.get(
    '/api/v1/projects/:project/environments/:env/api-keys',
    { schema: { params: environmentParams } },
    async (request) => {
      const { environment } = await resolveEnvironment(request);

      return {
        apiKeys: await apiKeys.listApiKeys(environment.id),
      };
    },
  );

  app.delete(
    '/api/v1/projects/:project/environments/:env/api-keys/:id',
    { schema: { params: apiKeyParams } },
    async (request) => {
      const { environment } = await resolveEnvironment(request);

      return apiKeys.revokeApiKey(environment.id, request.params.id);
    },
  );
}

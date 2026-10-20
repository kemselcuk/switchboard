import { buildApp } from '../../src/app.js';
import { initializeV2Database } from '../../src/v2/db.js';

export const ADMIN_TOKEN = 'test-admin-token';
export const AUTHORIZATION = {
  authorization: `Bearer ${ADMIN_TOKEN}`,
};

export async function createV2App(t) {
  const v2 = await initializeV2Database();
  const app = buildApp({
    v2,
    adminToken: ADMIN_TOKEN,
  });

  t.after(() => app.close());

  return { app, v2 };
}

export async function createProject(app, key = 'demo', name = 'Demo') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers: AUTHORIZATION,
    payload: { key, name },
  });

  if (response.statusCode !== 201) {
    throw new Error(`createProject failed: ${response.statusCode} ${response.body}`);
  }

  return response.json();
}

export async function createEnvironment(
  app,
  projectKey,
  key = 'production',
  name = 'Production',
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectKey}/environments`,
    headers: AUTHORIZATION,
    payload: { key, name },
  });

  if (response.statusCode !== 201) {
    throw new Error(`createEnvironment failed: ${response.statusCode} ${response.body}`);
  }

  return response.json();
}

export async function createFlag(
  app,
  projectKey,
  environmentKey,
  payload = {},
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectKey}/environments/${environmentKey}/flags`,
    headers: AUTHORIZATION,
    payload: {
      key: 'new-checkout',
      description: 'New checkout',
      enabled: true,
      rolloutPercentage: 40,
      ...payload,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`createFlag failed: ${response.statusCode} ${response.body}`);
  }

  return response.json();
}

export async function createApiKey(
  app,
  projectKey,
  environmentKey,
  name = 'server key',
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectKey}/environments/${environmentKey}/api-keys`,
    headers: AUTHORIZATION,
    payload: { name },
  });

  if (response.statusCode !== 201) {
    throw new Error(`createApiKey failed: ${response.statusCode} ${response.body}`);
  }

  return response.json();
}

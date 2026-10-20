import { createAuthHook } from '../auth.js';
import { FlagNotFoundError } from './repository.js';
import {
  createFlagBody,
  flagKeyParams,
  updateFlagBody,
} from './schemas.js';

export async function flagRoutes(app, { adminToken } = {}) {
  app.addHook('onRequest', createAuthHook(adminToken));

  app.post(
    '/api/flags',
    { schema: { body: createFlagBody } },
    async (request, reply) => {
      const {
        key,
        description = '',
        enabled = false,
        rolloutPercentage = 0,
      } = request.body;

      const flag = await app.repository.createFlag({
        key,
        description,
        enabled,
        rolloutPercentage,
      });

      return reply.code(201).send(flag);
    },
  );

  app.get('/api/flags', async () => ({
    flags: await app.repository.listFlags(),
  }));

  app.get(
    '/api/flags/:key',
    { schema: { params: flagKeyParams } },
    async (request) => {
      const flag = await app.repository.getFlag(request.params.key);

      if (!flag) {
        throw new FlagNotFoundError(request.params.key);
      }

      return flag;
    },
  );

  app.patch(
    '/api/flags/:key',
    { schema: { params: flagKeyParams, body: updateFlagBody } },
    async (request) => await app.repository.updateFlag(
      request.params.key,
      request.body,
    ),
  );
}

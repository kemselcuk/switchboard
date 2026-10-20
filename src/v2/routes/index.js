import { managementRoutes } from './management.js';
import { ofrepRoutes } from './ofrep.js';

export async function registerV2Routes(app, { db, adminToken }) {
  await app.register(managementRoutes, { db, adminToken });
  await app.register(ofrepRoutes, { db });
}

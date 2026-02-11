import { Router, type Router as RouterType } from 'express';
import { registerDeleteIdRoute } from './organizations/delete-id.js';
import { registerGetIdRoute } from './organizations/get-id.js';
import { registerGetIdGroupsRoute } from './organizations/get-id-groups.js';
import { registerGetIdUsersRoute } from './organizations/get-id-users.js';
import { registerGetRootRoute } from './organizations/get-root.js';
import { registerPostRootRoute } from './organizations/post-root.js';
import { registerPutIdRoute } from './organizations/put-id.js';

const organizationsRouter: RouterType = Router();
registerGetRootRoute(organizationsRouter);
registerPostRootRoute(organizationsRouter);
registerGetIdRoute(organizationsRouter);
registerGetIdUsersRoute(organizationsRouter);
registerGetIdGroupsRoute(organizationsRouter);
registerPutIdRoute(organizationsRouter);
registerDeleteIdRoute(organizationsRouter);

export { organizationsRouter };

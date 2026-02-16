import { Router, type Router as RouterType } from 'express';
import { registerDeleteIdRoute } from './organizations/deleteId.js';
import { registerGetIdRoute } from './organizations/getId.js';
import { registerGetIdGroupsRoute } from './organizations/getIdGroups.js';
import { registerGetIdUsersRoute } from './organizations/getIdUsers.js';
import { registerGetRootRoute } from './organizations/getRoot.js';
import { registerPostRootRoute } from './organizations/postRoot.js';
import { registerPutIdRoute } from './organizations/putId.js';

const organizationsRouter: RouterType = Router();
registerGetRootRoute(organizationsRouter);
registerPostRootRoute(organizationsRouter);
registerGetIdRoute(organizationsRouter);
registerGetIdUsersRoute(organizationsRouter);
registerGetIdGroupsRoute(organizationsRouter);
registerPutIdRoute(organizationsRouter);
registerDeleteIdRoute(organizationsRouter);

export { organizationsRouter };

import { Router, type Router as RouterType } from 'express';
import { registerGetIdRoute } from './users/getId.js';
import { registerGetRootRoute } from './users/getRoot.js';
import { registerPatchIdRoute } from './users/patchId.js';

const usersRouter: RouterType = Router();
registerGetRootRoute(usersRouter);
registerGetIdRoute(usersRouter);
registerPatchIdRoute(usersRouter);

export { usersRouter };

import { Router, type Router as RouterType } from 'express';
import { registerGetIdRoute } from './users/get-id.js';
import { registerGetRootRoute } from './users/get-root.js';
import { registerPatchIdRoute } from './users/patch-id.js';

const usersRouter: RouterType = Router();
registerGetRootRoute(usersRouter);
registerGetIdRoute(usersRouter);
registerPatchIdRoute(usersRouter);

export { usersRouter };

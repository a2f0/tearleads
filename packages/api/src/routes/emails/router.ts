import { Router, type Router as RouterType } from 'express';
import { registerDeleteIdRoute } from './deleteId.js';
import { registerGetIdRoute } from './getId.js';
import { registerGetRootRoute } from './getRoot.js';

const emailsRouter: RouterType = Router();
registerGetRootRoute(emailsRouter);
registerGetIdRoute(emailsRouter);
registerDeleteIdRoute(emailsRouter);

export { emailsRouter };

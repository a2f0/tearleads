import { Router, type Router as RouterType } from 'express';
import { registerDeleteIdRoute } from './emails/delete-id.js';
import { registerGetIdRoute } from './emails/get-id.js';
import { registerGetRootRoute } from './emails/get-root.js';

const emailsRouter: RouterType = Router();
registerGetRootRoute(emailsRouter);
registerGetIdRoute(emailsRouter);
registerDeleteIdRoute(emailsRouter);

export { emailsRouter };

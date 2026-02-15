import { Router, type Router as RouterType } from 'express';
import { registerDeleteIdRoute } from './emails/deleteId.js';
import { registerGetIdRoute } from './emails/getId.js';
import { registerGetRootRoute } from './emails/getRoot.js';

const emailsRouter: RouterType = Router();
registerGetRootRoute(emailsRouter);
registerGetIdRoute(emailsRouter);
registerDeleteIdRoute(emailsRouter);

export { emailsRouter };

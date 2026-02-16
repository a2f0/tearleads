import { Router, type Router as RouterType } from 'express';
import { registerPostWebhooksRoute } from './revenuecat/postWebhooks.js';

const revenuecatRouter: RouterType = Router();
registerPostWebhooksRoute(revenuecatRouter);

export { revenuecatRouter };

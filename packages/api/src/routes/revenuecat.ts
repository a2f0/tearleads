import { Router, type Router as RouterType } from 'express';
import { registerPostWebhooksRoute } from './revenuecat/post-webhooks.js';

const revenuecatRouter: RouterType = Router();
registerPostWebhooksRoute(revenuecatRouter);

export { revenuecatRouter };

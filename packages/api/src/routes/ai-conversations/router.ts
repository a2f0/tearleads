import { Router, type Router as RouterType } from 'express';
import { registerGetUsageRoute } from './getUsage.js';
import { registerGetUsageSummaryRoute } from './getUsageSummary.js';
import { registerPostUsageRoute } from './postUsage.js';

const aiConversationsRouter: RouterType = Router();
registerPostUsageRoute(aiConversationsRouter);
registerGetUsageRoute(aiConversationsRouter);
registerGetUsageSummaryRoute(aiConversationsRouter);

export { aiConversationsRouter };

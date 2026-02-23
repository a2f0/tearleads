import { Router, type Router as RouterType } from 'express';
import { registerDeleteConversationsIdRoute } from './deleteConversationsId.js';
import { registerGetConversationsRoute } from './getConversations.js';
import { registerGetConversationsIdRoute } from './getConversationsId.js';
import { registerGetUsageRoute } from './getUsage.js';
import { registerGetUsageSummaryRoute } from './getUsageSummary.js';
import { registerPatchConversationsIdRoute } from './patchConversationsId.js';
import { registerPostConversationsRoute } from './postConversations.js';
import { registerPostConversationsIdMessagesRoute } from './postConversationsIdMessages.js';
import { registerPostUsageRoute } from './postUsage.js';

const aiConversationsRouter: RouterType = Router();
registerPostConversationsRoute(aiConversationsRouter);
registerGetConversationsRoute(aiConversationsRouter);
registerGetConversationsIdRoute(aiConversationsRouter);
registerPatchConversationsIdRoute(aiConversationsRouter);
registerDeleteConversationsIdRoute(aiConversationsRouter);
registerPostConversationsIdMessagesRoute(aiConversationsRouter);
registerPostUsageRoute(aiConversationsRouter);
registerGetUsageRoute(aiConversationsRouter);
registerGetUsageSummaryRoute(aiConversationsRouter);

export { aiConversationsRouter };

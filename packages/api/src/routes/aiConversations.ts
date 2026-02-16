import { Router, type Router as RouterType } from 'express';
import { registerDeleteConversationsIdRoute } from './ai-conversations/deleteConversationsId.js';
import { registerGetConversationsRoute } from './ai-conversations/getConversations.js';
import { registerGetConversationsIdRoute } from './ai-conversations/getConversationsId.js';
import { registerGetUsageRoute } from './ai-conversations/getUsage.js';
import { registerGetUsageSummaryRoute } from './ai-conversations/getUsageSummary.js';
import { registerPatchConversationsIdRoute } from './ai-conversations/patchConversationsId.js';
import { registerPostConversationsRoute } from './ai-conversations/postConversations.js';
import { registerPostConversationsIdMessagesRoute } from './ai-conversations/postConversationsIdMessages.js';
import { registerPostUsageRoute } from './ai-conversations/postUsage.js';

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

import { Router, type Router as RouterType } from 'express';
import { registerDeleteConversationsIdRoute } from './ai-conversations/delete-conversations-id.js';
import { registerGetConversationsRoute } from './ai-conversations/get-conversations.js';
import { registerGetConversationsIdRoute } from './ai-conversations/get-conversations-id.js';
import { registerGetUsageRoute } from './ai-conversations/get-usage.js';
import { registerGetUsageSummaryRoute } from './ai-conversations/get-usage-summary.js';
import { registerPatchConversationsIdRoute } from './ai-conversations/patch-conversations-id.js';
import { registerPostConversationsRoute } from './ai-conversations/post-conversations.js';
import { registerPostConversationsIdMessagesRoute } from './ai-conversations/post-conversations-id-messages.js';
import { registerPostUsageRoute } from './ai-conversations/post-usage.js';

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

import type { Router as RouterType } from 'express';
import { postConversationsIdMessagesHandler } from '../ai-conversations.js';

export function registerPostConversationsIdMessagesRoute(routeRouter: RouterType): void {
  routeRouter.post('/conversations/:id/messages', postConversationsIdMessagesHandler);
}

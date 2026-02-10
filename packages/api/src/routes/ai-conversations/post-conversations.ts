import type { Router as RouterType } from 'express';
import { postConversationsHandler } from '../ai-conversations.js';

export function registerPostConversationsRoute(routeRouter: RouterType): void {
  routeRouter.post('/conversations', postConversationsHandler);
}

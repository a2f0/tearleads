/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getConversationsHandler } from '../ai-conversations.js';

export function registerGetConversationsRoute(routeRouter: RouterType): void {
  routeRouter.get('/conversations', getConversationsHandler);
}

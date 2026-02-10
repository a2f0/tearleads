/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getConversationsIdHandler } from '../ai-conversations.js';

export function registerGetConversationsIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/conversations/:id', getConversationsIdHandler);
}

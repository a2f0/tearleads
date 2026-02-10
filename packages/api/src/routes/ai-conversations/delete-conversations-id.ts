import type { Router as RouterType } from 'express';
import { deleteConversationsIdHandler } from '../ai-conversations.js';

export function registerDeleteConversationsIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/conversations/:id', deleteConversationsIdHandler);
}

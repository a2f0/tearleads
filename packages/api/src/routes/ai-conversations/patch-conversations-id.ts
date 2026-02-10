/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { patchConversationsIdHandler } from '../ai-conversations.js';

export function registerPatchConversationsIdRoute(
  routeRouter: RouterType
): void {
  routeRouter.patch('/conversations/:id', patchConversationsIdHandler);
}

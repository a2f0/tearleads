/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getGroupsGroupidMessagesHandler } from './handlers.js';

export function registerGetGroupsGroupidMessagesRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/groups/:groupId/messages', getGroupsGroupidMessagesHandler);
}

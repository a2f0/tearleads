/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postGroupsGroupidMessagesHandler } from '../mls.js';

export function registerPostGroupsGroupidMessagesRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/groups/:groupId/messages',
    postGroupsGroupidMessagesHandler
  );
}

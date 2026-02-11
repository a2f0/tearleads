/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postGroupsGroupidStateHandler } from './handlers.js';

export function registerPostGroupsGroupidStateRoute(
  routeRouter: RouterType
): void {
  routeRouter.post('/groups/:groupId/state', postGroupsGroupidStateHandler);
}

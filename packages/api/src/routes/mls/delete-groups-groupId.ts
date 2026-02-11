/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { deleteGroupsGroupidHandler } from './handlers.js';

export function registerDeleteGroupsGroupidRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/groups/:groupId', deleteGroupsGroupidHandler);
}

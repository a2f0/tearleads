/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getGroupsGroupidHandler } from './handlers.js';

export function registerGetGroupsGroupidRoute(routeRouter: RouterType): void {
  routeRouter.get('/groups/:groupId', getGroupsGroupidHandler);
}

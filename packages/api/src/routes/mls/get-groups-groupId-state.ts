import type { Router as RouterType } from 'express';
import { getGroupsGroupidStateHandler } from '../mls.js';

export function registerGetGroupsGroupidStateRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/groups/:groupId/state', getGroupsGroupidStateHandler);
}

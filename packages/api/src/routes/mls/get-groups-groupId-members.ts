/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getGroupsGroupidMembersHandler } from './handlers.js';

export function registerGetGroupsGroupidMembersRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/groups/:groupId/members', getGroupsGroupidMembersHandler);
}

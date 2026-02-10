import type { Router as RouterType } from 'express';
import { getGroupsGroupidMembersHandler } from '../mls.js';

export function registerGetGroupsGroupidMembersRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/groups/:groupId/members', getGroupsGroupidMembersHandler);
}

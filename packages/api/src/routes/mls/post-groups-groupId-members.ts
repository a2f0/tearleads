/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postGroupsGroupidMembersHandler } from './handlers.js';

export function registerPostGroupsGroupidMembersRoute(
  routeRouter: RouterType
): void {
  routeRouter.post('/groups/:groupId/members', postGroupsGroupidMembersHandler);
}

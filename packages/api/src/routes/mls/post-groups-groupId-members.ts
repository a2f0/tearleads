import type { Router as RouterType } from 'express';
import { postGroupsGroupidMembersHandler } from '../mls.js';

export function registerPostGroupsGroupidMembersRoute(routeRouter: RouterType): void {
  routeRouter.post('/groups/:groupId/members', postGroupsGroupidMembersHandler);
}

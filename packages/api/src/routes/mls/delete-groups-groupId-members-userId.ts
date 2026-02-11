/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { deleteGroupsGroupidMembersUseridHandler } from './handlers.js';

export function registerDeleteGroupsGroupidMembersUseridRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete(
    '/groups/:groupId/members/:userId',
    deleteGroupsGroupidMembersUseridHandler
  );
}

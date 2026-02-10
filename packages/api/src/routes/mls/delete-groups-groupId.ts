import type { Router as RouterType } from 'express';
import { deleteGroupsGroupidHandler } from '../mls.js';

export function registerDeleteGroupsGroupidRoute(routeRouter: RouterType): void {
  routeRouter.delete('/groups/:groupId', deleteGroupsGroupidHandler);
}

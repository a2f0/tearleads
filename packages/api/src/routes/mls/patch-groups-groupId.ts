/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { patchGroupsGroupidHandler } from '../mls.js';

export function registerPatchGroupsGroupidRoute(routeRouter: RouterType): void {
  routeRouter.patch('/groups/:groupId', patchGroupsGroupidHandler);
}

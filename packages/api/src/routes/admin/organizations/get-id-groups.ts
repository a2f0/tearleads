import type { Router as RouterType } from 'express';
import { getIdGroupsHandler } from '../organizations.js';

export function registerGetIdGroupsRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id/groups', getIdGroupsHandler);
}

/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getGroupsHandler } from '../mls.js';

export function registerGetGroupsRoute(routeRouter: RouterType): void {
  routeRouter.get('/groups', getGroupsHandler);
}

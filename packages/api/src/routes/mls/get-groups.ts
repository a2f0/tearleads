/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getGroupsHandler } from './handlers.js';

export function registerGetGroupsRoute(routeRouter: RouterType): void {
  routeRouter.get('/groups', getGroupsHandler);
}

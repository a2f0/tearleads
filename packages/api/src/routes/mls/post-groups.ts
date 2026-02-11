/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postGroupsHandler } from './handlers.js';

export function registerPostGroupsRoute(routeRouter: RouterType): void {
  routeRouter.post('/groups', postGroupsHandler);
}

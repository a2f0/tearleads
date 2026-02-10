import type { Router as RouterType } from 'express';
import { postGroupsHandler } from '../mls.js';

export function registerPostGroupsRoute(routeRouter: RouterType): void {
  routeRouter.post('/groups', postGroupsHandler);
}

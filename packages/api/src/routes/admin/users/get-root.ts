/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getRootHandler } from '../users.js';

export function registerGetRootRoute(routeRouter: RouterType): void {
  routeRouter.get('/', getRootHandler);
}

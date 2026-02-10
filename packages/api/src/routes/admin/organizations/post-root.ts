/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postRootHandler } from '../organizations.js';

export function registerPostRootRoute(routeRouter: RouterType): void {
  routeRouter.post('/', postRootHandler);
}

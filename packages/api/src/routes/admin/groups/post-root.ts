import type { Router as RouterType } from 'express';
import { postRootHandler } from '../groups.js';

export function registerPostRootRoute(routeRouter: RouterType): void {
  routeRouter.post('/', postRootHandler);
}

/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postKeyPackagesHandler } from '../mls.js';

export function registerPostKeyPackagesRoute(routeRouter: RouterType): void {
  routeRouter.post('/key-packages', postKeyPackagesHandler);
}

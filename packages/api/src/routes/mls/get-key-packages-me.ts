/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getKeyPackagesMeHandler } from './handlers.js';

export function registerGetKeyPackagesMeRoute(routeRouter: RouterType): void {
  routeRouter.get('/key-packages/me', getKeyPackagesMeHandler);
}

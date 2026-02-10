import type { Router as RouterType } from 'express';
import { getKeyPackagesMeHandler } from '../mls.js';

export function registerGetKeyPackagesMeRoute(routeRouter: RouterType): void {
  routeRouter.get('/key-packages/me', getKeyPackagesMeHandler);
}

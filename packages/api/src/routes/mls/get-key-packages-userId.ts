import type { Router as RouterType } from 'express';
import { getKeyPackagesUseridHandler } from '../mls.js';

export function registerGetKeyPackagesUseridRoute(routeRouter: RouterType): void {
  routeRouter.get('/key-packages/:userId', getKeyPackagesUseridHandler);
}

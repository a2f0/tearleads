/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getKeysMeHandler } from '../vfs.js';

export function registerGetKeysMeRoute(routeRouter: RouterType): void {
  routeRouter.get('/keys/me', getKeysMeHandler);
}

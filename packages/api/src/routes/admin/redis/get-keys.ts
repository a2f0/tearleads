/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getKeysHandler } from '../redis.js';

export function registerGetKeysRoute(routeRouter: RouterType): void {
  routeRouter.get('/keys', getKeysHandler);
}

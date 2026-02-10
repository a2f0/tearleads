import type { Router as RouterType } from 'express';
import { getKeysKeyHandler } from '../redis.js';

export function registerGetKeysKeyRoute(routeRouter: RouterType): void {
  routeRouter.get('/keys/:key', getKeysKeyHandler);
}

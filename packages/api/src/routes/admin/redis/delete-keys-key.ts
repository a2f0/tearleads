import type { Router as RouterType } from 'express';
import { deleteKeysKeyHandler } from '../redis.js';

export function registerDeleteKeysKeyRoute(routeRouter: RouterType): void {
  routeRouter.delete('/keys/:key', deleteKeysKeyHandler);
}

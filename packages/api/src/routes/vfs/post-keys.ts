import type { Router as RouterType } from 'express';
import { postKeysHandler } from '../vfs.js';

export function registerPostKeysRoute(routeRouter: RouterType): void {
  routeRouter.post('/keys', postKeysHandler);
}

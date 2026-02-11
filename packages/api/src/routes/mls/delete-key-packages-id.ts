/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { deleteKeyPackagesIdHandler } from './handlers.js';

export function registerDeleteKeyPackagesIdRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/key-packages/:id', deleteKeyPackagesIdHandler);
}

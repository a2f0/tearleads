import type { Router as RouterType } from 'express';
import { deleteKeyPackagesIdHandler } from '../mls.js';

export function registerDeleteKeyPackagesIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/key-packages/:id', deleteKeyPackagesIdHandler);
}

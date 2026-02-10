import type { Router as RouterType } from 'express';
import { patchIdHandler } from '../users.js';

export function registerPatchIdRoute(routeRouter: RouterType): void {
  routeRouter.patch('/:id', patchIdHandler);
}

/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { patchSharesShareidHandler } from '../vfs-shares.js';

export function registerPatchSharesShareidRoute(routeRouter: RouterType): void {
  routeRouter.patch('/shares/:shareId', patchSharesShareidHandler);
}

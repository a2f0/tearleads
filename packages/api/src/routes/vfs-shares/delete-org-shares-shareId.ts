import type { Router as RouterType } from 'express';
import { deleteOrgSharesShareidHandler } from '../vfs-shares.js';

export function registerDeleteOrgSharesShareidRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/org-shares/:shareId', deleteOrgSharesShareidHandler);
}

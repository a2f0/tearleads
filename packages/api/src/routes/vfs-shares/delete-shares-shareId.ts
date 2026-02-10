/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { deleteSharesShareidHandler } from '../vfs-shares.js';

export function registerDeleteSharesShareidRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/shares/:shareId', deleteSharesShareidHandler);
}

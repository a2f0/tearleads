/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postItemsItemidSharesHandler } from '../vfs-shares.js';

export function registerPostItemsItemidSharesRoute(
  routeRouter: RouterType
): void {
  routeRouter.post('/items/:itemId/shares', postItemsItemidSharesHandler);
}

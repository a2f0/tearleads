import type { Router as RouterType } from 'express';
import { getItemsItemidSharesHandler } from '../vfs-shares.js';

export function registerGetItemsItemidSharesRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/items/:itemId/shares', getItemsItemidSharesHandler);
}

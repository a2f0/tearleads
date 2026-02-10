import type { Router as RouterType } from 'express';
import { postItemsItemidOrgSharesHandler } from '../vfs-shares.js';

export function registerPostItemsItemidOrgSharesRoute(routeRouter: RouterType): void {
  routeRouter.post('/items/:itemId/org-shares', postItemsItemidOrgSharesHandler);
}

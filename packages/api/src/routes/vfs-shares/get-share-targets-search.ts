/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getShareTargetsSearchHandler } from '../vfs-shares.js';

export function registerGetShareTargetsSearchRoute(
  routeRouter: RouterType
): void {
  routeRouter.get('/share-targets/search', getShareTargetsSearchHandler);
}

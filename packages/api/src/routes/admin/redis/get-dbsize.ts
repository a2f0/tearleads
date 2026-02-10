import type { Router as RouterType } from 'express';
import { getDbsizeHandler } from '../redis.js';

export function registerGetDbsizeRoute(routeRouter: RouterType): void {
  routeRouter.get('/dbsize', getDbsizeHandler);
}

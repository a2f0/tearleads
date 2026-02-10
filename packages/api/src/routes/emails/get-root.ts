import type { Router as RouterType } from 'express';
import { getRootHandler } from '../emails.js';

export function registerGetRootRoute(routeRouter: RouterType): void {
  routeRouter.get('/', getRootHandler);
}

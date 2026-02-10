import type { Router as RouterType } from 'express';
import { getTablesHandler } from '../postgres.js';

export function registerGetTablesRoute(routeRouter: RouterType): void {
  routeRouter.get('/tables', getTablesHandler);
}

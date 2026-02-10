import type { Router as RouterType } from 'express';
import { deleteIdHandler } from '../groups.js';

export function registerDeleteIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/:id', deleteIdHandler);
}

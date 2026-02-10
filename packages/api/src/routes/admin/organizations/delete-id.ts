import type { Router as RouterType } from 'express';
import { deleteIdHandler } from '../organizations.js';

export function registerDeleteIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/:id', deleteIdHandler);
}

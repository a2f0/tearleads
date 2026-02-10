import type { Router as RouterType } from 'express';
import { getIdHandler } from '../organizations.js';

export function registerGetIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id', getIdHandler);
}

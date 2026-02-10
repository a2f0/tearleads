/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getIdHandler } from '../users.js';

export function registerGetIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id', getIdHandler);
}

/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { putIdHandler } from '../groups.js';

export function registerPutIdRoute(routeRouter: RouterType): void {
  routeRouter.put('/:id', putIdHandler);
}

import type { Router as RouterType } from 'express';
import { putIdHandler } from '../organizations.js';

export function registerPutIdRoute(routeRouter: RouterType): void {
  routeRouter.put('/:id', putIdHandler);
}

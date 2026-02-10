/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getIdUsersHandler } from '../organizations.js';

export function registerGetIdUsersRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id/users', getIdUsersHandler);
}

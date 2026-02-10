/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postIdMembersHandler } from '../groups.js';

export function registerPostIdMembersRoute(routeRouter: RouterType): void {
  routeRouter.post('/:id/members', postIdMembersHandler);
}

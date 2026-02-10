import type { Router as RouterType } from 'express';
import { getIdMembersHandler } from '../groups.js';

export function registerGetIdMembersRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id/members', getIdMembersHandler);
}

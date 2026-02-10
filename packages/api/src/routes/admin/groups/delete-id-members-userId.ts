import type { Router as RouterType } from 'express';
import { deleteIdMembersUseridHandler } from '../groups.js';

export function registerDeleteIdMembersUseridRoute(
  routeRouter: RouterType
): void {
  routeRouter.delete('/:id/members/:userId', deleteIdMembersUseridHandler);
}

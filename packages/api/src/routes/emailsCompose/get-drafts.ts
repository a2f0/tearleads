/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getDraftsHandler } from '../emailsCompose.js';

export function registerGetDraftsRoute(routeRouter: RouterType): void {
  routeRouter.get('/drafts', getDraftsHandler);
}

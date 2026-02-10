/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postDraftsHandler } from '../emailsCompose.js';

export function registerPostDraftsRoute(routeRouter: RouterType): void {
  routeRouter.post('/drafts', postDraftsHandler);
}

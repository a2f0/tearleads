import type { Router as RouterType } from 'express';
import { getDraftsIdHandler } from '../emailsCompose.js';

export function registerGetDraftsIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/drafts/:id', getDraftsIdHandler);
}

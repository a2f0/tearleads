import type { Router as RouterType } from 'express';
import { deleteDraftsIdHandler } from '../emailsCompose.js';

export function registerDeleteDraftsIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/drafts/:id', deleteDraftsIdHandler);
}

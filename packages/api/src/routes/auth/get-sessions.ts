import type { Router as RouterType } from 'express';
import { getSessionsHandler } from '../auth.js';

export function registerGetSessionsRoute(authRouter: RouterType): void {
  authRouter.get('/sessions', getSessionsHandler);
}

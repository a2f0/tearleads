import type { Router as RouterType } from 'express';
import { deleteSessionsSessionIdHandler } from '../auth.js';

export function registerDeleteSessionsSessionIdRoute(
  authRouter: RouterType
): void {
  authRouter.delete('/sessions/:sessionId', deleteSessionsSessionIdHandler);
}

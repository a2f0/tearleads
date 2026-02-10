import type { Router as RouterType } from 'express';
import { postRefreshHandler } from '../auth.js';

export function registerPostRefreshRoute(authRouter: RouterType): void {
  authRouter.post('/refresh', postRefreshHandler);
}

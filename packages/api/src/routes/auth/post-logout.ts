/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postLogoutHandler } from '../auth.js';

export function registerPostLogoutRoute(authRouter: RouterType): void {
  authRouter.post('/logout', postLogoutHandler);
}

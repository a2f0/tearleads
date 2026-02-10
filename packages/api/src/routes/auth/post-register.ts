/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postRegisterHandler } from '../auth.js';

export function registerPostRegisterRoute(authRouter: RouterType): void {
  authRouter.post('/register', postRegisterHandler);
}

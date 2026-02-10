import type { Router as RouterType } from 'express';
import { postLoginHandler } from '../auth.js';

export function registerPostLoginRoute(authRouter: RouterType): void {
  authRouter.post('/login', postLoginHandler);
}

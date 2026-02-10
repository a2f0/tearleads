import type { Router as RouterType } from 'express';
import { postRegisterHandler } from '../vfs.js';

export function registerPostRegisterRoute(routeRouter: RouterType): void {
  routeRouter.post('/register', postRegisterHandler);
}

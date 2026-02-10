import type { Router as RouterType } from 'express';
import { postCompletionsHandler } from '../chat.js';

export function registerPostCompletionsRoute(routeRouter: RouterType): void {
  routeRouter.post('/completions', postCompletionsHandler);
}

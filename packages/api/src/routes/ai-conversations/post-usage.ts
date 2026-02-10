/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postUsageHandler } from '../ai-conversations.js';

export function registerPostUsageRoute(routeRouter: RouterType): void {
  routeRouter.post('/usage', postUsageHandler);
}

/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getUsageHandler } from '../ai-conversations.js';

export function registerGetUsageRoute(routeRouter: RouterType): void {
  routeRouter.get('/usage', getUsageHandler);
}

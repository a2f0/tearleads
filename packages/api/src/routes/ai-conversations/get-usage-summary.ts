/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getUsageSummaryHandler } from '../ai-conversations.js';

export function registerGetUsageSummaryRoute(routeRouter: RouterType): void {
  routeRouter.get('/usage/summary', getUsageSummaryHandler);
}

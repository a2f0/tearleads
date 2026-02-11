/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getWelcomeMessagesHandler } from './handlers.js';

export function registerGetWelcomeMessagesRoute(routeRouter: RouterType): void {
  routeRouter.get('/welcome-messages', getWelcomeMessagesHandler);
}

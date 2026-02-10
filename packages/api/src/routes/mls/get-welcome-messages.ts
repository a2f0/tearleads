/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getWelcomeMessagesHandler } from '../mls.js';

export function registerGetWelcomeMessagesRoute(routeRouter: RouterType): void {
  routeRouter.get('/welcome-messages', getWelcomeMessagesHandler);
}

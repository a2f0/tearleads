/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postWelcomeMessagesIdAckHandler } from './handlers.js';

export function registerPostWelcomeMessagesIdAckRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/welcome-messages/:id/ack',
    postWelcomeMessagesIdAckHandler
  );
}

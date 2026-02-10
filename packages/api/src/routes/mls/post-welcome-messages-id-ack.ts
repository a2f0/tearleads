import type { Router as RouterType } from 'express';
import { postWelcomeMessagesIdAckHandler } from '../mls.js';

export function registerPostWelcomeMessagesIdAckRoute(
  routeRouter: RouterType
): void {
  routeRouter.post(
    '/welcome-messages/:id/ack',
    postWelcomeMessagesIdAckHandler
  );
}

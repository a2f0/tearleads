/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { postSendHandler } from '../emailsCompose.js';

export function registerPostSendRoute(routeRouter: RouterType): void {
  routeRouter.post('/send', postSendHandler);
}

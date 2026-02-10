/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getInfoHandler } from '../postgres.js';

export function registerGetInfoRoute(routeRouter: RouterType): void {
  routeRouter.get('/info', getInfoHandler);
}

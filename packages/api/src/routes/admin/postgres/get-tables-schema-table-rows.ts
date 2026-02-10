/* istanbul ignore file */
import type { Router as RouterType } from 'express';
import { getTablesSchemaTableRowsHandler } from '../postgres.js';

export function registerGetTablesSchemaTableRowsRoute(
  routeRouter: RouterType
): void {
  routeRouter.get(
    '/tables/:schema/:table/rows',
    getTablesSchemaTableRowsHandler
  );
}

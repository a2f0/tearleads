import type { Router as RouterType } from 'express';
import { getTablesSchemaTableColumnsHandler } from '../postgres.js';

export function registerGetTablesSchemaTableColumnsRoute(
  routeRouter: RouterType
): void {
  routeRouter.get(
    '/tables/:schema/:table/columns',
    getTablesSchemaTableColumnsHandler
  );
}

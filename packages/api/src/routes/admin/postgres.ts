import { Router, type Router as RouterType } from 'express';
import { registerGetInfoRoute } from './postgres/getInfo.js';
import { registerGetTablesRoute } from './postgres/getTables.js';
import { registerGetTablesSchemaTableColumnsRoute } from './postgres/getTablesSchemaTableColumns.js';
import { registerGetTablesSchemaTableRowsRoute } from './postgres/getTablesSchemaTableRows.js';

const postgresRouter: RouterType = Router();
registerGetInfoRoute(postgresRouter);
registerGetTablesRoute(postgresRouter);
registerGetTablesSchemaTableColumnsRoute(postgresRouter);
registerGetTablesSchemaTableRowsRoute(postgresRouter);

export { postgresRouter };

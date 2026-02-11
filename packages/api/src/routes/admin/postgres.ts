import { Router, type Router as RouterType } from 'express';
import { registerGetInfoRoute } from './postgres/get-info.js';
import { registerGetTablesRoute } from './postgres/get-tables.js';
import { registerGetTablesSchemaTableColumnsRoute } from './postgres/get-tables-schema-table-columns.js';
import { registerGetTablesSchemaTableRowsRoute } from './postgres/get-tables-schema-table-rows.js';

const postgresRouter: RouterType = Router();
registerGetInfoRoute(postgresRouter);
registerGetTablesRoute(postgresRouter);
registerGetTablesSchemaTableColumnsRoute(postgresRouter);
registerGetTablesSchemaTableRowsRoute(postgresRouter);

export { postgresRouter };

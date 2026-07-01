import { createDatabaseWorkerConnectionFactory } from "./databaseConnections";
import { installSqliteBootstrapWarningFilter } from "./sqliteBootstrapWarnings";
import { registerDatabaseWorker } from "./worker";

installSqliteBootstrapWarningFilter();
registerDatabaseWorker(createDatabaseWorkerConnectionFactory());

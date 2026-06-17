import { createDatabaseWorkerConnectionFactory } from "./databaseConnections";
import { registerDatabaseWorker } from "./worker";

registerDatabaseWorker(createDatabaseWorkerConnectionFactory());

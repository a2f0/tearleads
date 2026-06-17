import { createDatabaseWorkerConnectionFactory } from "../src/databaseConnections";
import { registerDatabaseWorker } from "../src/worker";

registerDatabaseWorker(createDatabaseWorkerConnectionFactory());
